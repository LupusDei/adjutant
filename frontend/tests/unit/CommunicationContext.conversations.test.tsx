/**
 * Tests for room-scoped conversation subscriptions on the SHARED communication
 * connection (adj-83hau).
 *
 * Channels are membership + subscription gated by the backend
 * (`wsBroadcastToConversation`): a client receives a channel's live posts only
 * if it has sent a `{type:'subscribe',conversationId}` frame AND is a member.
 * DMs already ride the shared CommunicationContext connection; channels must do
 * the same so they inherit its WS→SSE→polling resilience instead of a separate
 * WS-only socket. CommunicationProvider therefore owns the subscribe frame and,
 * crucially, RE-SENDS desired subscriptions on every reconnect (the room
 * subscription is per-connection server-side and would otherwise be lost).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  CommunicationProvider,
  useCommunicationActions,
} from "../../src/contexts/CommunicationContext";

interface SentFrame {
  type: string;
  conversationId?: string;
  [k: string]: unknown;
}

/** A WebSocket test double that reports OPEN, records sends, and lets the test
 *  drive incoming server frames. Constructed instances are tracked statically
 *  so the test can reach the socket the provider opened internally. */
class ControllableWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: ControllableWebSocket[] = [];
  readyState = ControllableWebSocket.OPEN;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  sent: SentFrame[] = [];
  constructor(url: string) {
    this.url = url;
    ControllableWebSocket.instances.push(this);
  }
  send(raw: string) {
    try {
      this.sent.push(JSON.parse(raw) as SentFrame);
    } catch {
      /* ignore */
    }
  }
  close() {
    this.readyState = ControllableWebSocket.CLOSED;
  }
  /** Drive the server "connected" handshake frame. */
  emitConnected(lastSeq = 0) {
    this.onmessage?.({ data: JSON.stringify({ type: "connected", lastSeq }) });
  }
  framesOfType(type: string): SentFrame[] {
    return this.sent.filter((f) => f.type === type);
  }
}

/** The socket the provider most recently opened. */
function ws(): ControllableWebSocket | null {
  return ControllableWebSocket.instances.at(-1) ?? null;
}

let originalWebSocket: typeof WebSocket;
let originalEventSource: typeof EventSource;

class NoopEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = NoopEventSource.CONNECTING;
  url: string;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() { /* no-op */ }
  removeEventListener() { /* no-op */ }
  close() { /* no-op */ }
}

beforeEach(() => {
  ControllableWebSocket.instances = [];
  originalWebSocket = globalThis.WebSocket;
  originalEventSource = globalThis.EventSource;
  globalThis.WebSocket = ControllableWebSocket as unknown as typeof WebSocket;
  globalThis.EventSource = NoopEventSource as unknown as typeof EventSource;
  try {
    localStorage.setItem("adjutant-comm-priority", "real-time");
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.EventSource = originalEventSource;
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <CommunicationProvider>{children}</CommunicationProvider>;
}

describe("CommunicationContext conversation subscriptions (adj-83hau)", () => {
  it("sends a subscribe frame for the conversation when the socket is open", () => {
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    expect(ws()).not.toBeNull();
    act(() => {
      ws()!.emitConnected();
    });

    act(() => {
      result.current.subscribeConversation("chan-1");
    });

    const subs = ws()!.framesOfType("subscribe");
    expect(subs.some((f) => f.conversationId === "chan-1")).toBe(true);
  });

  it("re-sends desired subscriptions after a reconnect", () => {
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    act(() => {
      ws()!.emitConnected();
    });
    act(() => {
      result.current.subscribeConversation("chan-1");
    });

    // Simulate a reconnect: the SAME socket re-handshakes (or a fresh connected
    // frame arrives). The desired subscription must be re-sent automatically.
    const before = ws()!.framesOfType("subscribe").length;
    act(() => {
      ws()!.emitConnected();
    });
    const after = ws()!.framesOfType("subscribe").length;
    expect(after).toBeGreaterThan(before);
    expect(
      ws()!.framesOfType("subscribe").filter((f) => f.conversationId === "chan-1").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("stops re-sending after unsubscribeConversation", () => {
    const { result } = renderHook(() => useCommunicationActions(), { wrapper });
    act(() => {
      ws()!.emitConnected();
    });
    act(() => {
      result.current.subscribeConversation("chan-1");
    });
    act(() => {
      result.current.unsubscribeConversation("chan-1");
    });

    const unsubs = ws()!.framesOfType("unsubscribe");
    expect(unsubs.some((f) => f.conversationId === "chan-1")).toBe(true);

    // After unsubscribe, a reconnect must NOT re-subscribe the dropped channel.
    const subsBefore = ws()!
      .framesOfType("subscribe")
      .filter((f) => f.conversationId === "chan-1").length;
    act(() => {
      ws()!.emitConnected();
    });
    const subsAfter = ws()!
      .framesOfType("subscribe")
      .filter((f) => f.conversationId === "chan-1").length;
    expect(subsAfter).toBe(subsBefore);
  });
});
