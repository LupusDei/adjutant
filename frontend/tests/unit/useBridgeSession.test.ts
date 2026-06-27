/**
 * useBridgeSession (adj-202.3.6) — The Bridge session lifecycle data layer.
 *
 * The hook owns the avatar session for the read-only Fleet Briefing panel:
 *   POST /api/bridge/session → { sessionId, sessionKey, avatarId, expiresAt? }
 *   POST /api/bridge/tool      { tool, projectId?, args? } → { tool, projectId, data }
 *
 * It exposes a connection state machine (idle → connecting → connected | error),
 * a live session timer + credit meter (2 credits up front + 2 credits / 6s block,
 * partial blocks billed UP — mirrors the backend cost guard), and a `runTool`
 * helper that returns a STRUCTURED result (the authoritative source of truth the
 * avatar only narrates).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  useBridgeSession,
  computeBridgeMeter,
  BRIDGE_COST_MODEL,
} from '../../src/hooks/useBridgeSession';

const { mockStartSession, mockRunTool } = vi.hoisted(() => ({
  mockStartSession: vi.fn(),
  mockRunTool: vi.fn(),
}));

vi.mock('../../src/services/api', () => {
  const apiObj = {
    bridge: {
      startSession: mockStartSession,
      runTool: mockRunTool,
    },
  };
  return { api: apiObj, default: apiObj };
});

const CREDS = {
  sessionId: 'sess_123',
  sessionKey: 'key_abc',
  avatarId: 'avatar_xyz',
  expiresAt: '2026-06-27T12:05:00.000Z',
};

describe('computeBridgeMeter', () => {
  it('should charge only the upfront credits at zero elapsed time', () => {
    const meter = computeBridgeMeter(0);
    expect(meter.elapsedSeconds).toBe(0);
    expect(meter.blocks).toBe(0);
    expect(meter.credits).toBe(BRIDGE_COST_MODEL.upfrontCredits);
    expect(meter.dollars).toBeCloseTo(2 * 0.01, 10);
  });

  it('should round a partial 6s block UP (never under-report spend)', () => {
    // 1s in → one started 6s block → upfront(2) + 1 block × 2 = 4 credits
    const meter = computeBridgeMeter(1_000);
    expect(meter.blocks).toBe(1);
    expect(meter.credits).toBe(4);
  });

  it('should bill whole blocks exactly at the boundary', () => {
    // 12s = exactly 2 blocks → upfront(2) + 2 × 2 = 6 credits
    const meter = computeBridgeMeter(12_000);
    expect(meter.blocks).toBe(2);
    expect(meter.credits).toBe(6);
  });

  it('should clamp negative elapsed time (clock skew) to zero', () => {
    const meter = computeBridgeMeter(-5_000);
    expect(meter.elapsedSeconds).toBe(0);
    expect(meter.credits).toBe(BRIDGE_COST_MODEL.upfrontCredits);
  });
});

describe('useBridgeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T12:00:00.000Z'));
    mockStartSession.mockResolvedValue(CREDS);
    mockRunTool.mockResolvedValue({ tool: 'list_agents', projectId: null, data: { agents: [], count: 0 } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should expose idle defaults before any connect', () => {
    const { result } = renderHook(() => useBridgeSession());

    expect(result.current.state).toBe('idle');
    expect(result.current.creds).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.elapsedMs).toBe(0);
    expect(result.current.meter.credits).toBe(0);
    expect(result.current.meter.dollars).toBe(0);
  });

  it('should transition idle → connecting → connected and store creds', async () => {
    const { result } = renderHook(() => useBridgeSession());

    await act(async () => {
      await result.current.connect();
    });

    expect(mockStartSession).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('connected');
    expect(result.current.creds).toEqual(CREDS);
    expect(result.current.error).toBeNull();
  });

  it('should advance the session timer and credit meter while connected', async () => {
    const { result } = renderHook(() => useBridgeSession());

    await act(async () => {
      await result.current.connect();
    });

    // Connected: meter shows just the upfront credits.
    expect(result.current.meter.credits).toBe(2);

    // Advance 7s of wall-clock — one elapsed timer tick crosses into a 2nd block.
    await act(async () => {
      vi.advanceTimersByTime(7_000);
    });

    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(7_000);
    // 7s → 2 started blocks → upfront(2) + 2 × 2 = 6 credits
    expect(result.current.meter.credits).toBe(6);
  });

  it('should enter the error state when the session broker rejects', async () => {
    mockStartSession.mockRejectedValueOnce(new Error('CEILING_TRIPPED: daily credit ceiling reached'));

    const { result } = renderHook(() => useBridgeSession());

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('CEILING_TRIPPED');
    expect(result.current.creds).toBeNull();
  });

  it('should reset to idle on disconnect and stop the meter', async () => {
    const { result } = renderHook(() => useBridgeSession());

    await act(async () => {
      await result.current.connect();
    });
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(result.current.state).toBe('connected');

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.creds).toBeNull();
    expect(result.current.elapsedMs).toBe(0);
    expect(result.current.meter.credits).toBe(0);

    // Timer must be stopped — further ticks do not move elapsed time.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.elapsedMs).toBe(0);
  });

  it('should return a structured ok result from runTool', async () => {
    const toolData = { agents: [{ id: 'a1', name: 'fenix' }], count: 1 };
    mockRunTool.mockResolvedValueOnce({ tool: 'list_agents', projectId: '0e578d15', data: toolData });

    const { result } = renderHook(() => useBridgeSession());
    await act(async () => {
      await result.current.connect();
    });

    let toolResult: Awaited<ReturnType<typeof result.current.runTool>> | undefined;
    await act(async () => {
      toolResult = await result.current.runTool('list_agents', '0e578d15');
    });

    expect(mockRunTool).toHaveBeenCalledWith({ tool: 'list_agents', projectId: '0e578d15', args: undefined });
    expect(toolResult).toEqual({ ok: true, tool: 'list_agents', projectId: '0e578d15', data: toolData });
  });

  it('should return a structured error result when runTool fails', async () => {
    const apiErr = Object.assign(new Error('Tool not allowed'), { code: 'TOOL_NOT_ALLOWED' });
    mockRunTool.mockRejectedValueOnce(apiErr);

    const { result } = renderHook(() => useBridgeSession());
    await act(async () => {
      await result.current.connect();
    });

    let toolResult: Awaited<ReturnType<typeof result.current.runTool>> | undefined;
    await act(async () => {
      toolResult = await result.current.runTool('close_bead');
    });

    expect(toolResult).toEqual({
      ok: false,
      error: { code: 'TOOL_NOT_ALLOWED', message: 'Tool not allowed' },
    });
  });
});
