/**
 * Tests for WS/SSE mutual exclusion in CommunicationContext.
 *
 * Invariant: at any point in time, at most ONE of the WS or SSE channels
 * is alive. Switching priority between 'real-time' and 'efficient' must
 * close the previously-active channel before opening the new one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  CommunicationProvider,
  useCommunicationStatus,
} from "../../src/contexts/CommunicationContext";

type WsHandler = ((event: { data: string }) => void) | null;

let liveWs: TrackedWs | null = null;
let liveSse: TrackedSse | null = null;

class TrackedWs {
  static readonly OPEN = 1;
  readyState = 0;
  onmessage: WsHandler = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  closedFlag = false;
  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    liveWs = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onmessage?.({ data: JSON.stringify({ type: "auth_challenge" }) });
    });
  }
  send(data: string) {
    const msg = JSON.parse(data) as { type: string };
    if (msg.type === "auth_response") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: "connected",
            sessionId: "s1",
            lastSeq: 0,
            serverTime: new Date().toISOString(),
          }),
        });
      });
    }
  }
  close() {
    this.readyState = 3;
    this.closedFlag = true;
    if (liveWs === this) liveWs = null;
  }
}

class TrackedSse {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = TrackedSse.CONNECTING;
  onerror: (() => void) | null = null;
  url: string;
  closedFlag = false;
  private listeners: Record<string, ((event: { data: string }) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    liveSse = this;
    queueMicrotask(() => {
      this.readyState = TrackedSse.OPEN;
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
  close() {
    this.readyState = TrackedSse.CLOSED;
    this.closedFlag = true;
    if (liveSse === this) liveSse = null;
  }
}

let originalWebSocket: typeof WebSocket;
let originalEventSource: typeof EventSource;

beforeEach(() => {
  localStorage.clear();
  originalWebSocket = globalThis.WebSocket;
  originalEventSource = globalThis.EventSource;
  globalThis.WebSocket = TrackedWs as unknown as typeof WebSocket;
  globalThis.EventSource = TrackedSse as unknown as typeof EventSource;
  liveWs = null;
  liveSse = null;
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

describe("CommunicationContext WS/SSE mutual exclusion", () => {
  it("should not have both WS and SSE alive at the same time", async () => {
    const { result } = renderHook(() => useCommunicationStatus(), { wrapper });
    await flushMicrotasks();
    // Real-time path → WS alive, SSE null
    expect(liveWs).not.toBeNull();
    expect(liveSse).toBeNull();
    expect(result.current.connectionStatus).toBe("websocket");
  });

  it("should close WS when switching to efficient (SSE)", async () => {
    const { result } = renderHook(() => useCommunicationStatus(), { wrapper });
    await flushMicrotasks();
    const initialWs = liveWs!;
    expect(initialWs.closedFlag).toBe(false);

    await act(async () => { result.current.setPriority("efficient"); });
    await flushMicrotasks();

    // Old WS must have been closed.
    expect(initialWs.closedFlag).toBe(true);
    // SSE must now be alive, WS must be cleared.
    expect(liveSse).not.toBeNull();
    expect(liveSse?.closedFlag).toBe(false);
  });

  it("should close SSE when switching back to real-time (WS)", async () => {
    localStorage.setItem("adjutant-comm-priority", "efficient");
    const { result } = renderHook(() => useCommunicationStatus(), { wrapper });
    await flushMicrotasks();
    const initialSse = liveSse!;
    expect(initialSse.closedFlag).toBe(false);

    await act(async () => { result.current.setPriority("real-time"); });
    await flushMicrotasks();

    expect(initialSse.closedFlag).toBe(true);
    expect(liveWs).not.toBeNull();
    expect(liveWs?.closedFlag).toBe(false);
  });

  it("should leave neither channel alive when switching to polling-only", async () => {
    const { result } = renderHook(() => useCommunicationStatus(), { wrapper });
    await flushMicrotasks();
    const initialWs = liveWs!;

    await act(async () => { result.current.setPriority("polling-only"); });
    await flushMicrotasks();

    expect(initialWs.closedFlag).toBe(true);
    expect(result.current.connectionStatus).toBe("polling");
  });

  it("should close WS in-flight when SSE fallback is triggered by auth failure", async () => {
    // Reconfigure WebSocket so auth_response → server returns auth_failed
    // The provider then calls startSSE() from inside the WS onmessage handler
    // (i.e. without a useEffect cleanup running). The mutex check in startSSE
    // must close the still-attached WS.
    let authFailWs: AuthFailWs | null = null;
    class AuthFailWs {
      static readonly OPEN = 1;
      readyState = 0;
      onmessage: WsHandler = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      url: string;
      closedFlag = false;
      constructor(url: string) {
        this.url = url;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        authFailWs = this;
        queueMicrotask(() => {
          this.readyState = 1;
          this.onmessage?.({ data: JSON.stringify({ type: "auth_challenge" }) });
        });
      }
      send(data: string) {
        const msg = JSON.parse(data) as { type: string };
        if (msg.type === "auth_response") {
          queueMicrotask(() => {
            this.onmessage?.({
              data: JSON.stringify({ type: "error", code: "auth_failed", message: "Invalid API key" }),
            });
          });
        }
      }
      close() { this.readyState = 3; this.closedFlag = true; }
    }
    globalThis.WebSocket = AuthFailWs as unknown as typeof WebSocket;

    const { result } = renderHook(() => useCommunicationStatus(), { wrapper });
    await flushMicrotasks();
    await flushMicrotasks();

    // After auth failure, provider must have fallen back to SSE.
    expect(result.current.connectionStatus).toBe("sse");
    // The WS must have been closed by the auth_failed branch.
    expect(authFailWs).not.toBeNull();
    expect(authFailWs!.closedFlag).toBe(true);
    // And an SSE must be alive.
    expect(liveSse).not.toBeNull();
    expect(liveSse?.closedFlag).toBe(false);
  });
});
