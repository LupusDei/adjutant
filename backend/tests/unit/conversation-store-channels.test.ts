/**
 * Tests for ConversationStore channel methods (adj-164.4.1).
 *
 * Channels reuse the unified conversation model: a channel is a conversation
 * with `kind='channel'` and N members. These methods are thin, intention-
 * revealing wrappers over the existing conversation/member primitives plus the
 * message store, so the same data layer serves DMs and channels (Constitution
 * Rule 9 — no parallel system).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import {
  createConversationStore,
  type ConversationStore,
} from "../../src/services/conversation-store.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";

let db: Database.Database;
let store: ConversationStore;
let messageStore: MessageStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  messageStore = createMessageStore(db);
  // The conversation store is given the message store so postToChannel can
  // persist messages without the caller reaching across layers.
  store = createConversationStore(db, messageStore);
});

afterEach(() => {
  db.close();
});

describe("ConversationStore.createChannel", () => {
  it("should create a channel conversation with the creator as an owner member", () => {
    const channel = store.createChannel({ title: "ops", createdBy: "raynor" });

    expect(channel.kind).toBe("channel");
    expect(channel.title).toBe("ops");
    expect(channel.archived).toBe(false);

    const members = store.getMembers(channel.id);
    expect(members).toHaveLength(1);
    expect(members[0]?.memberId).toBe("raynor");
    expect(members[0]?.role).toBe("owner");
    expect(members[0]?.memberKind).toBe("agent");
  });

  it("should infer member_kind 'user' when the creator is the literal user", () => {
    const channel = store.createChannel({ title: "general", createdBy: "user" });
    const creator = store.getMembers(channel.id)[0];
    expect(creator?.memberKind).toBe("user");
    expect(creator?.role).toBe("owner");
  });

  it("should add additional initial members when provided", () => {
    const channel = store.createChannel({
      title: "war-room",
      createdBy: "user",
      initialMembers: [
        { memberId: "raynor", memberKind: "agent" },
        { memberId: "kerrigan", memberKind: "agent" },
      ],
    });
    const ids = store.getMembers(channel.id).map((m) => m.memberId).sort();
    expect(ids).toEqual(["kerrigan", "raynor", "user"]);
  });

  it("should reject a channel with an empty title", () => {
    expect(() => store.createChannel({ title: "  ", createdBy: "user" })).toThrow();
  });
});

describe("ConversationStore.listChannels", () => {
  it("should return only channel conversations, not DMs", () => {
    store.createChannel({ title: "c1", createdBy: "user" });
    store.getOrCreateDm("user", "raynor");

    const channels = store.listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0]?.kind).toBe("channel");
    expect(channels[0]?.title).toBe("c1");
  });

  it("should return an empty array when no channels exist", () => {
    store.getOrCreateDm("user", "raynor");
    expect(store.listChannels()).toEqual([]);
  });

  it("should include a member count for each channel", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    const channels = store.listChannels();
    expect(channels[0]?.memberCount).toBe(2);
  });
});

describe("ConversationStore.joinChannel", () => {
  it("should add a member to a channel", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    const ids = store.getMembers(channel.id).map((m) => m.memberId).sort();
    expect(ids).toEqual(["raynor", "user"]);
  });

  it("should be idempotent when the same member joins twice", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });
    expect(store.getMembers(channel.id)).toHaveLength(2);
  });

  it("should throw when the channel does not exist", () => {
    expect(() =>
      store.joinChannel("no-such-channel", { memberId: "raynor", memberKind: "agent" }),
    ).toThrow();
  });

  it("should throw when the target conversation is a DM, not a channel", () => {
    const dm = store.getOrCreateDm("user", "raynor");
    expect(() =>
      store.joinChannel(dm.id, { memberId: "kerrigan", memberKind: "agent" }),
    ).toThrow();
  });
});

describe("ConversationStore.leaveChannel", () => {
  it("should remove a member from a channel", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });
    store.leaveChannel(channel.id, "raynor");

    const ids = store.getMembers(channel.id).map((m) => m.memberId);
    expect(ids).toEqual(["user"]);
  });

  it("should be a no-op when removing a non-member", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    expect(() => store.leaveChannel(channel.id, "ghost")).not.toThrow();
    expect(store.getMembers(channel.id)).toHaveLength(1);
  });

  it("should throw when the channel does not exist", () => {
    expect(() => store.leaveChannel("no-such-channel", "raynor")).toThrow();
  });
});

describe("ConversationStore.postToChannel", () => {
  it("should persist a message scoped to the channel for a member", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    const message = store.postToChannel({
      channelId: channel.id,
      senderId: "raynor",
      body: "ready for orders",
    });

    expect(message.conversationId).toBe(channel.id);
    expect(message.agentId).toBe("raynor");
    expect(message.body).toBe("ready for orders");

    const scoped = messageStore.getMessages({ conversationId: channel.id });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.body).toBe("ready for orders");
  });

  it("should tag a user-sent message with role 'user'", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    const message = store.postToChannel({
      channelId: channel.id,
      senderId: "user",
      body: "status?",
    });
    expect(message.role).toBe("user");
  });

  it("should tag an agent-sent message with role 'agent'", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });
    const message = store.postToChannel({
      channelId: channel.id,
      senderId: "raynor",
      body: "on it",
    });
    expect(message.role).toBe("agent");
  });

  it("should reject a post from a non-member", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    expect(() =>
      store.postToChannel({ channelId: channel.id, senderId: "intruder", body: "hi" }),
    ).toThrow();
  });

  it("should reject a post to a non-existent channel", () => {
    expect(() =>
      store.postToChannel({ channelId: "nope", senderId: "user", body: "hi" }),
    ).toThrow();
  });

  it("should reject a post to a DM via the channel API", () => {
    const dm = store.getOrCreateDm("user", "raynor");
    expect(() =>
      store.postToChannel({ channelId: dm.id, senderId: "user", body: "hi" }),
    ).toThrow();
  });
});
