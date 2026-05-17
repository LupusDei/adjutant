/**
 * Tests for the dev-only subscriber Set leak diagnostic.
 *
 * Both `subscribe()` and `subscribeTimeline()` keep their callbacks in a
 * `Set` so we can iterate quickly on incoming messages. The expected
 * lifecycle is mount → subscribe → return cleanup → unmount → unsubscribe.
 *
 * If a consumer forgets the unsubscribe call (or registers without a
 * matching cleanup), the Set grows unbounded across remounts and prevents
 * the original component trees from being GC'd. We can't fix that
 * automatically — instead, we warn loudly when the Set crosses a sane
 * upper bound so the developer sees it on first encounter.
 *
 * The diagnostic must be DEV-only (no noise in production).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  CommunicationProvider,
  useCommunicationActions,
  type IncomingChatMessage,
  type IncomingTimelineEvent,
} from "../../src/contexts/CommunicationContext";

// We never actually connect — but the provider tries to open a WebSocket.
// Mock WebSocket + EventSource so the test environment stays quiet.
class NoopWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = NoopWebSocket.CONNECTING;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  send() { /* no-op */ }
  close() { this.readyState = NoopWebSocket.CLOSED; }
}

class NoopEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = NoopEventSource.CONNECTING;
  url: string;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; }
  addEventListener() { /* no-op */ }
  removeEventListener() { /* no-op */ }
  close() { this.readyState = NoopEventSource.CLOSED; }
}

let originalWebSocket: typeof WebSocket;
let originalEventSource: typeof EventSource;

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket;
  originalEventSource = globalThis.EventSource;
  globalThis.WebSocket = NoopWebSocket as unknown as typeof WebSocket;
  globalThis.EventSource = NoopEventSource as unknown as typeof EventSource;
  vi.stubEnv("DEV", "true");
  // Force a dev-mode environment for import.meta.env.DEV checks.
  // (Vitest defaults DEV to true, but be explicit.)
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.EventSource = originalEventSource;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <CommunicationProvider>{children}</CommunicationProvider>;
}

describe("CommunicationContext subscriber-Set leak diagnostic", () => {
  it("warns when chat subscribers exceed 50 without unsubscribing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });

    // Subscribe 51 times WITHOUT calling the returned unsubscribe.
    const handlers: ((m: IncomingChatMessage) => void)[] = [];
    for (let i = 0; i < 51; i++) {
      const handler = (_m: IncomingChatMessage) => undefined;
      handlers.push(handler);
      result.current.subscribe(handler);
    }

    expect(warnSpy).toHaveBeenCalled();
    // Find the leak warning specifically (other warnings might be present).
    const leakCall = warnSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("subscriber Set"),
    );
    expect(leakCall).toBeDefined();
    expect(leakCall?.[0]).toMatch(/subscriber Set/);
  });

  it("does NOT warn at or below 50 subscribers", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });

    for (let i = 0; i < 50; i++) {
      result.current.subscribe(() => undefined);
    }

    const leakCall = warnSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("subscriber Set"),
    );
    expect(leakCall).toBeUndefined();
  });

  it("warns when timeline subscribers exceed 50 without unsubscribing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });

    for (let i = 0; i < 51; i++) {
      result.current.subscribeTimeline((_e: IncomingTimelineEvent) => undefined);
    }

    const leakCall = warnSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("subscriber Set"),
    );
    expect(leakCall).toBeDefined();
  });
});
