import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwarmAgents } from '../../../src/hooks/useSwarmAgents';
import type { CrewMember } from '../../../src/types';

// =============================================================================
// Mock WebSocket
// =============================================================================

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  sentMessages: string[] = [];

  constructor(public url: string) {
    // Auto-open after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify(data),
    }));
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

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

// =============================================================================
// Test helpers
// =============================================================================

function makeAgent(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'test/agent-1',
    name: 'agent-1',
    type: 'agent',
    rig: null,
    status: 'working',
    unreadMail: 0,
    ...overrides,
  };
}

// =============================================================================
// Setup
// =============================================================================

let mockWs: MockWebSocket | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  mockWs = null;
  vi.stubGlobal('WebSocket', class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      mockWs = this;
    }
  });
  mockAgentsList.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

      // Initially loading
      expect(result.current.loading).toBe(true);
      expect(result.current.agents).toEqual([]);

      // Resolve fetch
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

  describe('WebSocket connection', () => {
    it('should connect to WebSocket on mount', async () => {
      mockAgentsList.mockResolvedValue([]);

      renderHook(() => useSwarmAgents());

      // WS should be created
      expect(mockWs).not.toBeNull();
      expect(mockWs!.url).toContain('/api/agents/stream');
    });

    it('should set connected=true when WebSocket opens', async () => {
      mockAgentsList.mockResolvedValue([]);

      const { result } = renderHook(() => useSwarmAgents());

      // Let WS auto-open
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(result.current.connected).toBe(true);
    });

    it('should set connected=false when WebSocket closes', async () => {
      mockAgentsList.mockResolvedValue([]);

      const { result } = renderHook(() => useSwarmAgents());

      // Let WS open
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.connected).toBe(true);

      // Simulate close
      act(() => {
        mockWs!.simulateClose();
      });

      expect(result.current.connected).toBe(false);
    });

    it('should clean up WebSocket on unmount', async () => {
      mockAgentsList.mockResolvedValue([]);

      const { unmount } = renderHook(() => useSwarmAgents());

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      const ws = mockWs!;
      unmount();

      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });
  });

  describe('optimistic status updates', () => {
    it('should update agent status on status_change event', async () => {
      const agents = [
        makeAgent({ id: 'a/1', name: 'alpha', status: 'working' }),
        makeAgent({ id: 'a/2', name: 'beta', status: 'idle' }),
      ];
      mockAgentsList.mockResolvedValue(agents);

      const { result } = renderHook(() => useSwarmAgents());

      // Resolve initial fetch
      await act(async () => {
        await Promise.resolve();
      });

      // Let WS open
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Simulate status change event
      act(() => {
        mockWs!.simulateMessage({
          type: 'status_change',
          agent: 'alpha',
          to: 'idle',
          timestamp: new Date().toISOString(),
        });
      });

      // Agent alpha should now be idle
      const alpha = result.current.agents.find(a => a.name === 'alpha');
      expect(alpha?.status).toBe('idle');

      // Agent beta should be unchanged
      const beta = result.current.agents.find(a => a.name === 'beta');
      expect(beta?.status).toBe('idle');
    });

    it('should ignore status_change for unknown agents', async () => {
      const agents = [makeAgent({ id: 'a/1', name: 'alpha', status: 'working' })];
      mockAgentsList.mockResolvedValue(agents);

      const { result } = renderHook(() => useSwarmAgents());

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Send status change for an unknown agent
      act(() => {
        mockWs!.simulateMessage({
          type: 'status_change',
          agent: 'ghost',
          to: 'offline',
          timestamp: new Date().toISOString(),
        });
      });

      // Agents should be unchanged
      expect(result.current.agents).toHaveLength(1);
      expect(result.current.agents[0]?.name).toBe('alpha');
      expect(result.current.agents[0]?.status).toBe('working');
    });
  });

  describe('periodic refresh', () => {
    it('should refetch agents every 10 seconds', async () => {
      const initialAgents = [makeAgent({ id: 'a/1', name: 'alpha' })];
      const updatedAgents = [
        makeAgent({ id: 'a/1', name: 'alpha' }),
        makeAgent({ id: 'a/2', name: 'beta' }),
      ];

      mockAgentsList.mockResolvedValueOnce(initialAgents);

      const { result } = renderHook(() => useSwarmAgents());

      // Initial fetch
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.agents).toHaveLength(1);
      expect(mockAgentsList).toHaveBeenCalledTimes(1);

      // Set up next response
      mockAgentsList.mockResolvedValueOnce(updatedAgents);

      // Advance 10s for periodic refresh
      await act(async () => {
        vi.advanceTimersByTime(10000);
        await Promise.resolve();
      });

      expect(mockAgentsList).toHaveBeenCalledTimes(2);
      expect(result.current.agents).toHaveLength(2);
    });
  });

  describe('reconnection', () => {
    it('should attempt reconnect with backoff after WS disconnect', async () => {
      mockAgentsList.mockResolvedValue([]);

      renderHook(() => useSwarmAgents());

      // Let WS open
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      const firstWs = mockWs!;

      // Simulate disconnect
      act(() => {
        firstWs.simulateClose();
      });

      // Should reconnect after base delay (1s)
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // A new WS should be created
      expect(mockWs).not.toBe(firstWs);
      expect(mockWs!.url).toContain('/api/agents/stream');
    });

    it('should use exponential backoff for reconnection', async () => {
      mockAgentsList.mockResolvedValue([]);

      renderHook(() => useSwarmAgents());

      // Let WS open
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // First disconnect
      act(() => {
        mockWs!.simulateClose();
      });

      // After 999ms, no reconnect yet
      await act(async () => {
        vi.advanceTimersByTime(999);
      });
      const wsAfter999 = mockWs;

      // At 1000ms, should reconnect
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(mockWs).not.toBe(wsAfter999);

      // Let it open then close again
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      const secondWs = mockWs;
      act(() => {
        mockWs!.simulateClose();
      });

      // Second disconnect: backoff should be 2000ms
      await act(async () => {
        vi.advanceTimersByTime(1999);
      });
      expect(mockWs).toBe(secondWs);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(mockWs).not.toBe(secondWs);
    });
  });

  describe('manual refresh', () => {
    it('should refetch agents when refresh() is called', async () => {
      const initialAgents = [makeAgent({ id: 'a/1', name: 'alpha' })];
      const refreshedAgents = [makeAgent({ id: 'a/1', name: 'alpha', status: 'idle' })];

      mockAgentsList.mockResolvedValueOnce(initialAgents);

      const { result } = renderHook(() => useSwarmAgents());

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.agents[0]?.status).toBe('working');

      mockAgentsList.mockResolvedValueOnce(refreshedAgents);

      await act(async () => {
        result.current.refresh();
        await Promise.resolve();
      });

      expect(result.current.agents[0]?.status).toBe('idle');
      expect(mockAgentsList).toHaveBeenCalledTimes(2);
    });
  });

  describe('WebSocket URL derivation', () => {
    it('should derive WS URL from window.location', () => {
      mockAgentsList.mockResolvedValue([]);
      renderHook(() => useSwarmAgents());

      expect(mockWs).not.toBeNull();
      // jsdom defaults to http://localhost so ws://
      expect(mockWs!.url).toMatch(/^ws:\/\//);
      expect(mockWs!.url).toContain('/api/agents/stream');
    });
  });
});
