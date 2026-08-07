/**
 * useSwarmAgents tests.
 *
 * adj-bgpup: this hook no longer owns a WebSocket. Agent status arrives on the
 * SHARED connection held by CommunicationContext (one long-lived stream per
 * tab instead of two), so the harness drives a mocked subscribeAgentStatus
 * rather than a mock socket. Reconnection/backoff is the context's concern and
 * is covered by its own tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CrewMember } from '../../../src/types';

// =============================================================================
// Mock the shared communication stream
// =============================================================================

interface AgentStatusEvent {
  agent: string;
  status: string;
  timestamp: string;
}

let statusHandlers: ((event: AgentStatusEvent) => void)[] = [];
let connectionStatus = 'websocket';

/** Push a status change down the shared stream, as the server would. */
function pushStatus(event: AgentStatusEvent): void {
  for (const h of statusHandlers) h(event);
}

vi.mock('../../../src/contexts/CommunicationContext', () => ({
  useCommunicationActions: () => ({
    subscribeAgentStatus: (cb: (event: AgentStatusEvent) => void) => {
      statusHandlers.push(cb);
      return () => {
        statusHandlers = statusHandlers.filter((h) => h !== cb);
      };
    },
  }),
  useCommunicationStatus: () => ({ connectionStatus }),
}));

// =============================================================================
// Mock api.agents.list
// =============================================================================

const mockAgentsList = vi.fn<() => Promise<CrewMember[]>>();

vi.mock('../../../src/services/api', () => ({
  api: {
    agents: {
      list: () => mockAgentsList(),
    },
  },
}));

import { useSwarmAgents } from '../../../src/hooks/useSwarmAgents';

// =============================================================================
// Test helpers
// =============================================================================

function makeAgent(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'test/agent-1',
    name: 'agent-1',
    type: 'agent',
    project: null,
    status: 'working',
    ...overrides,
  } as CrewMember;
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.useFakeTimers();
  statusHandlers = [];
  connectionStatus = 'websocket';
  mockAgentsList.mockReset();
  mockAgentsList.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
  vi.restoreAllMocks();
});

// =============================================================================
// Tests
// =============================================================================

describe('useSwarmAgents', () => {
  describe('initial fetch', () => {
    it('should fetch agents on mount and set loading states', async () => {
      const agents = [makeAgent({ id: 'a/1', name: 'alpha' })];
      mockAgentsList.mockResolvedValue(agents);

      const { result } = renderHook(() => useSwarmAgents());

      expect(result.current.loading).toBe(true);
      expect(result.current.agents).toEqual([]);

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.agents).toEqual(agents);
      expect(result.current.error).toBeNull();
    });

    it('should set error when initial fetch fails', async () => {
      mockAgentsList.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSwarmAgents());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('Network error');
      expect(result.current.agents).toEqual([]);
    });
  });

  describe('shared status stream (adj-bgpup)', () => {
    it('should not open a WebSocket of its own', async () => {
      const wsSpy = vi.fn();
      vi.stubGlobal('WebSocket', wsSpy);

      try {
        renderHook(() => useSwarmAgents());
        await act(async () => {
          await Promise.resolve();
        });

        expect(wsSpy).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should subscribe to agent status on the shared stream', async () => {
      renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });

      expect(statusHandlers).toHaveLength(1);
    });

    it('should unsubscribe on unmount', async () => {
      const { unmount } = renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });
      expect(statusHandlers).toHaveLength(1);

      unmount();
      expect(statusHandlers).toHaveLength(0);
    });

    it('should report connected when the shared stream is up', async () => {
      const { result } = renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.connected).toBe(true);
    });

    it('should report disconnected when the shared stream is down', async () => {
      connectionStatus = 'polling';

      const { result } = renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.connected).toBe(false);
    });
  });

  describe('optimistic status updates', () => {
    it('should update agent status on a pushed status change', async () => {
      mockAgentsList.mockResolvedValue([
        makeAgent({ id: 'a/1', name: 'alpha', status: 'working' }),
        makeAgent({ id: 'a/2', name: 'beta', status: 'idle' }),
      ]);

      const { result } = renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        pushStatus({ agent: 'alpha', status: 'idle', timestamp: '2026-08-07T00:00:00Z' });
      });

      expect(result.current.agents.find((a) => a.name === 'alpha')?.status).toBe('idle');
      expect(result.current.agents.find((a) => a.name === 'beta')?.status).toBe('idle');
    });

    it('should ignore a status change for an unknown agent', async () => {
      mockAgentsList.mockResolvedValue([
        makeAgent({ id: 'a/1', name: 'alpha', status: 'working' }),
      ]);

      const { result } = renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        pushStatus({ agent: 'ghost', status: 'offline', timestamp: '2026-08-07T00:00:00Z' });
      });

      expect(result.current.agents).toHaveLength(1);
      expect(result.current.agents[0]?.name).toBe('alpha');
      expect(result.current.agents[0]?.status).toBe('working');
    });
  });

  describe('periodic refresh', () => {
    it('should refetch every 10 seconds while the status stream is down', async () => {
      connectionStatus = 'polling';
      mockAgentsList.mockResolvedValue([makeAgent({ id: 'a/1', name: 'alpha' })]);

      renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAgentsList).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(10000);
        await Promise.resolve();
      });

      expect(mockAgentsList).toHaveBeenCalledTimes(2);
    });

    it('should not refetch on every tick while the status stream is connected', async () => {
      // With the stream up, status changes arrive by push. The full refetch
      // only exists to notice roster joins/leaves, so it runs at 1/6 the rate
      // instead of competing for a connection slot every 10s (adj-bgpup).
      mockAgentsList.mockResolvedValue([makeAgent({ id: 'a/1', name: 'alpha' })]);

      renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAgentsList).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(50000);
        await Promise.resolve();
      });
      expect(mockAgentsList).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(10000);
        await Promise.resolve();
      });
      expect(mockAgentsList).toHaveBeenCalledTimes(2);
    });

    it('should skip the refetch while the tab is hidden', async () => {
      connectionStatus = 'polling';
      mockAgentsList.mockResolvedValue([makeAgent({ id: 'a/1', name: 'alpha' })]);

      renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAgentsList).toHaveBeenCalledTimes(1);

      const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      try {
        await act(async () => {
          vi.advanceTimersByTime(60000);
          await Promise.resolve();
        });
        expect(mockAgentsList).toHaveBeenCalledTimes(1);
      } finally {
        hiddenSpy.mockRestore();
      }
    });

    it('should stop the refresh timer on unmount', async () => {
      connectionStatus = 'polling';
      const { unmount } = renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAgentsList).toHaveBeenCalledTimes(1);

      unmount();

      await act(async () => {
        vi.advanceTimersByTime(60000);
        await Promise.resolve();
      });
      expect(mockAgentsList).toHaveBeenCalledTimes(1);
    });
  });

  describe('manual refresh', () => {
    it('should refetch agents when refresh() is called', async () => {
      mockAgentsList.mockResolvedValue([makeAgent({ id: 'a/1', name: 'alpha' })]);

      const { result } = renderHook(() => useSwarmAgents());
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockAgentsList).toHaveBeenCalledTimes(1);

      await act(async () => {
        result.current.refresh();
        await Promise.resolve();
      });

      expect(mockAgentsList).toHaveBeenCalledTimes(2);
    });
  });
});
