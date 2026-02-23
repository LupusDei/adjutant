import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentStatus } from '../../../src/hooks/useAgentStatus';

// Mock CommunicationContext
const mockSubscribe = vi.fn(() => vi.fn());
vi.mock('../../../src/contexts/CommunicationContext', () => ({
  useCommunication: () => ({
    subscribe: mockSubscribe,
    connectionStatus: 'websocket',
    priority: 'real-time',
    setPriority: vi.fn(),
    sendMessage: vi.fn(),
  }),
}));

describe('useAgentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start with empty statuses', () => {
    const { result } = renderHook(() => useAgentStatus());
    expect(result.current.statuses.size).toBe(0);
  });

  it('should update status when receiving a typing event with metadata', () => {
    let subscriberCallback: ((msg: unknown) => void) | undefined;
    mockSubscribe.mockImplementation((cb: (msg: unknown) => void) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useAgentStatus());

    expect(subscriberCallback).toBeDefined();

    act(() => {
      // Simulate a status update via typing event (metadata carries agent progress)
      subscriberCallback!({
        id: 'status-1',
        from: 'agent-alpha',
        to: 'user',
        body: '',
        timestamp: '2026-02-21T10:00:00Z',
        metadata: {
          type: 'agent_status',
          status: 'working',
          task: 'Building frontend hooks',
          percentage: 50,
          beadId: 'adj-010.8.2',
        },
      });
    });

    const status = result.current.statuses.get('agent-alpha');
    expect(status).toBeDefined();
    expect(status!.status).toBe('working');
    expect(status!.task).toBe('Building frontend hooks');
    expect(status!.percentage).toBe(50);
    expect(status!.beadId).toBe('adj-010.8.2');
  });

  it('should update existing status for the same agent', () => {
    let subscriberCallback: ((msg: unknown) => void) | undefined;
    mockSubscribe.mockImplementation((cb: (msg: unknown) => void) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useAgentStatus());

    act(() => {
      subscriberCallback!({
        id: 's1',
        from: 'agent-beta',
        to: 'user',
        body: '',
        timestamp: '2026-02-21T10:00:00Z',
        metadata: {
          type: 'agent_status',
          status: 'working',
          task: 'Task A',
          percentage: 30,
        },
      });
    });

    act(() => {
      subscriberCallback!({
        id: 's2',
        from: 'agent-beta',
        to: 'user',
        body: '',
        timestamp: '2026-02-21T10:01:00Z',
        metadata: {
          type: 'agent_status',
          status: 'idle',
          task: 'Task A',
          percentage: 100,
        },
      });
    });

    const status = result.current.statuses.get('agent-beta');
    expect(status!.status).toBe('idle');
    expect(status!.percentage).toBe(100);
  });

  it('should track multiple agents independently', () => {
    let subscriberCallback: ((msg: unknown) => void) | undefined;
    mockSubscribe.mockImplementation((cb: (msg: unknown) => void) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useAgentStatus());

    act(() => {
      subscriberCallback!({
        id: 's1',
        from: 'agent-1',
        to: 'user',
        body: '',
        timestamp: '2026-02-21T10:00:00Z',
        metadata: { type: 'agent_status', status: 'working', task: 'Task 1' },
      });
      subscriberCallback!({
        id: 's2',
        from: 'agent-2',
        to: 'user',
        body: '',
        timestamp: '2026-02-21T10:00:00Z',
        metadata: { type: 'agent_status', status: 'idle', task: 'Task 2' },
      });
    });

    expect(result.current.statuses.size).toBe(2);
    expect(result.current.statuses.get('agent-1')!.status).toBe('working');
    expect(result.current.statuses.get('agent-2')!.status).toBe('idle');
  });

  it('should ignore messages without agent_status metadata type', () => {
    let subscriberCallback: ((msg: unknown) => void) | undefined;
    mockSubscribe.mockImplementation((cb: (msg: unknown) => void) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useAgentStatus());

    act(() => {
      // Regular message, no metadata.type = 'agent_status'
      subscriberCallback!({
        id: 'msg-1',
        from: 'agent-1',
        to: 'user',
        body: 'Hello',
        timestamp: '2026-02-21T10:00:00Z',
      });
    });

    expect(result.current.statuses.size).toBe(0);
  });

  it('should clean up subscription on unmount', () => {
    const unsubFn = vi.fn();
    mockSubscribe.mockImplementation(() => unsubFn);

    const { unmount } = renderHook(() => useAgentStatus());

    unmount();

    expect(unsubFn).toHaveBeenCalled();
  });
});
