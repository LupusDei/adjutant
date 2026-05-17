/**
 * Migration test: verify that hooks/components that only need actions
 * (sendMessage, subscribe, subscribeTimeline) do NOT re-render when
 * connectionStatus flips.
 *
 * adj-139.1.1.P / adj-uom3z — the split-context architecture (Track A) only
 * pays off if call sites use `useCommunicationActions()` instead of the
 * legacy `useCommunication()`. This test pins each migrated call site so
 * regressions to `useCommunication()` are caught.
 *
 * The render-count pattern mirrors `CommunicationContext.split.test.tsx`
 * lines 170-212.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { type ReactNode } from "react";

import { CommunicationProvider } from "../../src/contexts/CommunicationContext";
import { useChatMessages } from "../../src/hooks/useChatMessages";
import { useUnreadCounts } from "../../src/hooks/useUnreadCounts";
import { useAgentStatus } from "../../src/hooks/useAgentStatus";
import { useTimeline } from "../../src/hooks/useTimeline";
import { AnnouncementBanner } from "../../src/components/chat/AnnouncementBanner";

// =============================================================================
// Mock fetch + api — so hooks don't issue real network requests
// =============================================================================

beforeEach(() => {
  // Patch fetch so that any REST calls (api.messages.list, etc) resolve cleanly
  globalThis.fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          counts: [],
          events: [],
          hasMore: false,
        }),
      } as unknown as Response),
  );
});

// =============================================================================
// Mock WebSocket — drives connectionStatus changes
// =============================================================================

type WsHandler = ((event: { data: string }) => void) | null;
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastMockWs = this;
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
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
            sessionId: "test-session",
            lastSeq: 0,
            serverTime: new Date().toISOString(),
          }),
        });
      });
    }
  }

  _close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
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
    this.readyState = MockEventSource.CLOSED;
  }
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
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.EventSource = originalEventSource;
  vi.restoreAllMocks();
});

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// =============================================================================
// Generic render-count harness
// =============================================================================

/**
 * Mount a consumer inside CommunicationProvider, settle the initial connection,
 * flip the WS to closed (which causes connectionStatus to advance to
 * "reconnecting"), and assert the consumer's render count did not increase.
 *
 * If the consumer uses `useCommunication()` it WILL re-render on the flip.
 * If it uses `useCommunicationActions()` (or `useCommunicationStatus()` but
 * only reads actions) it WILL NOT.
 */
async function expectNoRerenderOnStatusChange(
  Consumer: () => React.ReactNode,
  renderCounter: { count: number },
): Promise<void> {
  function Wrapper({ children }: { children: ReactNode }) {
    return <CommunicationProvider>{children}</CommunicationProvider>;
  }

  render(
    <Wrapper>
      <Consumer />
    </Wrapper>,
  );

  await flushMicrotasks();
  await flushMicrotasks();

  const before = renderCounter.count;
  expect(before).toBeGreaterThan(0); // sanity: consumer mounted

  // Flip status: close the WS → onclose → reconnectAttempts++ → setConnectionStatus("reconnecting")
  act(() => {
    lastMockWs?._close();
  });
  await flushMicrotasks();

  // Drain microtasks again to be sure
  await flushMicrotasks();

  // Migration goal: consumer must NOT re-render when connectionStatus flips.
  expect(renderCounter.count).toBe(before);
}

// =============================================================================
// Per-hook assertions
// =============================================================================

describe("Call-site migration: hooks must not re-render on connectionStatus flip", () => {
  it("useChatMessages — stable across connectionStatus flips", async () => {
    const counter = { count: 0 };
    function Probe() {
      useChatMessages();
      counter.count++;
      return null;
    }
    await expectNoRerenderOnStatusChange(Probe, counter);
  });

  it("useUnreadCounts — stable across connectionStatus flips", async () => {
    const counter = { count: 0 };
    function Probe() {
      useUnreadCounts();
      counter.count++;
      return null;
    }
    await expectNoRerenderOnStatusChange(Probe, counter);
  });

  it("useAgentStatus — stable across connectionStatus flips", async () => {
    const counter = { count: 0 };
    function Probe() {
      useAgentStatus();
      counter.count++;
      return null;
    }
    await expectNoRerenderOnStatusChange(Probe, counter);
  });

  it("useTimeline — stable across connectionStatus flips", async () => {
    const counter = { count: 0 };
    function Probe() {
      useTimeline();
      counter.count++;
      return null;
    }
    await expectNoRerenderOnStatusChange(Probe, counter);
  });

  it("AnnouncementBanner — stable across connectionStatus flips", async () => {
    const counter = { count: 0 };
    function Probe() {
      counter.count++;
      return <AnnouncementBanner />;
    }
    await expectNoRerenderOnStatusChange(Probe, counter);
  });
});
