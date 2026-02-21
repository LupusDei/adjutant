import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUnreadCounts } from '../../../src/hooks/useUnreadCounts';

// Mock the api module
vi.mock('../../../src/services/api', () => ({
  api: {
    messages: {
      getUnread: vi.fn(),
      markAllRead: vi.fn(),
    },
  },
}));

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

import { api } from '../../../src/services/api';

describe('useUnreadCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
      counts: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial fetch', () => {
    it('should fetch unread counts on mount', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
        counts: [
          { agentId: 'agent-1', count: 3 },
          { agentId: 'agent-2', count: 1 },
        ],
      });

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.messages.getUnread).toHaveBeenCalled();
      expect(result.current.counts.get('agent-1')).toBe(3);
      expect(result.current.counts.get('agent-2')).toBe(1);
      expect(result.current.totalUnread).toBe(4);
    });

    it('should start in loading state', () => {
      const { result } = renderHook(() => useUnreadCounts());
      expect(result.current.isLoading).toBe(true);
    });

    it('should set error on fetch failure', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.error!.message).toBe('Network error');
    });

    it('should exclude agents with zero count', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
        counts: [
          { agentId: 'agent-1', count: 0 },
          { agentId: 'agent-2', count: 5 },
        ],
      });

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.counts.has('agent-1')).toBe(false);
      expect(result.current.counts.get('agent-2')).toBe(5);
      expect(result.current.totalUnread).toBe(5);
    });
  });

  describe('real-time updates via WebSocket', () => {
    it('should increment count when a message arrives from an agent', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
        counts: [{ agentId: 'agent-1', count: 2 }],
      });

      let subscriberCallback: ((msg: any) => void) | undefined;
      mockSubscribe.mockImplementation((cb: any) => {
        subscriberCallback = cb;
        return vi.fn();
      });

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.counts.get('agent-1')).toBe(2);

      // Simulate incoming message from agent-1
      act(() => {
        subscriberCallback!({
          id: 'msg-1',
          from: 'agent-1',
          to: 'user',
          body: 'New message',
          timestamp: '2026-02-21T10:05:00Z',
        });
      });

      expect(result.current.counts.get('agent-1')).toBe(3);
      expect(result.current.totalUnread).toBe(3);
    });

    it('should create new entry for previously unseen agent', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
        counts: [],
      });

      let subscriberCallback: ((msg: any) => void) | undefined;
      mockSubscribe.mockImplementation((cb: any) => {
        subscriberCallback = cb;
        return vi.fn();
      });

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.totalUnread).toBe(0);

      act(() => {
        subscriberCallback!({
          id: 'msg-1',
          from: 'new-agent',
          to: 'user',
          body: 'Hello',
          timestamp: '2026-02-21T10:05:00Z',
        });
      });

      expect(result.current.counts.get('new-agent')).toBe(1);
      expect(result.current.totalUnread).toBe(1);
    });

    it('should NOT increment count for messages from user', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
        counts: [],
      });

      let subscriberCallback: ((msg: any) => void) | undefined;
      mockSubscribe.mockImplementation((cb: any) => {
        subscriberCallback = cb;
        return vi.fn();
      });

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // User sends a message — should not increment any count
      act(() => {
        subscriberCallback!({
          id: 'msg-1',
          from: 'user',
          to: 'agent-1',
          body: 'Outgoing',
          timestamp: '2026-02-21T10:05:00Z',
        });
      });

      expect(result.current.totalUnread).toBe(0);
    });
  });

  describe('markRead', () => {
    it('should clear count for agent and call API', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
        counts: [
          { agentId: 'agent-1', count: 5 },
          { agentId: 'agent-2', count: 2 },
        ],
      });
      (api.messages.markAllRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.totalUnread).toBe(7);

      await act(async () => {
        await result.current.markRead('agent-1');
      });

      expect(result.current.counts.has('agent-1')).toBe(false);
      expect(result.current.counts.get('agent-2')).toBe(2);
      expect(result.current.totalUnread).toBe(2);
      expect(api.messages.markAllRead).toHaveBeenCalledWith('agent-1');
    });

    it('should not modify counts for unknown agent', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
        counts: [{ agentId: 'agent-1', count: 3 }],
      });
      (api.messages.markAllRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.markRead('unknown-agent');
      });

      expect(result.current.counts.get('agent-1')).toBe(3);
      expect(result.current.totalUnread).toBe(3);
    });
  });

  describe('incrementCount', () => {
    it('should manually increment count for an agent', async () => {
      (api.messages.getUnread as ReturnType<typeof vi.fn>).mockResolvedValue({
        counts: [{ agentId: 'agent-1', count: 1 }],
      });

      const { result } = renderHook(() => useUnreadCounts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.incrementCount('agent-1');
      });

      expect(result.current.counts.get('agent-1')).toBe(2);
    });
  });
});
