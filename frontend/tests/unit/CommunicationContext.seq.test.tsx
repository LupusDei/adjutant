/**
 * Tests for client-side seq tracking in CommunicationContext.
 *
 * Verifies that:
 *   - The `connected` frame's `lastSeq` becomes the initial baseline.
 *   - A `chat_message` with `seq <= lastSeen` is dropped (not delivered).
 *   - A `chat_message` with `seq > lastSeen` is delivered and lastSeen
 *     advances.
 *   - A `chat_message` with no `seq` is delivered (legacy path: no dedup
 *     applied when the server didn't sequence it).
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

/** Initial lastSeq sent in the `connected` frame — overridable per test. */
let mockInitialLastSeq = 5;

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
  /** Captures every JSON sent to the server (auth, message, sync) */
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
  mockInitialLastSeq = 5;
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

describe("CommunicationContext seq tracking", () => {
  it("should drop a chat_message with seq <= lastSeq from the connected frame", async () => {
    mockInitialLastSeq = 10;
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: unknown[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    // seq = 5 (< 10) — stale, should be dropped
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "stale",
        from: "agent-x",
        to: "user",
        body: "old message",
        timestamp: "2026-02-21T10:00:00Z",
        seq: 5,
      });
    });

    // seq = 10 (== 10) — also stale, should be dropped
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "equal",
        from: "agent-x",
        to: "user",
        body: "same seq",
        timestamp: "2026-02-21T10:00:01Z",
        seq: 10,
      });
    });

    expect(received).toHaveLength(0);
  });

  it("should deliver a chat_message with seq > lastSeq and advance the watermark", async () => {
    mockInitialLastSeq = 10;
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: { id: string; seq?: number }[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    // seq = 11 — fresh, deliver and watermark advances to 11
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "fresh-1",
        from: "agent-x",
        to: "user",
        body: "new",
        timestamp: "2026-02-21T10:00:00Z",
        seq: 11,
      });
    });

    // seq = 11 again — should be DROPPED (already seen, watermark now at 11)
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "fresh-1-dup",
        from: "agent-x",
        to: "user",
        body: "dup",
        timestamp: "2026-02-21T10:00:01Z",
        seq: 11,
      });
    });

    // seq = 12 — fresh again
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "fresh-2",
        from: "agent-x",
        to: "user",
        body: "newer",
        timestamp: "2026-02-21T10:00:02Z",
        seq: 12,
      });
    });

    expect(received.map((m) => m.id)).toEqual(["fresh-1", "fresh-2"]);
  });

  it("should deliver chat_messages with no seq (legacy path)", async () => {
    mockInitialLastSeq = 10;
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: { id: string }[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    // No seq → should be delivered (legacy server without sequence numbering)
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "no-seq",
        from: "agent-x",
        to: "user",
        body: "no seq present",
        timestamp: "2026-02-21T10:00:00Z",
      });
    });

    expect(received.map((m) => m.id)).toEqual(["no-seq"]);
  });

  it("should treat 'connected' lastSeq=0 as 'no watermark yet' and accept seq=1", async () => {
    mockInitialLastSeq = 0;
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: { id: string }[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "seq-1",
        from: "agent-x",
        to: "user",
        body: "first",
        timestamp: "2026-02-21T10:00:00Z",
        seq: 1,
      });
    });

    expect(received.map((m) => m.id)).toEqual(["seq-1"]);
  });

  it("should advance lastSeen when a gap seq arrives (adj-dm83r)", async () => {
    // Regression: when the server skips a sequence number (packet loss
    // between server and client, or the server intentionally skips reserved
    // numbers), the client must accept the higher seq and advance the
    // watermark. Without this, all subsequent messages would be perpetually
    // "stale" and silently dropped.
    mockInitialLastSeq = 2;
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    const received: { id: string; seq?: number }[] = [];
    act(() => {
      result.current.subscribe((msg) => received.push(msg));
    });

    // seq = 5 arrives after baseline seq = 2 — gap of 3,4 was skipped or
    // lost. Client must still deliver the message and advance lastSeen → 5.
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "gap-5",
        from: "agent-x",
        to: "user",
        body: "msg5",
        timestamp: "2026-02-21T10:00:00Z",
        seq: 5,
      });
    });

    // Next message at seq = 6 must be delivered (proving lastSeen advanced
    // to 5, not stuck at 2). If the gap had been treated as an error and
    // lastSeen remained 2, seq=6 would have been delivered too — but the
    // critical assertion is that seq=3 (which is < new watermark 5) is
    // dropped.
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "seq-6",
        from: "agent-x",
        to: "user",
        body: "msg6",
        timestamp: "2026-02-21T10:00:01Z",
        seq: 6,
      });
    });

    // seq = 3 — would-be replay of an earlier message. Should be DROPPED
    // because the watermark has advanced past 3 (it's now at 6).
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "stale-3",
        from: "agent-x",
        to: "user",
        body: "msg3 (stale)",
        timestamp: "2026-02-21T10:00:02Z",
        seq: 3,
      });
    });

    // gap-5 and seq-6 delivered; stale-3 dropped.
    expect(received.map((m) => m.id)).toEqual(["gap-5", "seq-6"]);
  });

  it("should send a sync frame with lastSeqSeen after the connected handshake", async () => {
    mockInitialLastSeq = 0;
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    // Receive a chat_message with seq=7 — watermark advances
    act(() => {
      lastMockWs!._inject({
        type: "chat_message",
        id: "m7",
        from: "agent-x",
        to: "user",
        body: "msg7",
        timestamp: "2026-02-21T10:00:00Z",
        seq: 7,
      });
    });

    // sendMessage forces a frame to be sent — but we expect a sync frame to be
    // sent automatically after the connected handshake carrying the lastSeqSeen
    // watermark. Inspect the sentFrames captured by MockWebSocket.
    const syncFrames = lastMockWs!.sentFrames.filter(
      (f) => (f as { type?: string }).type === "sync",
    ) as { type: string; lastSeqSeen: number }[];

    expect(syncFrames.length).toBeGreaterThanOrEqual(1);
    // The most recent sync frame should reflect the highest watermark observed.
    // After the connected handshake the initial sync is lastSeqSeen=0; further
    // syncs (not required by spec) would carry 7. We only require: at least
    // one sync frame exists, with a numeric lastSeqSeen field.
    const first = syncFrames[0];
    expect(typeof first.lastSeqSeen).toBe("number");

    // Touch result to satisfy unused-var lint
    const unsub = result.current.subscribe(() => {});
    unsub();
  });
});
