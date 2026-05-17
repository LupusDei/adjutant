/**
 * Tests for SSE 'connected' listener cleanup in CommunicationContext.
 *
 * Regression: each priority toggle into 'efficient' creates a new
 * EventSource and registers an anonymous listener for the 'connected'
 * event. The old EventSource is closed but the anonymous listener has
 * no reference for removal, so it leaks. After 50 toggles, 50 stale
 * listeners pile up (each holding closure references to state setters
 * and the `mounted` flag — a real memory pressure source).
 *
 * Fix: register a NAMED handler and call removeEventListener before
 * close. This test spies on add/remove and asserts they balance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  CommunicationProvider,
  useCommunicationStatus,
} from "../../src/contexts/CommunicationContext";

type WsHandler = ((event: { data: string }) => void) | null;

class MockWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  onmessage: WsHandler = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; }
  send() {}
  close() { this.readyState = 3; }
}

/** Tracks add/remove listener calls for the 'connected' event. */
let connectedAddCount = 0;
let connectedRemoveCount = 0;
const liveSources: TrackingEventSource[] = [];

class TrackingEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = TrackingEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  url: string;
  closed = false;
  /** Map from event-type → array of listeners (still attached). */
  listeners = new Map<string, Set<(e: { data: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    liveSources.push(this);
    queueMicrotask(() => {
      this.readyState = TrackingEventSource.OPEN;
      const handlers = this.listeners.get("connected");
      if (handlers) {
        for (const h of handlers) {
          h({ data: JSON.stringify({ seq: 0, serverTime: new Date().toISOString() }) });
        }
      }
    });
  }

  addEventListener(type: string, handler: (e: { data: string }) => void) {
    if (type === "connected") connectedAddCount++;
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: (e: { data: string }) => void) {
    if (type === "connected") connectedRemoveCount++;
    this.listeners.get(type)?.delete(handler);
  }

  close() {
    this.closed = true;
    this.readyState = TrackingEventSource.CLOSED;
  }

  /** True if this source still has 'connected' listeners attached. */
  hasConnectedListener(): boolean {
    const set = this.listeners.get("connected");
    return !!set && set.size > 0;
  }
}

let originalWebSocket: typeof WebSocket;
let originalEventSource: typeof EventSource;

beforeEach(() => {
  localStorage.clear();
  // Force the provider down the SSE path by starting in 'efficient'
  localStorage.setItem("adjutant-comm-priority", "efficient");
  originalWebSocket = globalThis.WebSocket;
  originalEventSource = globalThis.EventSource;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  globalThis.EventSource = TrackingEventSource as unknown as typeof EventSource;
  connectedAddCount = 0;
  connectedRemoveCount = 0;
  liveSources.length = 0;
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

describe("CommunicationContext SSE 'connected' listener cleanup", () => {
  it("should not leak 'connected' listeners across priority toggles", async () => {
    const { result } = renderHook(() => useCommunicationStatus(), { wrapper });
    await flushMicrotasks();
    expect(result.current.connectionStatus).toBe("sse");

    // Toggle priority back and forth: efficient → polling-only → efficient → ...
    // Each return to 'efficient' creates a NEW EventSource. Each leaves
    // the previous one closed; previously the 'connected' listener was
    // anonymous and not removable.
    const toggleCount = 10;
    for (let i = 0; i < toggleCount; i++) {
      await act(async () => { result.current.setPriority("polling-only"); });
      await act(async () => { result.current.setPriority("efficient"); });
      await flushMicrotasks();
    }

    // For every closed EventSource we expect its 'connected' listener
    // to have been removed before close. After all toggles, no live
    // EventSource (except the most recent) should have a connected
    // listener still attached.
    const closed = liveSources.filter((s) => s.closed);
    expect(closed.length).toBeGreaterThanOrEqual(toggleCount - 1);
    for (const s of closed) {
      expect(s.hasConnectedListener()).toBe(false);
    }

    // Adds and removes must be balanced (each add has a matching remove
    // before close).
    expect(connectedRemoveCount).toBeGreaterThanOrEqual(connectedAddCount - 1);
  });
});
