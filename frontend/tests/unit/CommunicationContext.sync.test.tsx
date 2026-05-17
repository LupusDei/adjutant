/**
 * Tests for sync_response handler in CommunicationContext.
 *
 * The server emits sync_response in reply to a 'sync' frame, carrying a
 * `missed` array of chat_message records the client missed while
 * disconnected. The client must:
 *   - unpack `missed[]`
 *   - dedup against the lastProcessedSeq watermark
 *   - dispatch each surviving message to subscribers, advancing the
 *     watermark per message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  CommunicationProvider,
  useCommunicationActions,
} from "../../src/contexts/CommunicationContext";

type WsHandler = ((event: { data: string }) => void) | null;
let lastMockWs: MockWebSocket | null = null;
let mockInitialLastSeq = 0;

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
  sentFrames: unknown[] = [];

  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastMockWs = this;
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onmessage?.({ data: JSON.stringify({ type: "auth_challenge" }) });
    });
  }

  send(data: string) {
    const parsed = JSON.parse(data) as { type: string };
    this.sentFrames.push(parsed);
    if (parsed.type === "auth_response") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: "connected",
            sessionId: "test-session",
            lastSeq: mockInitialLastSeq,
            serverTime: new Date().toISOString(),
          }),
        });
      });
    }
  }

  _inject(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = MockEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  url: string;
  private listeners: Record<string, ((event: { data: string }) => void)[]> = {};
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
    this.listeners[type] ??= [];
    this.listeners[type].push(handler);
  }
  removeEventListener(type: string, handler: (event: { data: string }) => void) {
    const arr = this.listeners[type];
    if (!arr) return;
    const idx = arr.indexOf(handler);
    if (idx >= 0) arr.splice(idx, 1);
  }
  close() { this.readyState = MockEventSource.CLOSED; }
}

let originalWebSocket: typeof WebSocket;
let originalEventSource: typeof EventSource;

beforeEach(() => {
  localStorage.clear();
  originalWebSocket = globalThis.WebSocket;
  originalEventSource = globalThis.EventSource;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  lastMockWs = null;
  mockInitialLastSeq = 0;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.EventSource = originalEventSource;
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <CommunicationProvider>{children}</CommunicationProvider>;
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("CommunicationContext sync_response handler", () => {
  it("should dispatch each message in missed[] to subscribers", async () => {
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: { id: string }[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    act(() => {
      lastMockWs!._inject({
        type: "sync_response",
        missed: [
          { type: "chat_message", id: "m1", from: "agent-x", to: "user", body: "one", timestamp: "2026-02-21T10:00:00Z", seq: 1 },
          { type: "chat_message", id: "m2", from: "agent-x", to: "user", body: "two", timestamp: "2026-02-21T10:00:01Z", seq: 2 },
          { type: "chat_message", id: "m3", from: "agent-x", to: "user", body: "three", timestamp: "2026-02-21T10:00:02Z", seq: 3 },
        ],
      });
    });

    expect(received.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("should dedup missed[] entries against the current watermark", async () => {
    mockInitialLastSeq = 2;
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: { id: string }[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    act(() => {
      lastMockWs!._inject({
        type: "sync_response",
        missed: [
          // seq 1, 2 are <= watermark — drop
          { type: "chat_message", id: "m1", from: "agent-x", to: "user", body: "one", timestamp: "2026-02-21T10:00:00Z", seq: 1 },
          { type: "chat_message", id: "m2", from: "agent-x", to: "user", body: "two", timestamp: "2026-02-21T10:00:01Z", seq: 2 },
          // seq 3, 4 are > watermark — keep
          { type: "chat_message", id: "m3", from: "agent-x", to: "user", body: "three", timestamp: "2026-02-21T10:00:02Z", seq: 3 },
          { type: "chat_message", id: "m4", from: "agent-x", to: "user", body: "four", timestamp: "2026-02-21T10:00:03Z", seq: 4 },
        ],
      });
    });

    expect(received.map((m) => m.id)).toEqual(["m3", "m4"]);
  });

  it("should advance the watermark so subsequent duplicates are dropped", async () => {
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: { id: string }[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    // First sync_response delivers seq 1..3
    act(() => {
      lastMockWs!._inject({
        type: "sync_response",
        missed: [
          { type: "chat_message", id: "m1", from: "agent-x", to: "user", body: "one", timestamp: "2026-02-21T10:00:00Z", seq: 1 },
          { type: "chat_message", id: "m2", from: "agent-x", to: "user", body: "two", timestamp: "2026-02-21T10:00:01Z", seq: 2 },
          { type: "chat_message", id: "m3", from: "agent-x", to: "user", body: "three", timestamp: "2026-02-21T10:00:02Z", seq: 3 },
        ],
      });
    });

    // A subsequent live chat_message with seq=2 should be dropped
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "dup-2",
        from: "agent-x",
        to: "user",
        body: "duplicate",
        timestamp: "2026-02-21T10:00:05Z",
        seq: 2,
      });
    });

    expect(received.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("should handle empty missed[] without throwing", async () => {
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: unknown[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    act(() => {
      lastMockWs!._inject({ type: "sync_response", missed: [] });
    });

    expect(received).toHaveLength(0);
  });

  it("should ignore sync_response with missing missed field", async () => {
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: unknown[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    // No throw despite missing field
    act(() => {
      lastMockWs!._inject({ type: "sync_response" });
    });

    expect(received).toHaveLength(0);
  });

  it("should dedup duplicates within the same missed[] payload", async () => {
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: { id: string }[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    // Same seq appears twice in payload — second should be dropped
    act(() => {
      lastMockWs!._inject({
        type: "sync_response",
        missed: [
          { type: "chat_message", id: "m1", from: "agent-x", to: "user", body: "one", timestamp: "2026-02-21T10:00:00Z", seq: 1 },
          { type: "chat_message", id: "m1-dup", from: "agent-x", to: "user", body: "dup", timestamp: "2026-02-21T10:00:01Z", seq: 1 },
          { type: "chat_message", id: "m2", from: "agent-x", to: "user", body: "two", timestamp: "2026-02-21T10:00:02Z", seq: 2 },
        ],
      });
    });

    expect(received.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
