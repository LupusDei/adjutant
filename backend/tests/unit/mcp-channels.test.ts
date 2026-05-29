/**
 * Tests for MCP channel tools (adj-164.4.2).
 *
 * Tools: create_channel, list_channels, join_channel, leave_channel, plus the
 * send_message extension that targets a conversationId (channel post). Identity
 * is resolved SERVER-SIDE via getAgentBySession — never trusted from the client.
 *
 * Each tool gets ≥2 tests: a success path (correct result + side effects) and a
 * validation/error path (unknown session, missing params, or bad target).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import {
  createConversationStore,
  type ConversationStore,
} from "../../src/services/conversation-store.js";

// Mock logger
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock WS broadcasts
const mockWsBroadcast = vi.fn();
const mockWsBroadcastToConversation = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: (...args: unknown[]) => mockWsBroadcast(...args),
  wsBroadcastToConversation: (...args: unknown[]) => mockWsBroadcastToConversation(...args),
}));

// Mock APNS (channel sends do not push in v1)
vi.mock("../../src/services/apns-service.js", () => ({
  sendNotificationToAll: vi.fn().mockResolvedValue({ success: true }),
  isAPNsConfigured: vi.fn().mockReturnValue(false),
}));

// Mock server-side identity resolution
const mockGetAgentBySession = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: (...args: unknown[]) => mockGetAgentBySession(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

let db: Database.Database;
let messageStore: MessageStore;
let conversationStore: ConversationStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  messageStore = createMessageStore(db);
  conversationStore = createConversationStore(db, messageStore);
  vi.clearAllMocks();
  mockGetAgentBySession.mockReturnValue("raynor");
});

afterEach(() => {
  db.close();
});

async function getHandlers(): Promise<Map<string, Function>> {
  const { registerChannelTools } = await import("../../src/services/mcp-tools/channels.js");
  const handlers = new Map<string, Function>();
  const mockServer = {
    tool: (name: string, _schema: unknown, handler: Function) => {
      handlers.set(name, handler);
    },
  } as never;
  registerChannelTools(mockServer, conversationStore);
  return handlers;
}

// ============================================================================
// Tests
// ============================================================================

describe("registerChannelTools", () => {
  it("should register the four channel tools", async () => {
    const handlers = await getHandlers();
    expect(handlers.has("create_channel")).toBe(true);
    expect(handlers.has("list_channels")).toBe(true);
    expect(handlers.has("join_channel")).toBe(true);
    expect(handlers.has("leave_channel")).toBe(true);
  });
});

describe("create_channel tool", () => {
  it("should create a channel with the calling agent as owner", async () => {
    const handlers = await getHandlers();
    const result = await handlers.get("create_channel")!(
      { title: "ops" },
      { sessionId: "s1" },
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.channelId).toBeTruthy();
    expect(data.title).toBe("ops");

    const members = conversationStore.getMembers(data.channelId);
    expect(members.find((m) => m.memberId === "raynor")?.role).toBe("owner");
  });

  it("should return an error when the session is unknown", async () => {
    mockGetAgentBySession.mockReturnValue(undefined);
    const handlers = await getHandlers();
    const result = await handlers.get("create_channel")!(
      { title: "ops" },
      { sessionId: "ghost" },
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe("Unknown session");
  });

  it("should return an error when the title is empty", async () => {
    const handlers = await getHandlers();
    const result = await handlers.get("create_channel")!(
      { title: "   " },
      { sessionId: "s1" },
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
  });
});

describe("list_channels tool", () => {
  it("should list existing channels with member counts", async () => {
    conversationStore.createChannel({ title: "alpha", createdBy: "user" });
    const handlers = await getHandlers();

    const result = await handlers.get("list_channels")!({}, { sessionId: "s1" });
    const data = JSON.parse(result.content[0].text);

    expect(data.channels).toHaveLength(1);
    expect(data.channels[0].title).toBe("alpha");
    expect(data.channels[0].memberCount).toBe(1);
  });

  it("should return an empty list when no channels exist", async () => {
    const handlers = await getHandlers();
    const result = await handlers.get("list_channels")!({}, { sessionId: "s1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.channels).toEqual([]);
  });
});

describe("join_channel tool", () => {
  it("should add the calling agent to the channel", async () => {
    const channel = conversationStore.createChannel({ title: "team", createdBy: "user" });
    const handlers = await getHandlers();

    const result = await handlers.get("join_channel")!(
      { channelId: channel.id },
      { sessionId: "s1" },
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);

    const ids = conversationStore.getMembers(channel.id).map((m) => m.memberId);
    expect(ids).toContain("raynor");
  });

  it("should return an error when the channel does not exist", async () => {
    const handlers = await getHandlers();
    const result = await handlers.get("join_channel")!(
      { channelId: "nope" },
      { sessionId: "s1" },
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
  });

  it("should return an error when the session is unknown", async () => {
    mockGetAgentBySession.mockReturnValue(undefined);
    const channel = conversationStore.createChannel({ title: "team", createdBy: "user" });
    const handlers = await getHandlers();
    const result = await handlers.get("join_channel")!(
      { channelId: channel.id },
      { sessionId: "ghost" },
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe("Unknown session");
  });
});

describe("leave_channel tool", () => {
  it("should remove the calling agent from the channel", async () => {
    const channel = conversationStore.createChannel({ title: "team", createdBy: "user" });
    conversationStore.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });
    const handlers = await getHandlers();

    const result = await handlers.get("leave_channel")!(
      { channelId: channel.id },
      { sessionId: "s1" },
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);

    const ids = conversationStore.getMembers(channel.id).map((m) => m.memberId);
    expect(ids).not.toContain("raynor");
  });

  it("should return an error when the channel does not exist", async () => {
    const handlers = await getHandlers();
    const result = await handlers.get("leave_channel")!(
      { channelId: "nope" },
      { sessionId: "s1" },
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
  });
});

// ============================================================================
// send_message extension: conversationId (channel post)
// ============================================================================

async function getMessagingHandlers(): Promise<Map<string, Function>> {
  const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");
  const handlers = new Map<string, Function>();
  const mockServer = {
    tool: (name: string, _schema: unknown, handler: Function) => {
      handlers.set(name, handler);
    },
  } as never;
  // Conversation store passed so send_message can route channel posts.
  registerMessagingTools(mockServer, messageStore, undefined, conversationStore);
  return handlers;
}

describe("send_message tool — conversationId extension", () => {
  it("should post to a channel when conversationId targets a channel the sender is in", async () => {
    const channel = conversationStore.createChannel({ title: "team", createdBy: "user" });
    conversationStore.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    const handlers = await getMessagingHandlers();
    const result = await handlers.get("send_message")!(
      { to: channel.id, body: "ready", conversationId: channel.id },
      { sessionId: "s1" },
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.messageId).toBeTruthy();

    const scoped = messageStore.getMessages({ conversationId: channel.id });
    expect(scoped.some((m) => m.body === "ready" && m.agentId === "raynor")).toBe(true);
  });

  it("should fan out a channel post via wsBroadcastToConversation, not the global broadcast", async () => {
    const channel = conversationStore.createChannel({ title: "team", createdBy: "user" });
    conversationStore.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    const handlers = await getMessagingHandlers();
    await handlers.get("send_message")!(
      { to: channel.id, body: "hi room", conversationId: channel.id },
      { sessionId: "s1" },
    );

    expect(mockWsBroadcastToConversation).toHaveBeenCalledTimes(1);
    const [convId, msg] = mockWsBroadcastToConversation.mock.calls[0];
    expect(convId).toBe(channel.id);
    expect(msg.body).toBe("hi room");
    expect(msg.conversationId).toBe(channel.id);
    // The global, all-clients broadcast must NOT be used for channel posts.
    expect(mockWsBroadcast).not.toHaveBeenCalled();
  });

  it("should return an error when posting to a channel the sender is not a member of", async () => {
    const channel = conversationStore.createChannel({ title: "team", createdBy: "user" });
    // raynor (the resolved sender) is NOT a member.

    const handlers = await getMessagingHandlers();
    const result = await handlers.get("send_message")!(
      { to: channel.id, body: "intrude", conversationId: channel.id },
      { sessionId: "s1" },
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeTruthy();
    expect(mockWsBroadcastToConversation).not.toHaveBeenCalled();
  });

  it("should still use the legacy DM broadcast path when no conversationId is given", async () => {
    const handlers = await getMessagingHandlers();
    await handlers.get("send_message")!(
      { to: "user", body: "plain dm" },
      { sessionId: "s1" },
    );

    expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
    expect(mockWsBroadcastToConversation).not.toHaveBeenCalled();
  });
});
