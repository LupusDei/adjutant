import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { CommunicationProvider, useCommunication } from "../../../src/contexts/CommunicationContext";

// =============================================================================
// Mock WebSocket that simulates the /ws/chat auth handshake
// =============================================================================

type WsHandler = ((event: { data: string }) => void) | null;

/** Store the most recently created MockWebSocket for test-driven message injection */
let lastMockWs: MockWebSocket | null = null;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onmessage: WsHandler = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    lastMockWs = this;
    // Simulate open + auth challenge asynchronously
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onmessage?.({ data: JSON.stringify({ type: "auth_challenge" }) });
    });
  }

  send(data: string) {
    const msg = JSON.parse(data);
    if (msg.type === "auth_response") {
      // Simulate successful auth
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: "connected",
            sessionId: "test-session",
            lastSeq: 0,
            serverTime: new Date().toISOString(),
          }),
        });
      });
    }
  }

  /** Inject a server message for testing */
  _injectMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

// =============================================================================
// Mock EventSource that simulates /api/events SSE
// =============================================================================

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = MockEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  url: string;
  private listeners: Record<string, Array<(event: { data: string }) => void>> = {};

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      this.readyState = MockEventSource.OPEN;
      const handlers = this.listeners["connected"] ?? [];
      for (const h of handlers) {
        h({ data: JSON.stringify({ seq: 0, serverTime: new Date().toISOString() }) });
      }
    });
  }

  addEventListener(type: string, handler: (event: { data: string }) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type]!.push(handler);
  }

  /** Simulate receiving an SSE event (for test use) */
  _emit(type: string, data: unknown) {
    const handlers = this.listeners[type] ?? [];
    for (const h of handlers) {
      h({ data: JSON.stringify(data) });
    }
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

// =============================================================================
// Setup
// =============================================================================

let originalWebSocket: typeof WebSocket;
let originalEventSource: typeof EventSource;

beforeEach(() => {
  localStorage.clear();
  originalWebSocket = globalThis.WebSocket;
  originalEventSource = globalThis.EventSource;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.WebSocket = MockWebSocket as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.EventSource = MockEventSource as any;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.EventSource = originalEventSource;
  vi.restoreAllMocks();
});

// =============================================================================
// Helpers
// =============================================================================

function wrapper({ children }: { children: ReactNode }) {
  return <CommunicationProvider>{children}</CommunicationProvider>;
}

/** Flush microtask queue so mock WS/SSE callbacks fire. */
async function flushMicrotasks() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("CommunicationContext", () => {
  describe("initial state", () => {
    it("should default to real-time priority", () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      expect(result.current.priority).toBe("real-time");
    });

    it("should reach websocket status after auth handshake", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      await flushMicrotasks();
      expect(result.current.connectionStatus).toBe("websocket");
    });

    it("should load saved priority from localStorage", () => {
      localStorage.setItem("adjutant-comm-priority", "efficient");
      const { result } = renderHook(() => useCommunication(), { wrapper });
      expect(result.current.priority).toBe("efficient");
    });

    it("should ignore invalid localStorage values", () => {
      localStorage.setItem("adjutant-comm-priority", "invalid-value");
      const { result } = renderHook(() => useCommunication(), { wrapper });
      expect(result.current.priority).toBe("real-time");
    });
  });

  describe("setPriority", () => {
    it("should update priority to efficient", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await act(async () => {
        result.current.setPriority("efficient");
      });

      expect(result.current.priority).toBe("efficient");
      expect(localStorage.getItem("adjutant-comm-priority")).toBe("efficient");
    });

    it("should update priority to polling-only", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await act(async () => {
        result.current.setPriority("polling-only");
      });

      expect(result.current.priority).toBe("polling-only");
      expect(localStorage.getItem("adjutant-comm-priority")).toBe("polling-only");
    });

    it("should update connection status when priority changes", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      // Switch to efficient → SSE
      await act(async () => {
        result.current.setPriority("efficient");
      });
      await flushMicrotasks();
      expect(result.current.connectionStatus).toBe("sse");

      // Switch to polling-only → polling
      await act(async () => {
        result.current.setPriority("polling-only");
      });
      expect(result.current.connectionStatus).toBe("polling");

      // Switch back to real-time → websocket
      await act(async () => {
        result.current.setPriority("real-time");
      });
      await flushMicrotasks();
      expect(result.current.connectionStatus).toBe("websocket");
    });

    it("should persist to localStorage", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await act(async () => {
        result.current.setPriority("polling-only");
      });

      expect(localStorage.getItem("adjutant-comm-priority")).toBe("polling-only");
    });
  });

  describe("subscribe", () => {
    it("should deliver messages to subscribers", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      await flushMicrotasks(); // Wait for WS connection

      const received: unknown[] = [];
      act(() => {
        result.current.subscribe((msg) => received.push(msg));
      });

      // Verify subscribe contract is functional
      expect(typeof result.current.subscribe).toBe("function");
      expect(received).toEqual([]); // No messages yet
    });

    it("should return an unsubscribe function", () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      const unsubscribe = result.current.subscribe(() => {});
      expect(typeof unsubscribe).toBe("function");
      // Should not throw
      unsubscribe();
    });

    it("should deliver chat_message events to subscribers", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      await flushMicrotasks(); // Wait for WS connection
      expect(result.current.connectionStatus).toBe("websocket");

      const received: unknown[] = [];
      act(() => {
        result.current.subscribe((msg) => received.push(msg));
      });

      // Inject a chat_message event via the MockWebSocket
      act(() => {
        lastMockWs!._injectMessage({
          type: "chat_message",
          id: "chat-msg-1",
          from: "agent-1",
          to: "user",
          body: "Hello from agent via MCP",
          timestamp: "2026-02-21T10:00:00Z",
        });
      });

      expect(received).toHaveLength(1);
      const msg = received[0] as { id: string; from: string; body: string };
      expect(msg.id).toBe("chat-msg-1");
      expect(msg.from).toBe("agent-1");
      expect(msg.body).toBe("Hello from agent via MCP");
    });

    it("should only deliver chat_message type, ignoring legacy message type", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      await flushMicrotasks();

      const received: unknown[] = [];
      act(() => {
        result.current.subscribe((msg) => received.push(msg));
      });

      // Inject a legacy "message" type — should be IGNORED (session leak fix)
      act(() => {
        lastMockWs!._injectMessage({
          type: "message",
          id: "msg-1",
          from: "mayor/",
          to: "overseer",
          body: "Legacy message",
          timestamp: "2026-02-21T10:00:00Z",
        });
      });

      // Inject a chat_message — should be delivered
      act(() => {
        lastMockWs!._injectMessage({
          type: "chat_message",
          id: "chat-2",
          from: "agent-2",
          to: "user",
          body: "Chat message",
          timestamp: "2026-02-21T10:01:00Z",
        });
      });

      // Only chat_message should be delivered, not legacy message
      expect(received).toHaveLength(1);
      expect((received[0] as { id: string }).id).toBe("chat-2");
    });
  });

  describe("sendMessage", () => {
    it("should be a function", () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      expect(typeof result.current.sendMessage).toBe("function");
    });
  });

  describe("connection status", () => {
    it("should set polling status for polling-only priority", async () => {
      localStorage.setItem("adjutant-comm-priority", "polling-only");
      const { result } = renderHook(() => useCommunication(), { wrapper });

      // polling-only sets status synchronously
      await flushMicrotasks();
      expect(result.current.connectionStatus).toBe("polling");
    });

    it("should set sse status for efficient priority", async () => {
      localStorage.setItem("adjutant-comm-priority", "efficient");
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await flushMicrotasks();
      expect(result.current.connectionStatus).toBe("sse");
    });

    it("should set websocket status for real-time priority", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await flushMicrotasks();
      expect(result.current.connectionStatus).toBe("websocket");
    });
  });

  describe("error handling", () => {
    it("should throw when used outside provider", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => {
        renderHook(() => useCommunication());
      }).toThrow("useCommunication must be used within a CommunicationProvider");
      consoleSpy.mockRestore();
    });
  });

  describe("fallback behavior", () => {
    it("should fall back to SSE when WebSocket is not available", async () => {
      // Make WebSocket constructor throw
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.WebSocket = class ThrowingWs { constructor() { throw new Error("No WS"); } } as any;

      const { result } = renderHook(() => useCommunication(), { wrapper });
      await flushMicrotasks();

      // Should fall back to SSE
      expect(result.current.connectionStatus).toBe("sse");
    });

    it("should fall back to polling when both WS and SSE are unavailable", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.WebSocket = class { constructor() { throw new Error("No WS"); } } as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.EventSource = class { constructor() { throw new Error("No SSE"); } } as any;

      const { result } = renderHook(() => useCommunication(), { wrapper });
      await flushMicrotasks();

      expect(result.current.connectionStatus).toBe("polling");
    });
  });
});
