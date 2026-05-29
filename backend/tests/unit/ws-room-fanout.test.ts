/**
 * Tests for WebSocket room-scoped fan-out (adj-164.4.3).
 *
 * Channel posts must NOT blast every authenticated client. `wsBroadcastToConversation`
 * resolves the conversation's members via the conversation store and delivers ONLY
 * to clients whose authenticated identity is a member AND who have an active
 * subscription to that conversation. Non-members (or non-subscribers) get nothing.
 *
 * Subscribe/unsubscribe client messages maintain the per-client subscription set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Mock WebSocket infrastructure (mirrors ws-server.test.ts)
// ============================================================================

let connectionHandler: ((ws: MockWs) => void) | undefined;

class MockWs {
  readyState = 1; // OPEN
  private messageHandlers: ((raw: Buffer) => void)[] = [];
  private closeHandlers: (() => void)[] = [];
  private errorHandlers: ((err: Error) => void)[] = [];
  sentMessages: string[] = [];
  closed = false;

  on(event: string, handler: (...args: unknown[]) => void) {
    if (event === "message") this.messageHandlers.push(handler as (raw: Buffer) => void);
    if (event === "close") this.closeHandlers.push(handler as () => void);
    if (event === "error") this.errorHandlers.push(handler as (err: Error) => void);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  ping() {}

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  _receiveMessage(data: Record<string, unknown>) {
    const raw = Buffer.from(JSON.stringify(data));
    for (const h of this.messageHandlers) h(raw);
  }

  get sentParsed(): Record<string, unknown>[] {
    return this.sentMessages.map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  findSent(type: string): Record<string, unknown> | undefined {
    return this.sentParsed.find((m) => m.type === type);
  }

  findAllSent(type: string): Record<string, unknown>[] {
    return this.sentParsed.filter((m) => m.type === type);
  }
}

vi.mock("ws", () => {
  class MockWebSocketServer {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(_options: Record<string, unknown>) {}
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "connection") {
        connectionHandler = handler as (ws: MockWs) => void;
      }
    }
    close = vi.fn();
  }
  return { WebSocketServer: MockWebSocketServer, WebSocket: { OPEN: 1 } };
});

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));

vi.mock("../../src/services/api-key-service.js", () => ({
  hasApiKeys: () => false,
  validateApiKey: () => true,
}));

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => ({
    registry: { findByName: () => [], getAll: () => [] },
    connectClient: vi.fn().mockResolvedValue({ success: false }),
    disconnectClient: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn().mockResolvedValue(true),
    connector: { onOutput: vi.fn() },
  }),
}));

// ============================================================================
// Conversation store stub — returns members per conversation id.
// Shape matches ConversationStore.getMembers (real row shape, camelCased).
// ============================================================================

function makeConversationStore(membership: Record<string, string[]>) {
  return {
    getMembers: vi.fn((conversationId: string) =>
      (membership[conversationId] ?? []).map((memberId) => ({
        conversationId,
        memberId,
        memberKind: memberId === "user" ? "user" : "agent",
        role: "member",
        joinedAt: "2026-05-29T00:00:00Z",
        lastReadAt: null,
      })),
    ),
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function loadModule() {
  return import("../../src/services/ws-server.js");
}

/** Connect + authenticate a client; optionally with an identity for fan-out. */
function connectAuthed(identity?: string): MockWs {
  const ws = new MockWs();
  connectionHandler!(ws);
  ws._receiveMessage(identity ? { type: "auth_response", identity } : { type: "auth_response" });
  return ws;
}

// ============================================================================
// Tests
// ============================================================================

describe("ws-server room-scoped fan-out", () => {
  beforeEach(() => {
    connectionHandler = undefined;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const mod = await loadModule();
    mod.closeWsServer();
  });

  describe("subscribe / unsubscribe handlers", () => {
    it("should add a conversation to the client subscription set on subscribe", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({ "chan-1": ["user"] }) as never);

      const ws = connectAuthed("user");
      ws._receiveMessage({ type: "subscribe", conversationId: "chan-1" });

      // Confirm the subscription took effect by broadcasting to it.
      mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "m1", body: "hi" });
      expect(ws.findAllSent("chat_message").some((m) => m.id === "m1")).toBe(true);
    });

    it("should remove a conversation from the subscription set on unsubscribe", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({ "chan-1": ["user"] }) as never);

      const ws = connectAuthed("user");
      ws._receiveMessage({ type: "subscribe", conversationId: "chan-1" });
      ws._receiveMessage({ type: "unsubscribe", conversationId: "chan-1" });

      mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "m2", body: "hi" });
      expect(ws.findAllSent("chat_message").some((m) => m.id === "m2")).toBe(false);
    });

    it("should ignore a subscribe with no conversationId without crashing", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({}) as never);

      const ws = connectAuthed("user");
      expect(() => ws._receiveMessage({ type: "subscribe" })).not.toThrow();
    });
  });

  describe("wsBroadcastToConversation", () => {
    it("should deliver only to clients that are members AND subscribed", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({ "chan-1": ["user", "raynor"] }) as never);

      const memberSub = connectAuthed("user");
      memberSub._receiveMessage({ type: "subscribe", conversationId: "chan-1" });

      mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "deliver", body: "x" });

      const got = memberSub.findAllSent("chat_message");
      expect(got.some((m) => m.id === "deliver")).toBe(true);
    });

    it("should NOT deliver to a member who has not subscribed", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({ "chan-1": ["user"] }) as never);

      // Member identity but never subscribed.
      const memberNoSub = connectAuthed("user");

      mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "nope", body: "x" });

      expect(memberNoSub.findAllSent("chat_message").some((m) => m.id === "nope")).toBe(false);
    });

    it("should NOT deliver to a non-member even if they subscribed", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      // chan-1 has only raynor; the connecting client identifies as "user".
      mod.setConversationStore(makeConversationStore({ "chan-1": ["raynor"] }) as never);

      const nonMember = connectAuthed("user");
      nonMember._receiveMessage({ type: "subscribe", conversationId: "chan-1" });

      mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "leak", body: "secret" });

      expect(nonMember.findAllSent("chat_message").some((m) => m.id === "leak")).toBe(false);
    });

    it("should not deliver a channel post to a subscriber of a different conversation", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(
        makeConversationStore({ "chan-1": ["user"], "chan-2": ["user"] }) as never,
      );

      const ws = connectAuthed("user");
      ws._receiveMessage({ type: "subscribe", conversationId: "chan-2" });

      mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "wrong-room", body: "x" });

      expect(ws.findAllSent("chat_message").some((m) => m.id === "wrong-room")).toBe(false);
    });

    it("should assign a sequence number and buffer for replay", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({ "chan-1": ["user"] }) as never);

      const ws = connectAuthed("user");
      ws._receiveMessage({ type: "subscribe", conversationId: "chan-1" });

      mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "seqd", body: "x" });

      const msg = ws.findAllSent("chat_message").find((m) => m.id === "seqd");
      expect(msg).toBeDefined();
      expect(typeof msg!.seq).toBe("number");
    });

    it("should be a safe no-op when no conversation store is configured", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      // Deliberately do NOT set a conversation store.

      const ws = connectAuthed("user");
      ws._receiveMessage({ type: "subscribe", conversationId: "chan-1" });

      expect(() =>
        mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "x", body: "y" }),
      ).not.toThrow();
      expect(ws.findAllSent("chat_message")).toHaveLength(0);
    });
  });
});
