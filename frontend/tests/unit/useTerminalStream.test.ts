/**
 * Tests for adj-139.3.5: useTerminalStream content ring buffer.
 *
 * Verifies appendWithRingBuffer (pure helper exported from useTerminalStream):
 *  - never lets content exceed MAX_TERMINAL_BYTES
 *  - drops oldest lines, never truncating mid-line
 *  - preserves newest content verbatim
 *
 * adj-bjoia: also verifies that the hook caps content from EVERY entry path:
 *  - polling initial-fetch (api.agents.getSessionTerminal)
 *  - WS 'subscribed' frame (initial content payload)
 *  - WS 'snapshot' frame (full refresh)
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks for the hook-level tests.
// The hook reads `api.agents.getSessionTerminal` and opens a WebSocket.
// We mock both so we can drive each entry path deterministically.
// ---------------------------------------------------------------------------
vi.mock('../../src/services/api', () => ({
  api: {
    agents: {
      getSessionTerminal: vi.fn(),
    },
  },
}));

import {
  appendWithRingBuffer,
  MAX_TERMINAL_BYTES,
  useTerminalStream,
} from '../../src/hooks/useTerminalStream';
import { api } from '../../src/services/api';

describe('appendWithRingBuffer (adj-139.3.5)', () => {
  it('should append plain text when total is under the cap', () => {
    const result = appendWithRingBuffer(null, 'hello');
    expect(result).toBe('hello');

    const next = appendWithRingBuffer(result, 'world');
    expect(next).toBe('hello\nworld');
  });

  it('should never exceed MAX_TERMINAL_BYTES', () => {
    // Build a string > MAX bytes from many small lines.
    const lines: string[] = [];
    for (let i = 0; i < 20000; i++) {
      lines.push(`line-${i}-${'x'.repeat(20)}`); // ~30 bytes per line
    }

    let content: string | null = null;
    for (const ln of lines) {
      content = appendWithRingBuffer(content, ln);
      expect((content ?? '').length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    }
    expect((content ?? '').length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    expect((content ?? '').length).toBeGreaterThan(0);
  });

  it('should drop oldest lines (FIFO) when over the cap', () => {
    // First chunk: large content that fills almost the entire buffer.
    const big = 'A'.repeat(MAX_TERMINAL_BYTES - 10);
    // Append a new tail that pushes past the cap.
    const newTail = `B\nC\nD${'E'.repeat(50)}`;
    const result = appendWithRingBuffer(big, newTail);

    // Total length must be ≤ cap.
    expect(result.length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    // The newest text must still be present at the end.
    expect(result.endsWith(`D${'E'.repeat(50)}`)).toBe(true);
  });

  it('should preserve line boundaries (never truncate mid-line)', () => {
    // Create content where every line is distinct and identifiable.
    const lines = Array.from({ length: 5000 }, (_, i) => `LINE_${String(i).padStart(5, '0')}_${'.'.repeat(40)}`);
    let content: string | null = null;
    for (const ln of lines) {
      content = appendWithRingBuffer(content, ln);
    }

    expect(content).not.toBeNull();
    const finalLines = (content ?? '').split('\n');

    // Every surviving line must match the LINE_NNNNN_..... pattern exactly.
    // If we truncated mid-line, the first surviving line would be a partial match.
    const linePattern = /^LINE_\d{5}_\.{40}$/;
    for (const ln of finalLines) {
      expect(ln).toMatch(linePattern);
    }
  });

  it('should keep the newest input intact even if it alone is large', () => {
    // Pre-existing content fills the buffer.
    const filler = 'X'.repeat(MAX_TERMINAL_BYTES - 100);
    // New text is larger than what's left but still smaller than the cap.
    const newText = 'NEW_LINE_AAA\nNEW_LINE_BBB\nNEW_LINE_CCC';
    const result = appendWithRingBuffer(filler, newText);

    expect(result.length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    expect(result.endsWith('NEW_LINE_CCC')).toBe(true);
    expect(result.includes('NEW_LINE_AAA')).toBe(true);
  });

  it('should handle the case where new text alone exceeds the cap by keeping only the last MAX bytes worth of complete lines', () => {
    // newText is huge. Make it many lines so we keep complete tail lines.
    const lines = Array.from({ length: 10000 }, (_, i) => `L${i}_${'y'.repeat(20)}`);
    const huge = lines.join('\n');
    const result = appendWithRingBuffer(null, huge);

    expect(result.length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    // The very last line should be intact at the end.
    expect(result.endsWith(`L9999_${'y'.repeat(20)}`)).toBe(true);
    // Result must not start mid-line.
    expect(result.split('\n')[0]).toMatch(/^L\d+_y+$/);
  });

  it('should handle null prev', () => {
    expect(appendWithRingBuffer(null, 'first')).toBe('first');
  });

  it('should handle empty new text without changing prev', () => {
    expect(appendWithRingBuffer('existing', '')).toBe('existing');
  });
});

// ---------------------------------------------------------------------------
// adj-bjoia: hook-level tests asserting all entry paths honor the cap.
// ---------------------------------------------------------------------------

/** A minimal WebSocket double we can drive from tests. */
interface WsDouble {
  url: string;
  readyState: number;
  sent: string[];
  onopen: ((ev?: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev?: CloseEvent) => void) | null;
  onerror: ((ev?: Event) => void) | null;
  send: Mock;
  close: Mock;
}

const createdWsockets: WsDouble[] = [];

function createWebSocketDouble(url: string): WsDouble {
  const ws: WsDouble = {
    url,
    readyState: 0,
    sent: [],
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn((data: string) => { ws.sent.push(data); }),
    close: vi.fn(() => {
      ws.readyState = 3;
      ws.onclose?.();
    }),
  };
  createdWsockets.push(ws);
  return ws;
}

describe('useTerminalStream - ring buffer applied to all entry paths (adj-bjoia)', () => {
  beforeEach(() => {
    createdWsockets.length = 0;
    vi.clearAllMocks();
    // Stub WebSocket. Tests that don't want the WS path will let it linger
    // (we drive it manually) or it may not connect — the polling-fallback
    // timer is 5s so it won't fire in test time unless we advance fake timers.
    vi.stubGlobal(
      'WebSocket',
      vi.fn((url: string) => createWebSocketDouble(url)) as unknown as typeof WebSocket
    );
    // Mirror the WebSocket constants for code that checks readyState.
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: Object.assign(
        vi.fn((url: string) => createWebSocketDouble(url)),
        { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }
      ),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should cap content from the WS "subscribed" frame (initial payload)', async () => {
    // Build an initial payload larger than MAX_TERMINAL_BYTES.
    const hugeInitial = Array.from({ length: 20000 }, (_, i) => `init-${i}-${'x'.repeat(20)}`).join('\n');
    expect(hugeInitial.length).toBeGreaterThan(MAX_TERMINAL_BYTES);

    const { result } = renderHook(() =>
      useTerminalStream({ sessionId: 'sess-1', enabled: true })
    );

    // The hook opened a WebSocket.
    await waitFor(() => {
      expect(createdWsockets.length).toBe(1);
    });
    const ws = createdWsockets[0]!;

    // Drive the 'subscribed' message.
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'subscribed', content: hugeInitial }),
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(result.current.content).not.toBeNull();
    });
    expect((result.current.content ?? '').length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
  });

  it('should cap content from the WS "snapshot" frame', async () => {
    const hugeSnapshot = Array.from({ length: 20000 }, (_, i) => `snap-${i}-${'y'.repeat(20)}`).join('\n');
    expect(hugeSnapshot.length).toBeGreaterThan(MAX_TERMINAL_BYTES);

    const { result } = renderHook(() =>
      useTerminalStream({ sessionId: 'sess-2', enabled: true })
    );

    await waitFor(() => {
      expect(createdWsockets.length).toBe(1);
    });
    const ws = createdWsockets[0]!;

    // First subscribe with a small payload so content exists.
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'subscribed', content: 'tiny-initial' }),
      } as MessageEvent);
    });

    // Then deliver a huge snapshot replacement.
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', content: hugeSnapshot }),
      } as MessageEvent);
    });

    await waitFor(() => {
      expect((result.current.content ?? '').length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
    });
    expect((result.current.content ?? '').length).toBeGreaterThan(0);
  });

  it('should cap content from the polling initial-fetch path', async () => {
    const hugePollContent = Array.from({ length: 20000 }, (_, i) => `poll-${i}-${'z'.repeat(20)}`).join('\n');
    expect(hugePollContent.length).toBeGreaterThan(MAX_TERMINAL_BYTES);

    (api.agents.getSessionTerminal as Mock).mockResolvedValue({
      content: hugePollContent,
    });

    // Force the polling fallback path: close the WS immediately so the hook
    // falls back to polling on the next tick.
    const { result } = renderHook(() =>
      useTerminalStream({ sessionId: 'sess-3', enabled: true })
    );

    await waitFor(() => {
      expect(createdWsockets.length).toBe(1);
    });
    const ws = createdWsockets[0]!;

    // Force close — the hook's onclose handler starts polling.
    act(() => {
      ws.onclose?.();
    });

    // Polling fires fetchContent() synchronously after onclose; wait for state.
    await waitFor(() => {
      expect(result.current.content).not.toBeNull();
    });
    expect((result.current.content ?? '').length).toBeLessThanOrEqual(MAX_TERMINAL_BYTES);
  });
});
