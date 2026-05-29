/**
 * Tests for ConversationStore (adj-164.1.2).
 *
 * Covers conversation create/get/list, member add/remove/get,
 * getConversationsForMember, and deterministic DM lookup-or-create by member
 * pair. The DM lookup-or-create is the keystone: the same unordered member pair
 * MUST always resolve to the same conversation, with no duplicates.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createConversationStore, type ConversationStore } from "../../src/services/conversation-store.js";

let db: Database.Database;
let store: ConversationStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createConversationStore(db);
});

afterEach(() => {
  db.close();
});

describe("ConversationStore.createConversation", () => {
  it("should create a channel conversation and return it with defaults", () => {
    const conv = store.createConversation({ kind: "channel", title: "general" });

    expect(conv.id).toBeTruthy();
    expect(conv.kind).toBe("channel");
    expect(conv.title).toBe("general");
    expect(conv.archived).toBe(false);
    expect(conv.createdAt).toBeTruthy();
    expect(conv.updatedAt).toBeTruthy();
  });

  it("should create a dm conversation with a null title when none provided", () => {
    const conv = store.createConversation({ kind: "dm" });
    expect(conv.kind).toBe("dm");
    expect(conv.title).toBeNull();
  });

  it("should reject an invalid kind", () => {
    // @ts-expect-error — deliberately invalid kind to exercise the runtime guard
    expect(() => store.createConversation({ kind: "group" })).toThrow();
  });
});

describe("ConversationStore.getConversation", () => {
  it("should return a created conversation by id", () => {
    const created = store.createConversation({ kind: "channel", title: "ops" });
    const fetched = store.getConversation(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.title).toBe("ops");
  });

  it("should return null for an unknown id", () => {
    expect(store.getConversation("does-not-exist")).toBeNull();
  });
});

describe("ConversationStore.listConversations", () => {
  it("should return an empty array when no conversations exist", () => {
    expect(store.listConversations()).toEqual([]);
  });

  it("should list all conversations newest-first", () => {
    const a = store.createConversation({ kind: "channel", title: "a" });
    const b = store.createConversation({ kind: "channel", title: "b" });
    const ids = store.listConversations().map((c) => c.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).toHaveLength(2);
  });

  it("should filter by kind when requested", () => {
    store.createConversation({ kind: "channel", title: "chan" });
    store.createConversation({ kind: "dm" });
    const channels = store.listConversations({ kind: "channel" });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.kind).toBe("channel");
  });
});

describe("ConversationStore members", () => {
  it("should add a member and return it via getMembers", () => {
    const conv = store.createConversation({ kind: "channel", title: "team" });
    store.addMember(conv.id, { memberId: "raynor", memberKind: "agent", role: "owner" });

    const members = store.getMembers(conv.id);
    expect(members).toHaveLength(1);
    expect(members[0]?.memberId).toBe("raynor");
    expect(members[0]?.memberKind).toBe("agent");
    expect(members[0]?.role).toBe("owner");
    expect(members[0]?.joinedAt).toBeTruthy();
  });

  it("should be idempotent when the same member is added twice", () => {
    const conv = store.createConversation({ kind: "channel", title: "team" });
    store.addMember(conv.id, { memberId: "user", memberKind: "user" });
    store.addMember(conv.id, { memberId: "user", memberKind: "user" });
    expect(store.getMembers(conv.id)).toHaveLength(1);
  });

  it("should remove a member", () => {
    const conv = store.createConversation({ kind: "channel", title: "team" });
    store.addMember(conv.id, { memberId: "kerrigan", memberKind: "agent" });
    store.removeMember(conv.id, "kerrigan");
    expect(store.getMembers(conv.id)).toHaveLength(0);
  });

  it("should default role to member when not specified", () => {
    const conv = store.createConversation({ kind: "channel", title: "team" });
    store.addMember(conv.id, { memberId: "user", memberKind: "user" });
    expect(store.getMembers(conv.id)[0]?.role).toBe("member");
  });
});

describe("ConversationStore.getConversationsForMember", () => {
  it("should return only conversations the member belongs to", () => {
    const c1 = store.createConversation({ kind: "channel", title: "c1" });
    const c2 = store.createConversation({ kind: "channel", title: "c2" });
    store.addMember(c1.id, { memberId: "raynor", memberKind: "agent" });
    store.addMember(c2.id, { memberId: "kerrigan", memberKind: "agent" });

    const raynorConvs = store.getConversationsForMember("raynor");
    expect(raynorConvs.map((c) => c.id)).toEqual([c1.id]);
  });

  it("should return an empty array for a member in no conversations", () => {
    store.createConversation({ kind: "channel", title: "c1" });
    expect(store.getConversationsForMember("nobody")).toEqual([]);
  });
});

describe("ConversationStore.getOrCreateDm (deterministic DM lookup-or-create)", () => {
  it("should create a dm with exactly two members on first call", () => {
    const dm = store.getOrCreateDm("user", "raynor");
    expect(dm.kind).toBe("dm");

    const members = store.getMembers(dm.id).map((m) => m.memberId).sort();
    expect(members).toEqual(["raynor", "user"]);
  });

  it("should return the SAME conversation for the same pair regardless of order", () => {
    const a = store.getOrCreateDm("user", "raynor");
    const b = store.getOrCreateDm("raynor", "user");
    expect(b.id).toBe(a.id);

    // No duplicate dm rows for the pair.
    const dms = store.listConversations({ kind: "dm" });
    expect(dms).toHaveLength(1);
  });

  it("should create distinct conversations for distinct pairs", () => {
    const dm1 = store.getOrCreateDm("user", "raynor");
    const dm2 = store.getOrCreateDm("user", "kerrigan");
    expect(dm1.id).not.toBe(dm2.id);
    expect(store.listConversations({ kind: "dm" })).toHaveLength(2);
  });

  it("should reject a dm between identical members", () => {
    expect(() => store.getOrCreateDm("user", "user")).toThrow();
  });

  it("should infer member_kind: 'user' for the literal user, 'agent' otherwise", () => {
    const dm = store.getOrCreateDm("user", "raynor");
    const members = store.getMembers(dm.id);
    const user = members.find((m) => m.memberId === "user");
    const agent = members.find((m) => m.memberId === "raynor");
    expect(user?.memberKind).toBe("user");
    expect(agent?.memberKind).toBe("agent");
  });
});
