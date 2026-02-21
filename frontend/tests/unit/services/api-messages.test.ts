import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from '../../../src/services/api';
import type { ChatMessage, PaginatedResponse, UnreadCount, ChatThread } from '../../../src/types';

// Helper to create a mock ChatMessage
function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: null,
    agentId: 'agent-1',
    recipient: 'user',
    role: 'agent',
    body: 'Test message',
    metadata: null,
    deliveryStatus: 'delivered',
    eventType: null,
    threadId: null,
    createdAt: '2026-02-21T10:00:00Z',
    updatedAt: '2026-02-21T10:00:00Z',
    ...overrides,
  };
}

// Mock fetch globally
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
  // Clear sessionStorage for API key
  sessionStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockSuccessResponse<T>(data: T) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data, timestamp: new Date().toISOString() }),
  };
}

function mockErrorResponse(code: string, message: string, status = 400) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({
      success: false,
      error: { code, message },
      timestamp: new Date().toISOString(),
    }),
  };
}

describe('api.messages', () => {
  describe('list', () => {
    it('should fetch messages with no params', async () => {
      const msgs = [makeChatMessage()];
      const response: PaginatedResponse<ChatMessage> = {
        items: msgs,
        total: 1,
        hasMore: false,
      };
      mockFetch.mockResolvedValue(mockSuccessResponse(response));

      const result = await api.messages.list();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/messages');
      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });

    it('should pass agentId as query param', async () => {
      mockFetch.mockResolvedValue(
        mockSuccessResponse({ items: [], total: 0, hasMore: false })
      );

      await api.messages.list({ agentId: 'agent-1' });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('agentId=agent-1');
    });

    it('should pass beforeId as query param for pagination', async () => {
      mockFetch.mockResolvedValue(
        mockSuccessResponse({ items: [], total: 0, hasMore: false })
      );

      await api.messages.list({ beforeId: 'msg-123', limit: 50 });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('beforeId=msg-123');
      expect(url).toContain('limit=50');
    });

    it('should pass threadId as query param', async () => {
      mockFetch.mockResolvedValue(
        mockSuccessResponse({ items: [], total: 0, hasMore: false })
      );

      await api.messages.list({ threadId: 'thread-abc' });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('threadId=thread-abc');
    });

    it('should throw ApiError on server error', async () => {
      mockFetch.mockResolvedValue(
        mockErrorResponse('INTERNAL_ERROR', 'Server error', 500)
      );

      await expect(api.messages.list()).rejects.toThrow(ApiError);
    });
  });

  describe('get', () => {
    it('should fetch a single message by ID', async () => {
      const msg = makeChatMessage({ id: 'msg-42' });
      mockFetch.mockResolvedValue(mockSuccessResponse(msg));

      const result = await api.messages.get('msg-42');

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/messages/msg-42');
      expect(result.id).toBe('msg-42');
    });

    it('should encode special characters in message ID', async () => {
      const msg = makeChatMessage({ id: 'msg/special' });
      mockFetch.mockResolvedValue(mockSuccessResponse(msg));

      await api.messages.get('msg/special');

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/messages/msg%2Fspecial');
    });
  });

  describe('getUnread', () => {
    it('should fetch unread counts', async () => {
      const counts: UnreadCount[] = [
        { agentId: 'agent-1', count: 3 },
        { agentId: 'agent-2', count: 1 },
      ];
      mockFetch.mockResolvedValue(mockSuccessResponse({ counts }));

      const result = await api.messages.getUnread();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/messages/unread');
      expect(result.counts).toHaveLength(2);
      expect(result.counts[0]!.agentId).toBe('agent-1');
    });
  });

  describe('getThreads', () => {
    it('should fetch threads without agentId', async () => {
      const threads: ChatThread[] = [
        {
          threadId: 'thread-1',
          messageCount: 5,
          latestBody: 'Latest message',
          latestCreatedAt: '2026-02-21T10:00:00Z',
          agentId: 'agent-1',
        },
      ];
      mockFetch.mockResolvedValue(mockSuccessResponse({ threads }));

      const result = await api.messages.getThreads();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/messages/threads');
      expect(result.threads).toHaveLength(1);
    });

    it('should pass agentId for scoped threads', async () => {
      mockFetch.mockResolvedValue(mockSuccessResponse({ threads: [] }));

      await api.messages.getThreads('agent-1');

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('agentId=agent-1');
    });
  });

  describe('markRead', () => {
    it('should send PATCH to mark message as read', async () => {
      mockFetch.mockResolvedValue(mockSuccessResponse(undefined));

      await api.messages.markRead('msg-42');

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/messages/msg-42/read');
      expect(opts.method).toBe('PATCH');
    });
  });

  describe('markAllRead', () => {
    it('should send PATCH with agentId to mark all as read', async () => {
      mockFetch.mockResolvedValue(mockSuccessResponse(undefined));

      await api.messages.markAllRead('agent-1');

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/messages/read-all');
      expect(url).toContain('agentId=agent-1');
      expect(opts.method).toBe('PATCH');
    });
  });

  describe('send', () => {
    it('should POST a new message', async () => {
      mockFetch.mockResolvedValue(
        mockSuccessResponse({ messageId: 'new-msg', timestamp: '2026-02-21T11:00:00Z' })
      );

      const result = await api.messages.send({
        to: 'agent-1',
        body: 'Hello agent',
      });

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/messages');
      expect(opts.method).toBe('POST');
      const sentBody = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(sentBody['to']).toBe('agent-1');
      expect(sentBody['body']).toBe('Hello agent');
      expect(result.messageId).toBe('new-msg');
    });

    it('should include threadId and metadata when provided', async () => {
      mockFetch.mockResolvedValue(
        mockSuccessResponse({ messageId: 'new-msg', timestamp: '2026-02-21T11:00:00Z' })
      );

      await api.messages.send({
        to: 'agent-1',
        body: 'Threaded reply',
        threadId: 'thread-123',
        metadata: { priority: 'high' },
      });

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(sentBody['threadId']).toBe('thread-123');
      expect(sentBody['metadata']).toEqual({ priority: 'high' });
    });

    it('should throw ApiError on send failure', async () => {
      mockFetch.mockResolvedValue(
        mockErrorResponse('AGENT_OFFLINE', 'Agent is not connected')
      );

      await expect(
        api.messages.send({ to: 'agent-1', body: 'Test' })
      ).rejects.toThrow(ApiError);
    });
  });
});
