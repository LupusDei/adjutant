/**
 * Tests for the split CommunicationContext architecture.
 *
 * Verifies that:
 *   - Consumers of CommunicationActionsContext do NOT re-render when
 *     connectionStatus changes.
 *   - Consumers of CommunicationStatusContext DO re-render when
 *     connectionStatus changes.
 *   - `sendMessage`/`subscribe`/`subscribeTimeline` identities are stable
 *     across status changes (so memoization works).
 *   - The legacy `useCommunication()` hook still works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, renderHook } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import {
  CommunicationProvider,
  useCommunication,
  useCommunicationActions,
  useCommunicationStatus,
} from "../../src/contexts/CommunicationContext";

// =============================================================================
// Mock WebSocket — mirrors the auth handshake of /ws/chat
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

  /** Force connection close (drives reconnecting state) */
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
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  lastMockWs = null;
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

// =============================================================================
// Tests — split context
// =============================================================================

describe("CommunicationContext split", () => {
  describe("useCommunicationActions", () => {
    it("should expose sendMessage, subscribe, subscribeTimeline", () => {
      const { result } = renderHook(() => useCommunicationActions(), { wrapper });
      expect(typeof result.current.sendMessage).toBe("function");
      expect(typeof result.current.subscribe).toBe("function");
      expect(typeof result.current.subscribeTimeline).toBe("function");
    });

    it("should throw when used outside provider", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => {
        renderHook(() => useCommunicationActions());
      }).toThrow("useCommunicationActions must be used within a CommunicationProvider");
      consoleSpy.mockRestore();
    });

    it("should NOT re-render its consumer when connectionStatus changes", async () => {
      // ActionsConsumer counts its own renders. We then trigger a status
      // change via WS close (which flips connectionStatus to reconnecting).
      // The action consumer's render count must NOT increase.
      let actionsRenderCount = 0;

      function ActionsConsumer() {
        useCommunicationActions();
        actionsRenderCount++;
        return null;
      }

      // Also include a status consumer so we can prove the provider IS updating.
      let statusRenderCount = 0;
      function StatusConsumer() {
        useCommunicationStatus();
        statusRenderCount++;
        return null;
      }

      render(
        <CommunicationProvider>
          <ActionsConsumer />
          <StatusConsumer />
        </CommunicationProvider>
      );

      await flushMicrotasks();

      const actionsBefore = actionsRenderCount;
      const statusBefore = statusRenderCount;

      // Trigger a status change by closing the WS
      act(() => {
        lastMockWs?._close();
      });
      await flushMicrotasks();

      // Status consumer MUST have re-rendered
      expect(statusRenderCount).toBeGreaterThan(statusBefore);
      // Actions consumer MUST NOT have re-rendered
      expect(actionsRenderCount).toBe(actionsBefore);
    });

    it("should keep sendMessage identity stable across status changes", async () => {
      // Track identity of sendMessage across renders
      const identities: unknown[] = [];

      function Tracker() {
        const actions = useCommunicationActions();
        const initialRef = useRef(actions.sendMessage);
        // Record on each render — but we use ref to ensure stable initial too
        identities.push(actions.sendMessage);
        // touch the ref so eslint doesn't flag
        void initialRef.current;
        return null;
      }

      render(
        <CommunicationProvider>
          <Tracker />
        </CommunicationProvider>
      );

      await flushMicrotasks();

      const before = identities.length;
      const firstIdentity = identities[0];

      // Status change via WS close
      act(() => {
        lastMockWs?._close();
      });
      await flushMicrotasks();

      // After status changes, Tracker may or may not re-render. But if it does,
      // the sendMessage identity MUST equal the first identity.
      for (let i = before; i < identities.length; i++) {
        expect(identities[i]).toBe(firstIdentity);
      }
      // And the first identity itself must not be undefined
      expect(firstIdentity).toBeDefined();
    });

    it("should keep subscribe and subscribeTimeline identities stable", async () => {
      let firstSubscribe: unknown;
      let firstSubscribeTimeline: unknown;
      let latestSubscribe: unknown;
      let latestSubscribeTimeline: unknown;
      let renders = 0;

      function Tracker() {
        const actions = useCommunicationActions();
        renders++;
        if (renders === 1) {
          firstSubscribe = actions.subscribe;
          firstSubscribeTimeline = actions.subscribeTimeline;
        }
        latestSubscribe = actions.subscribe;
        latestSubscribeTimeline = actions.subscribeTimeline;
        return null;
      }

      render(
        <CommunicationProvider>
          <Tracker />
        </CommunicationProvider>
      );

      await flushMicrotasks();
      act(() => { lastMockWs?._close(); });
      await flushMicrotasks();

      expect(latestSubscribe).toBe(firstSubscribe);
      expect(latestSubscribeTimeline).toBe(firstSubscribeTimeline);
    });
  });

  describe("useCommunicationStatus", () => {
    it("should expose connectionStatus, priority, setPriority", () => {
      const { result } = renderHook(() => useCommunicationStatus(), { wrapper });
      expect(typeof result.current.priority).toBe("string");
      expect(typeof result.current.setPriority).toBe("function");
      expect(typeof result.current.connectionStatus).toBe("string");
    });

    it("should throw when used outside provider", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => {
        renderHook(() => useCommunicationStatus());
      }).toThrow("useCommunicationStatus must be used within a CommunicationProvider");
      consoleSpy.mockRestore();
    });

    it("should re-render its consumer when connectionStatus changes", async () => {
      let statusRenderCount = 0;
      const seenStatuses: string[] = [];
      function StatusConsumer() {
        const { connectionStatus } = useCommunicationStatus();
        statusRenderCount++;
        seenStatuses.push(connectionStatus);
        return null;
      }

      render(
        <CommunicationProvider>
          <StatusConsumer />
        </CommunicationProvider>
      );

      await flushMicrotasks();
      const before = statusRenderCount;

      act(() => { lastMockWs?._close(); });
      await flushMicrotasks();

      expect(statusRenderCount).toBeGreaterThan(before);
      // seenStatuses should include 'reconnecting' after close
      expect(seenStatuses).toContain("reconnecting");
    });
  });

  describe("backward compat: useCommunication", () => {
    it("should still return the merged value (priority, status, actions)", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      await flushMicrotasks();

      // All members from the original CommunicationContextValue must remain
      expect(typeof result.current.priority).toBe("string");
      expect(typeof result.current.setPriority).toBe("function");
      expect(typeof result.current.connectionStatus).toBe("string");
      expect(typeof result.current.sendMessage).toBe("function");
      expect(typeof result.current.subscribe).toBe("function");
      expect(typeof result.current.subscribeTimeline).toBe("function");
    });

    it("should still throw when used outside provider", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => {
        renderHook(() => useCommunication());
      }).toThrow("useCommunication must be used within a CommunicationProvider");
      consoleSpy.mockRestore();
    });
  });
});
