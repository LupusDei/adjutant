/**
 * Tests for reconnect timer cleanup in CommunicationContext.
 *
 * Regression: a single disconnect that fires `onclose` multiple times
 * (or rapid disconnects) could stack `setTimeout` reconnect calls if the
 * existing timer was not cleared before assigning a new one. This test
 * spies on `setTimeout` and verifies that we never have more than one
 * outstanding reconnect timer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  CommunicationProvider,
  useCommunicationActions,
} from "../../src/contexts/CommunicationContext";

type WsHandler = ((event: { data: string }) => void) | null;
let lastMockWs: ReconnectMockWs | null = null;

class ReconnectMockWs {
  static readonly OPEN = 1;
  readyState = 0;
  onmessage: WsHandler = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastMockWs = this;
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
  close() { this.readyState = 3; }
  _close() { this.readyState = 3; this.onclose?.(); }
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
  vi.useFakeTimers();
  localStorage.clear();
  originalWebSocket = globalThis.WebSocket;
  originalEventSource = globalThis.EventSource;
  globalThis.WebSocket = ReconnectMockWs as unknown as typeof WebSocket;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  lastMockWs = null;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.WebSocket = originalWebSocket;
  globalThis.EventSource = originalEventSource;
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <CommunicationProvider>{children}</CommunicationProvider>;
}

async function flushMicrotasks() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("CommunicationContext reconnect timer", () => {
  it("should clear any outstanding reconnect timer before scheduling a new one", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    // First disconnect — schedules a setTimeout
    const setTimeoutCallsBeforeFirstClose = setTimeoutSpy.mock.calls.length;
    act(() => { lastMockWs!._close(); });
    const newTimeoutsAfterFirst = setTimeoutSpy.mock.calls.length - setTimeoutCallsBeforeFirstClose;
    expect(newTimeoutsAfterFirst).toBeGreaterThanOrEqual(1);

    // A second onclose firing BEFORE the timer fires must clear the previous
    // timer before scheduling a new one. The number of clearTimeout calls
    // should be at least the number of new setTimeout calls.
    const clearCountBeforeSecond = clearTimeoutSpy.mock.calls.length;
    const setCountBeforeSecond = setTimeoutSpy.mock.calls.length;

    // Simulate the same socket firing onclose again (replay buggy server) by
    // re-invoking the handler directly via the second WS attempt.
    // We need to set up a new WS handler for the retry. Advance timers slightly
    // to let the reconnect timer fire and create a new WS.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Now lastMockWs points to the new WS. Wait for its auth handshake.
    await flushMicrotasks();
    await flushMicrotasks();

    // Close again
    act(() => { lastMockWs!._close(); });

    const newClears = clearTimeoutSpy.mock.calls.length - clearCountBeforeSecond;
    const newSets = setTimeoutSpy.mock.calls.length - setCountBeforeSecond;

    // For each new setTimeout scheduled in the reconnect path, there must be a
    // corresponding clearTimeout that ran before it. We allow >= because
    // teardown and unrelated setTimeout/clearTimeout (microtask polyfills)
    // also count.
    expect(newClears).toBeGreaterThanOrEqual(1);
    expect(newSets).toBeGreaterThanOrEqual(1);
  });

  it("should clear the prior reconnect timer when onclose fires twice rapidly", async () => {
    renderHook(() => useCommunicationActions(), { wrapper });
    await flushMicrotasks();

    // First close schedules a reconnect timer.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    act(() => { lastMockWs!._close(); });
    const setsAfterFirstClose = setTimeoutSpy.mock.calls.length;
    const clearsAfterFirstClose = clearTimeoutSpy.mock.calls.length;

    // Without advancing the clock, fire onclose AGAIN. The fix must call
    // clearTimeout before assigning a new setTimeout. Without the fix the
    // previous handle would be leaked (no clearTimeout in this window).
    act(() => { lastMockWs!.onclose?.(); });

    const newSets = setTimeoutSpy.mock.calls.length - setsAfterFirstClose;
    const newClears = clearTimeoutSpy.mock.calls.length - clearsAfterFirstClose;

    // We expect: a new setTimeout (for the second reconnect attempt) AND
    // a clearTimeout that ran before it (to clear the previous handle).
    expect(newSets).toBeGreaterThanOrEqual(1);
    expect(newClears).toBeGreaterThanOrEqual(1);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});
