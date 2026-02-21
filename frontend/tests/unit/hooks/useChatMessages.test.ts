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

  describe('sendMessage', () => {
    it('should call API to send a message', async () => {
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
