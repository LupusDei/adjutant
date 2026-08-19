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
// Conversation store stub — returns members per conversation id and classifies
// conversations by kind. Shape matches ConversationStore.getMembers /
// getConversation (real row shape, camelCased).
//
// Kind classification (adj-2jy4u refinement): only channel-kind conversations
// are membership-gated for sync replay. DMs replay freely (they are broadcast
// to all authenticated clients and scoped client-side, adj-164.2). The stub
// derives kind from the id prefix so tests can exercise both branches:
//   - ids beginning with "dm_" (or any explicit `dmIds` entry) → kind: "dm"
//   - everything else with a membership entry → kind: "channel"
//   - ids with no membership entry → not found (getConversation returns null)
// ============================================================================

function makeConversationStore(
  membership: Record<string, string[]>,
  dmIds: string[] = [],
) {
  const isDm = (id: string) => id.startsWith("dm_") || dmIds.includes(id);
  return {
    getConversation: vi.fn((conversationId: string) => {
      // Unknown id (no membership entry and not a declared DM) → not found.
      if (!(conversationId in membership) && !dmIds.includes(conversationId)) {
        return null;
      }
      return {
        id: conversationId,
        kind: isDm(conversationId) ? "dm" : "channel",
        title: null,
        archived: false,
        createdAt: "2026-05-29T00:00:00Z",
        updatedAt: "2026-05-29T00:00:00Z",
      };
    }),
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
      expect(() => {
        ws._receiveMessage({ type: "subscribe" });
      }).not.toThrow();
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

    it("should NOT deliver to a non-member agent even if they subscribed", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      // chan-1 has only raynor; the connecting client identifies as a DIFFERENT
      // agent. Agents remain strictly membership-gated (fail-closed) — only the
      // operator carries the adj-egziw oversight exemption below.
      // Also pins adj-6fg1g: the Bridge gained a PULL-based read path into channels
      // it is not a member of (a coordinator-only tool surface). That must never
      // become a live fan-out exemption for ordinary agents.
      mod.setConversationStore(makeConversationStore({ "chan-1": ["raynor"] }) as never);

      const nonMember = connectAuthed("zeratul");
      nonMember._receiveMessage({ type: "subscribe", conversationId: "chan-1" });

      mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "leak", body: "secret" });

      expect(nonMember.findAllSent("chat_message").some((m) => m.id === "leak")).toBe(false);
    });

    // ========================================================================
    // adj-egziw: operator oversight exemption.
    //
    // Agent-created channels (MCP create_channel) seed only the creating agent
    // as a member, so the operator ("user") is NOT a member of most squad
    // channels. Every REST read surface already grants the operator full
    // history (GET /api/conversations/:id/messages has no membership gate), so
    // membership-gating the LIVE fan-out only made channels silently stale on
    // open clients (iOS/web) while pull-to-refresh worked. The operator is the
    // system owner — deliver to a subscribed operator client regardless of
    // membership. Agents stay fail-closed.
    // ========================================================================

    it("should deliver a channel post to the subscribed operator even when not a member (adj-egziw)", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      // Agent-created channel: only the creating agent is a member.
      mod.setConversationStore(makeConversationStore({ "chan-squad": ["raynor"] }) as never);

      const operator = connectAuthed("user");
      operator._receiveMessage({ type: "subscribe", conversationId: "chan-squad" });

      mod.wsBroadcastToConversation("chan-squad", {
        type: "chat_message",
        id: "squad-update",
        body: "live update the General must see",
        conversationId: "chan-squad",
      });

      expect(operator.findAllSent("chat_message").some((m) => m.id === "squad-update")).toBe(true);
    });

    it("should NOT deliver to the operator when they have not subscribed, member or not", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({ "chan-squad": ["raynor"] }) as never);

      // Operator connected but never subscribed — the room opt-in still applies,
      // so channel traffic never blasts every operator tab/device.
      const operator = connectAuthed("user");

      mod.wsBroadcastToConversation("chan-squad", { type: "chat_message", id: "unsub", body: "x" });

      expect(operator.findAllSent("chat_message").some((m) => m.id === "unsub")).toBe(false);
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

      expect(() => {
        mod.wsBroadcastToConversation("chan-1", { type: "chat_message", id: "x", body: "y" });
      }).not.toThrow();
      expect(ws.findAllSent("chat_message")).toHaveLength(0);
    });
  });

  // ==========================================================================
  // adj-2jy4u (P1 SECURITY): sync replay must be membership-scoped.
  //
  // Channel posts are buffered in the SAME global replay buffer used by `sync`.
  // The live `wsBroadcastToConversation` path is membership-scoped, but a
  // non-member who issues `{type:"sync", lastSeqSeen:N}` previously received the
  // buffered channel bodies because handleSync filtered ONLY by seq. That is a
  // cross-conversation information leak. Sync must re-apply the same membership
  // authorization boundary as live fan-out, and fail closed.
  // ==========================================================================
  describe("sync replay membership scoping (adj-2jy4u)", () => {
    it("should NOT replay a channel message to a non-member agent via sync", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      // chan-secret has only raynor as a member; "zeratul" is NOT a member.
      // (Agents are the security subject here — the operator carries the
      // adj-egziw oversight exemption, tested below.)
      mod.setConversationStore(makeConversationStore({ "chan-secret": ["raynor"] }) as never);

      // A member subscribes and triggers a channel post so it lands in the
      // replay buffer with a known seq.
      const member = connectAuthed("raynor");
      member._receiveMessage({ type: "subscribe", conversationId: "chan-secret" });
      mod.wsBroadcastToConversation("chan-secret", {
        type: "chat_message",
        id: "secret-body",
        body: "members only",
        conversationId: "chan-secret",
      });

      // A DIFFERENT client (the non-member agent) connects fresh and asks to
      // sync from the beginning. It must not receive the channel body.
      // (adj-6fg1g regression: the Bridge's non-member channel READ path must not
      // widen the sync/replay boundary for agents — adj-2jy4u stays closed.)
      const nonMember = connectAuthed("zeratul");
      nonMember._receiveMessage({ type: "sync", lastSeqSeen: 0 });

      const syncResp = nonMember.findSent("sync_response");
      expect(syncResp).toBeDefined();
      const missed = (syncResp!.missed ?? []) as Record<string, unknown>[];
      expect(missed.some((m) => m.id === "secret-body")).toBe(false);
    });

    it("should replay a channel message to the operator via sync even when not a member (adj-egziw)", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      // Agent-created channel: the operator is not in the member list, but the
      // sync/replay boundary must match the live fan-out's operator exemption —
      // otherwise a reconnecting operator silently loses exactly the messages
      // the live path is now allowed to deliver.
      mod.setConversationStore(makeConversationStore({ "chan-squad": ["raynor"] }) as never);

      const member = connectAuthed("raynor");
      member._receiveMessage({ type: "subscribe", conversationId: "chan-squad" });
      mod.wsBroadcastToConversation("chan-squad", {
        type: "chat_message",
        id: "operator-recovers",
        body: "squad chatter",
        conversationId: "chan-squad",
      });

      const operator = connectAuthed("user");
      operator._receiveMessage({ type: "sync", lastSeqSeen: 0 });

      const syncResp = operator.findSent("sync_response");
      expect(syncResp).toBeDefined();
      const missed = (syncResp!.missed ?? []) as Record<string, unknown>[];
      expect(missed.some((m) => m.id === "operator-recovers")).toBe(true);
    });

    it("should still replay a channel message to a member via sync", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({ "chan-secret": ["raynor"] }) as never);

      // First client posts to the channel (populates replay buffer).
      const poster = connectAuthed("raynor");
      poster._receiveMessage({ type: "subscribe", conversationId: "chan-secret" });
      mod.wsBroadcastToConversation("chan-secret", {
        type: "chat_message",
        id: "for-member",
        body: "members only",
        conversationId: "chan-secret",
      });

      // A second member client reconnects and syncs — it SHOULD recover the body.
      const reconnecting = connectAuthed("raynor");
      reconnecting._receiveMessage({ type: "sync", lastSeqSeen: 0 });

      const syncResp = reconnecting.findSent("sync_response");
      expect(syncResp).toBeDefined();
      const missed = (syncResp!.missed ?? []) as Record<string, unknown>[];
      expect(missed.some((m) => m.id === "for-member")).toBe(true);
    });

    it("should still replay non-conversation messages (e.g. DM broadcasts) to any client via sync", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      mod.setConversationStore(makeConversationStore({}) as never);

      // A global (non-conversation-scoped) broadcast — has no conversationId,
      // so it carries no membership requirement and must remain replayable.
      mod.wsBroadcast({ type: "chat_message", id: "global-1", body: "hello all" });

      const anyClient = connectAuthed("user");
      anyClient._receiveMessage({ type: "sync", lastSeqSeen: 0 });

      const syncResp = anyClient.findSent("sync_response");
      expect(syncResp).toBeDefined();
      const missed = (syncResp!.missed ?? []) as Record<string, unknown>[];
      expect(missed.some((m) => m.id === "global-1")).toBe(true);
    });

    it("should still replay a DM message to the user via sync even when conversation-scoped", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      // A DM conversation (kind="dm") between "user" and "raynor". DMs are NOT
      // membership-gated for replay — they are broadcast to all authenticated
      // clients and scoped client-side (adj-164.2). The refinement must let the
      // DM body replay even though it carries a conversationId.
      const dmId = "dm_userraynor";
      mod.setConversationStore(makeConversationStore({}, [dmId]) as never);

      mod.wsBroadcast({
        type: "chat_message",
        id: "dm-body",
        body: "private hello",
        conversationId: dmId,
      });

      const user = connectAuthed("user");
      user._receiveMessage({ type: "sync", lastSeqSeen: 0 });

      const syncResp = user.findSent("sync_response");
      expect(syncResp).toBeDefined();
      const missed = (syncResp!.missed ?? []) as Record<string, unknown>[];
      expect(missed.some((m) => m.id === "dm-body")).toBe(true);
    });

    it("should still replay a conversation-scoped DM via sync when no conversation store is configured", async () => {
      const mod = await loadModule();
      mod.initWebSocketServer({} as import("http").Server);
      // No conversation store wired (storeless deploy). The only
      // conversation-scoped traffic in that mode is DMs, which must still
      // replay — channels are always store-resolvable in production, so failing
      // OPEN here cannot leak a channel body while it preserves DM history
      // (adj-2jy4u refinement; the prior fail-closed behavior dropped legit DMs).
      mod.wsBroadcast({
        type: "chat_message",
        id: "storeless-dm",
        body: "x",
        conversationId: "dm_userraynor",
      });

      const client = connectAuthed("user");
      client._receiveMessage({ type: "sync", lastSeqSeen: 0 });

      const syncResp = client.findSent("sync_response");
      expect(syncResp).toBeDefined();
      const missed = (syncResp!.missed ?? []) as Record<string, unknown>[];
      expect(missed.some((m) => m.id === "storeless-dm")).toBe(true);
    });
  });
});
