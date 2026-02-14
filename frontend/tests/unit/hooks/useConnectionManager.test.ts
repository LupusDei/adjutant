import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnectionManager } from "../../../src/hooks/useConnectionManager";

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });

  // Helpers for tests
  simulateOpen() {
    this.onopen?.();
  }

  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// Mock EventSource
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = MockEventSource.OPEN;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((event: { data: string }) => void)[]>();

  addEventListener(type: string, handler: (event: { data: string }) => void) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  // Helper
  simulateEvent(type: string, data: Record<string, unknown>) {
    const handlers = this.listeners.get(type) ?? [];
    for (const handler of handlers) {
      handler({ data: JSON.stringify(data) });
    }
  }
}

let mockWsInstance: MockWebSocket | null = null;
let mockEsInstance: MockEventSource | null = null;

describe("useConnectionManager", () => {
  beforeEach(() => {
    mockWsInstance = null;
    mockEsInstance = null;

    // Mock WebSocket constructor
    vi.stubGlobal("WebSocket", class extends MockWebSocket {
      constructor() {
        super();
        mockWsInstance = this;
      }
    });

    // Mock EventSource constructor
    vi.stubGlobal("EventSource", class extends MockEventSource {
      constructor() {
        super();
        mockEsInstance = this;
      }
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
  });

  it("should start in disconnected/http state when inactive", () => {
    const { result } = renderHook(() => useConnectionManager(false));

    expect(result.current.method).toBe("http");
    expect(result.current.state).toBe("disconnected");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingMessage).toBeNull();
  });

  it("should attempt WebSocket connection when active", () => {
    renderHook(() => useConnectionManager(true));

    expect(mockWsInstance).not.toBeNull();
  });

  it("should transition to ws/connected when WS auth succeeds", () => {
    const { result } = renderHook(() => useConnectionManager(true));

    act(() => {
      mockWsInstance!.simulateOpen();
    });

    // Auth response is sent
    expect(mockWsInstance!.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"auth_response"')
    );

    // Simulate server accepting auth
    act(() => {
      mockWsInstance!.simulateMessage({
        type: "connected",
        sessionId: "test-session",
        lastSeq: 0,
      });
    });

    expect(result.current.method).toBe("ws");
    expect(result.current.state).toBe("connected");
  });

  it("should track streaming state from stream tokens", () => {
    const { result } = renderHook(() => useConnectionManager(true));

    // Connect WS
    act(() => {
      mockWsInstance!.simulateOpen();
      mockWsInstance!.simulateMessage({ type: "connected", sessionId: "s1" });
    });

    // Receive stream token
    act(() => {
      mockWsInstance!.simulateMessage({
        type: "stream_token",
        streamId: "stream-1",
        token: "Hello ",
        seq: 1,
      });
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingMessage).toEqual({
      streamId: "stream-1",
      tokens: "Hello ",
      done: false,
    });

    // Receive more tokens
    act(() => {
      mockWsInstance!.simulateMessage({
        type: "stream_token",
        streamId: "stream-1",
        token: "world!",
        seq: 2,
      });
    });

    expect(result.current.streamingMessage?.tokens).toBe("Hello world!");

    // Stream ends
    act(() => {
      mockWsInstance!.simulateMessage({
        type: "stream_end",
        streamId: "stream-1",
        done: true,
      });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingMessage?.done).toBe(true);
  });

  it("should call message handlers for incoming messages", () => {
    const { result } = renderHook(() => useConnectionManager(true));
    const handler = vi.fn();

    // Register handler
    const unsubscribe = result.current.onMessage(handler);

    // Connect WS
    act(() => {
      mockWsInstance!.simulateOpen();
      mockWsInstance!.simulateMessage({ type: "connected", sessionId: "s1" });
    });

    // Receive message
    act(() => {
      mockWsInstance!.simulateMessage({
        type: "message",
        from: "mayor/",
        body: "test message",
      });
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "message", body: "test message" })
    );

    // Unsubscribe
    unsubscribe();

    act(() => {
      mockWsInstance!.simulateMessage({
        type: "message",
        body: "should not be received",
      });
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should send message over WebSocket", () => {
    const { result } = renderHook(() => useConnectionManager(true));

    // Connect WS
    act(() => {
      mockWsInstance!.simulateOpen();
      mockWsInstance!.simulateMessage({ type: "connected", sessionId: "s1" });
    });

    // Send message
    act(() => {
      result.current.sendMessage("mayor/", "hello");
    });

    // Second call (first was auth)
    expect(mockWsInstance!.send).toHaveBeenCalledTimes(2);
    const sentData = JSON.parse(mockWsInstance!.send.mock.calls[1]![0] as string) as Record<string, unknown>;
    expect(sentData).toEqual(
      expect.objectContaining({
        type: "message",
        to: "mayor/",
        body: "hello",
      })
    );
  });

  it("should clean up connections when deactivated", () => {
    const { rerender } = renderHook(
      ({ active }) => useConnectionManager(active),
      { initialProps: { active: true } }
    );

    // Connect
    act(() => {
      mockWsInstance!.simulateOpen();
      mockWsInstance!.simulateMessage({ type: "connected", sessionId: "s1" });
    });

    const ws = mockWsInstance!;

    // Deactivate
    rerender({ active: false });

    expect(ws.close).toHaveBeenCalled();
  });
});
