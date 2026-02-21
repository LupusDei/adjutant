import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatMessages } from '../../../src/hooks/useChatMessages';

// Mock the api module
vi.mock('../../../src/services/api', () => ({
  api: {
    messages: {
      list: vi.fn(),
      send: vi.fn(),
      markRead: vi.fn(),
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
import type { ChatMessage, PaginatedResponse } from '../../../src/types';

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: null,
    agentId: 'agent-1',
    recipient: 'user',
    role: 'agent',
    body: 'Hello from agent',
    metadata: null,
    deliveryStatus: 'delivered',
    eventType: null,
    threadId: null,
    createdAt: '2026-02-21T10:00:00Z',
    updatedAt: '2026-02-21T10:00:00Z',
    ...overrides,
  };
}

function mockListResponse(items: ChatMessage[], hasMore = false): PaginatedResponse<ChatMessage> {
  return { items, total: items.length, hasMore };
}

describe('useChatMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.messages.list as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockListResponse([])
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial fetch', () => {
    it('should fetch messages on mount', async () => {
      const msg = makeChatMessage({ agentId: 'agent-1' });
      (api.messages.list as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockListResponse([msg])
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.messages.list).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1' })
      );
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.id).toBe(msg.id);
    });

    it('should start in loading state', () => {
      const { result } = renderHook(() => useChatMessages('agent-1'));
      expect(result.current.isLoading).toBe(true);
    });

    it('should set error on fetch failure', async () => {
      (api.messages.list as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.error!.message).toBe('Network error');
    });

    it('should refetch when agentId changes', async () => {
      const msg1 = makeChatMessage({ agentId: 'agent-1', body: 'From 1' });
      const msg2 = makeChatMessage({ agentId: 'agent-2', body: 'From 2' });

      (api.messages.list as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockListResponse([msg1]))
        .mockResolvedValueOnce(mockListResponse([msg2]));

      const { result, rerender } = renderHook(
        ({ agentId }) => useChatMessages(agentId),
        { initialProps: { agentId: 'agent-1' } }
      );

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      rerender({ agentId: 'agent-2' });

      await waitFor(() => {
        expect(result.current.messages[0]?.body).toBe('From 2');
      });

      expect(api.messages.list).toHaveBeenCalledTimes(2);
    });
  });

  describe('WebSocket real-time messages', () => {
    it('should append new messages from WebSocket subscription', async () => {
      const existingMsg = makeChatMessage({ id: 'msg-1', body: 'Old' });
      (api.messages.list as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockListResponse([existingMsg])
      );

      // Capture the subscriber callback
      let subscriberCallback: ((msg: any) => void) | undefined;
      mockSubscribe.mockImplementation((cb: any) => {
        subscriberCallback = cb;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      // Simulate a WebSocket message arriving
      expect(subscriberCallback).toBeDefined();
      act(() => {
        subscriberCallback!({
          id: 'msg-2',
          from: 'agent-1',
          to: 'user',
          body: 'New WS message',
          timestamp: '2026-02-21T10:05:00Z',
        });
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1]!.body).toBe('New WS message');
    });

    it('should deduplicate messages by ID', async () => {
      const msg = makeChatMessage({ id: 'msg-dup', body: 'Original' });
      (api.messages.list as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockListResponse([msg])
      );

      let subscriberCallback: ((msg: any) => void) | undefined;
      mockSubscribe.mockImplementation((cb: any) => {
        subscriberCallback = cb;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      // Send duplicate via WebSocket
      act(() => {
        subscriberCallback!({
          id: 'msg-dup',
          from: 'agent-1',
          to: 'user',
          body: 'Original',
          timestamp: '2026-02-21T10:00:00Z',
        });
      });

      // Should still be only 1 message
      expect(result.current.messages).toHaveLength(1);
    });
  });

  describe('sendMessage (optimistic UI)', () => {
    it('should add optimistic message immediately before API call resolves', async () => {
      let resolveApiSend: ((v: any) => void) | undefined;
      (api.messages.send as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => { resolveApiSend = resolve; })
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Start sending - don't await
      let sendPromise: Promise<void>;
      act(() => {
        sendPromise = result.current.sendMessage('Hello, agent!');
      });

      // Optimistic message should appear immediately
      expect(result.current.messages).toHaveLength(1);
      const optimistic = result.current.messages[0]!;
      expect(optimistic.body).toBe('Hello, agent!');
      expect(optimistic.optimisticStatus).toBe('sending');
      expect(optimistic.role).toBe('user');
      expect(optimistic.id).toMatch(/^optimistic-/);

      // Resolve the API call
      await act(async () => {
        resolveApiSend!({ messageId: 'server-msg-1', timestamp: '2026-02-21T11:00:00Z' });
        await sendPromise!;
      });

      // Message should now be confirmed
      expect(result.current.messages[0]!.id).toBe('server-msg-1');
      expect(result.current.messages[0]!.optimisticStatus).toBe('delivered');
    });

    it('should mark optimistic message as failed on API error', async () => {
      (api.messages.send as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Send failed')
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        try {
          await result.current.sendMessage('Will fail');
        } catch {
          // Expected
        }
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.optimisticStatus).toBe('failed');
      expect(result.current.messages[0]!.body).toBe('Will fail');
    });

    it('should call API with correct params', async () => {
      (api.messages.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        messageId: 'new-msg',
        timestamp: '2026-02-21T11:00:00Z',
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('Hello, agent!');
      });

      expect(api.messages.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'agent-1',
          body: 'Hello, agent!',
        })
      );
    });

    it('should send with threadId when provided', async () => {
      (api.messages.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        messageId: 'new-msg',
        timestamp: '2026-02-21T11:00:00Z',
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('Threaded reply', 'thread-123');
      });

      expect(api.messages.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'agent-1',
          body: 'Threaded reply',
          threadId: 'thread-123',
        })
      );
    });
  });

  describe('confirmDelivery', () => {
    it('should update optimistic message with server ID and delivered status', async () => {
      // Set up a message with 'sending' status
      let resolveApiSend: ((v: any) => void) | undefined;
      (api.messages.send as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => { resolveApiSend = resolve; })
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Start sending (don't await, let it hang)
      act(() => {
        void result.current.sendMessage('Hello');
      });

      const clientId = result.current.messages[0]!.clientId!;
      expect(clientId).toBeDefined();

      // Manually confirm delivery (e.g., from WebSocket confirmation)
      act(() => {
        result.current.confirmDelivery(clientId, 'server-id-42');
      });

      expect(result.current.messages[0]!.id).toBe('server-id-42');
      expect(result.current.messages[0]!.optimisticStatus).toBe('delivered');

      // Clean up the pending promise
      resolveApiSend!({ messageId: 'server-id-42', timestamp: '2026-02-21T11:00:00Z' });
    });
  });

  describe('markFailed', () => {
    it('should mark an optimistic message as failed by clientId', async () => {
      let resolveApiSend: ((v: any) => void) | undefined;
      (api.messages.send as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => { resolveApiSend = resolve; })
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        void result.current.sendMessage('Will fail');
      });

      const clientId = result.current.messages[0]!.clientId!;

      act(() => {
        result.current.markFailed(clientId);
      });

      expect(result.current.messages[0]!.optimisticStatus).toBe('failed');

      // Clean up the pending promise
      resolveApiSend!({ messageId: 'whatever', timestamp: '2026-02-21T11:00:00Z' });
    });
  });

  describe('markRead', () => {
    it('should call API to mark message as read', async () => {
      (api.messages.markRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.markRead('msg-123');
      });

      expect(api.messages.markRead).toHaveBeenCalledWith('msg-123');
    });
  });

  describe('pagination (loadMore)', () => {
    it('should load older messages with before cursor', async () => {
      const initialMsg = makeChatMessage({
        id: 'msg-recent',
        createdAt: '2026-02-21T10:05:00Z',
        body: 'Recent',
      });
      const olderMsg = makeChatMessage({
        id: 'msg-old',
        createdAt: '2026-02-21T09:00:00Z',
        body: 'Older',
      });

      (api.messages.list as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockListResponse([initialMsg], true))
        .mockResolvedValueOnce(mockListResponse([olderMsg], false));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      // Should have called list with beforeId of the oldest message
      expect(api.messages.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          beforeId: 'msg-recent',
        })
      );

      // Should prepend older messages
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]!.id).toBe('msg-old');
    });
  });

  describe('no agentId', () => {
    it('should fetch all messages when no agentId provided', async () => {
      const msg = makeChatMessage();
      (api.messages.list as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockListResponse([msg])
      );

      const { result } = renderHook(() => useChatMessages());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.messages.list).toHaveBeenCalledWith(
        expect.objectContaining({})
      );
      expect(result.current.messages).toHaveLength(1);
    });
  });
});
