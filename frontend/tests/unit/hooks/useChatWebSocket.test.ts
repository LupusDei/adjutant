import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatWebSocket } from '../../../src/hooks/useChatWebSocket';
import type { ChatWebSocketCallbacks } from '../../../src/hooks/useChatWebSocket';

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

  // Test helpers to simulate server messages
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
// Setup
// =============================================================================

let mockWs: MockWebSocket | null = null;

beforeEach(() => {
  mockWs = null;
  vi.stubGlobal('WebSocket', class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      mockWs = this;
    }
  });
  // Mock crypto.randomUUID
  vi.stubGlobal('crypto', {
    randomUUID: () => 'test-uuid-1234',
  });
  // Mock sessionStorage for API key
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// =============================================================================
// Tests
// =============================================================================

describe('useChatWebSocket', () => {
  const emptyCallbacks: ChatWebSocketCallbacks = {};

  describe('connection lifecycle', () => {
    it('should not connect when disabled', () => {
      renderHook(() => useChatWebSocket(false, emptyCallbacks));
      expect(mockWs).toBeNull();
    });

    it('should connect when enabled', async () => {
      renderHook(() => useChatWebSocket(true, emptyCallbacks));

      // WebSocket should be created
      expect(mockWs).not.toBeNull();
      expect(mockWs!.url).toContain('/ws/chat');
    });

    it('should respond to auth challenge', async () => {
      renderHook(() => useChatWebSocket(true, emptyCallbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());

      // Wait for WS to open
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      // Simulate auth challenge from server
      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
      });

      // Should have sent auth_response
      expect(mockWs!.sentMessages.length).toBeGreaterThan(0);
      const authMsg = JSON.parse(mockWs!.sentMessages[0]!) as { type: string };
      expect(authMsg.type).toBe('auth_response');
    });

    it('should set connected=true after auth success', async () => {
      const { result } = renderHook(() => useChatWebSocket(true, emptyCallbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      expect(result.current.connected).toBe(false);

      // Simulate successful auth flow
      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({
          type: 'connected',
          sessionId: 'test-session',
          lastSeq: 0,
          serverTime: new Date().toISOString(),
        });
      });

      expect(result.current.connected).toBe(true);
      expect(result.current.connectionStatus).toBe('websocket');
    });

    it('should set disconnected on close', async () => {
      const { result } = renderHook(() => useChatWebSocket(true, emptyCallbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      // Auth flow
      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({ type: 'connected', sessionId: 's', lastSeq: 0 });
      });

      expect(result.current.connected).toBe(true);

      // Simulate disconnect
      act(() => {
        mockWs!.simulateClose();
      });

      expect(result.current.connected).toBe(false);
    });

    it('should disconnect when disabled after being enabled', async () => {
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => useChatWebSocket(enabled, emptyCallbacks),
        { initialProps: { enabled: true } },
      );

      await vi.waitFor(() => expect(mockWs).not.toBeNull());

      // Disable
      rerender({ enabled: false });

      expect(result.current.connected).toBe(false);
      expect(result.current.connectionStatus).toBe('disconnected');
    });
  });

  describe('sending messages', () => {
    it('should return null when not connected', () => {
      const { result } = renderHook(() => useChatWebSocket(true, emptyCallbacks));

      // Not yet connected
      const id = result.current.sendMessage('hello');
      expect(id).toBeNull();
    });

    it('should send message and return client ID when connected', async () => {
      const { result } = renderHook(() => useChatWebSocket(true, emptyCallbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      // Complete auth
      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({ type: 'connected', sessionId: 's', lastSeq: 0 });
      });

      // Clear auth messages
      mockWs!.sentMessages = [];

      let id: string | null = null;
      act(() => {
        id = result.current.sendMessage('hello world', 'mayor/');
      });

      expect(id).not.toBeNull();
      expect(mockWs!.sentMessages).toHaveLength(1);

      const sent = JSON.parse(mockWs!.sentMessages[0]!) as { type: string; body: string; to: string };
      expect(sent.type).toBe('message');
      expect(sent.body).toBe('hello world');
      expect(sent.to).toBe('mayor/');
    });
  });

  describe('receiving messages', () => {
    it('should invoke onMessage callback for chat_message events', async () => {
      const onMessage = vi.fn();
      const callbacks: ChatWebSocketCallbacks = { onMessage };

      renderHook(() => useChatWebSocket(true, callbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      // Auth flow
      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({ type: 'connected', sessionId: 's', lastSeq: 0 });
      });

      // Receive a chat_message (persisted via SQLite)
      act(() => {
        mockWs!.simulateMessage({
          type: 'chat_message',
          id: 'msg-1',
          from: 'mayor/',
          to: 'overseer',
          body: 'Hello from mayor',
          timestamp: '2026-01-01T00:00:00Z',
          seq: 1,
        });
      });

      expect(onMessage).toHaveBeenCalledWith({
        id: 'msg-1',
        from: 'mayor/',
        to: 'overseer',
        body: 'Hello from mayor',
        timestamp: '2026-01-01T00:00:00Z',
        replyTo: undefined,
      });
    });

    it('should NOT invoke onMessage for legacy "message" type (session leak fix)', async () => {
      const onMessage = vi.fn();
      const callbacks: ChatWebSocketCallbacks = { onMessage };

      renderHook(() => useChatWebSocket(true, callbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      // Auth flow
      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({ type: 'connected', sessionId: 's', lastSeq: 0 });
      });

      // Legacy "message" type should be ignored
      act(() => {
        mockWs!.simulateMessage({
          type: 'message',
          id: 'msg-legacy',
          from: 'overseer',
          to: 'mayor/',
          body: 'Legacy message',
          timestamp: '2026-01-01T00:00:00Z',
          seq: 1,
        });
      });

      expect(onMessage).not.toHaveBeenCalled();
    });

    it('should invoke onDelivery for delivery confirmations', async () => {
      const onDelivery = vi.fn();
      const callbacks: ChatWebSocketCallbacks = { onDelivery };

      renderHook(() => useChatWebSocket(true, callbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({ type: 'connected', sessionId: 's', lastSeq: 0 });
      });

      act(() => {
        mockWs!.simulateMessage({
          type: 'delivered',
          messageId: 'server-msg-1',
          clientId: 'client-1',
          timestamp: '2026-01-01T00:00:00Z',
        });
      });

      expect(onDelivery).toHaveBeenCalledWith({
        messageId: 'server-msg-1',
        clientId: 'client-1',
        timestamp: '2026-01-01T00:00:00Z',
      });
    });

    it('should invoke onStreamToken for stream tokens', async () => {
      const onStreamToken = vi.fn();
      const callbacks: ChatWebSocketCallbacks = { onStreamToken };

      renderHook(() => useChatWebSocket(true, callbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({ type: 'connected', sessionId: 's', lastSeq: 0 });
      });

      act(() => {
        mockWs!.simulateMessage({
          type: 'stream_token',
          streamId: 'stream-1',
          token: 'Hello',
          seq: 1,
        });
      });

      expect(onStreamToken).toHaveBeenCalledWith({
        streamId: 'stream-1',
        token: 'Hello',
        seq: 1,
        done: false,
      });
    });

    it('should invoke onTyping for typing indicators', async () => {
      const onTyping = vi.fn();
      const callbacks: ChatWebSocketCallbacks = { onTyping };

      renderHook(() => useChatWebSocket(true, callbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({ type: 'connected', sessionId: 's', lastSeq: 0 });
      });

      act(() => {
        mockWs!.simulateMessage({
          type: 'typing',
          from: 'mayor/',
          state: 'started',
        });
      });

      expect(onTyping).toHaveBeenCalledWith({
        from: 'mayor/',
        state: 'started',
      });
    });
  });

  describe('typing indicator sending', () => {
    it('should send typing indicator when connected', async () => {
      const { result } = renderHook(() => useChatWebSocket(true, emptyCallbacks));

      await vi.waitFor(() => expect(mockWs).not.toBeNull());
      await vi.waitFor(() => expect(mockWs!.readyState).toBe(MockWebSocket.OPEN));

      act(() => {
        mockWs!.simulateMessage({ type: 'auth_challenge' });
        mockWs!.simulateMessage({ type: 'connected', sessionId: 's', lastSeq: 0 });
      });

      mockWs!.sentMessages = [];

      act(() => {
        result.current.sendTyping('started');
      });

      expect(mockWs!.sentMessages).toHaveLength(1);
      const sent = JSON.parse(mockWs!.sentMessages[0]!) as { type: string; state: string };
      expect(sent.type).toBe('typing');
      expect(sent.state).toBe('started');
    });
  });
});
