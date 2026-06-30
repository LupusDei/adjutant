/**
 * Tests for the Bridge transcript persister (adj-202.6.6).
 *
 * The persister turns FINALIZED transcription turns of a Bridge voice session into
 * persisted chat messages in the SAME conversation the Commander already has with the
 * adjutant coordinator (the `user`↔`adjutant` DM), so the voice session becomes default,
 * viewable chat history. It reuses the REAL conversation + message stores (Rules 4 + 9)
 * — no new store. These tests drive it with mocked transcription turns against REAL
 * in-memory stores, so the persisted rows have real data shapes.
 *
 * Behaviour under test:
 *  - interim (non-final) segments are buffered, NOT persisted (no partial-word spam),
 *  - a finalized segment persists exactly one message into the deterministic DM,
 *  - re-delivery of the same finalized segment id does not double-write (dedup),
 *  - the Commander's speech persists as role 'user', the avatar's as role 'agent',
 *  - both directions land in the SAME (order-independent) conversation,
 *  - a per-turn broadcast hook fires for live fan-out,
 *  - endSession drops still-buffered interims (only completed utterances survive).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createConversationStore, dmConversationId, type ConversationStore } from "../../src/services/conversation-store.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import {
  createBridgeTranscriptPersister,
  type BridgeTranscriptPersister,
  type PersistedTranscriptTurn,
} from "../../src/services/bridge-transcript-persister.js";

let db: Database.Database;
let conversationStore: ConversationStore;
let messageStore: MessageStore;
let persister: BridgeTranscriptPersister;
let broadcast: ReturnType<typeof vi.fn>;

const DM_ID = dmConversationId("user", "adjutant-coordinator");

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  messageStore = createMessageStore(db);
  conversationStore = createConversationStore(db, messageStore);
  broadcast = vi.fn();
  persister = createBridgeTranscriptPersister({ conversationStore, messageStore, broadcast });
});

afterEach(() => {
  db.close();
});

function messagesInDm(): ReturnType<MessageStore["getMessages"]> {
  return messageStore.getMessages({ conversationId: DM_ID, limit: 100 });
}

describe("createBridgeTranscriptPersister — interim buffering", () => {
  it("should NOT persist a non-final (interim) segment", () => {
    const out = persister.onSegment({
      sessionId: "s1",
      speaker: "commander",
      text: "show me the",
      segmentId: "seg-1",
      final: false,
    });

    expect(out).toBeNull();
    expect(messagesInDm()).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("should persist only the finalized text after interim updates of the same segment", () => {
    persister.onSegment({ sessionId: "s1", speaker: "commander", text: "show", segmentId: "seg-1", final: false });
    persister.onSegment({ sessionId: "s1", speaker: "commander", text: "show me the", segmentId: "seg-1", final: false });
    const out = persister.onSegment({
      sessionId: "s1",
      speaker: "commander",
      text: "show me the fleet",
      segmentId: "seg-1",
      final: true,
    });

    const msgs = messagesInDm();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toBe("show me the fleet");
    expect(out).not.toBeNull();
    expect(out!.body).toBe("show me the fleet");
  });
});

describe("createBridgeTranscriptPersister — finalized persistence + roles", () => {
  it("should persist the Commander's finalized speech as a role='user' message in the DM", () => {
    persister.onSegment({ sessionId: "s1", speaker: "commander", text: "Status report", segmentId: "c1", final: true });

    const msgs = messagesInDm();
    expect(msgs).toHaveLength(1);
    const m = msgs[0]!;
    expect(m.role).toBe("user");
    expect(m.agentId).toBe("user");
    expect(m.recipient).toBe("adjutant-coordinator");
    expect(m.conversationId).toBe(DM_ID);
    expect(m.body).toBe("Status report");
    expect(m.metadata).toMatchObject({ source: "bridge-voice", sessionId: "s1", speaker: "commander" });
  });

  it("should persist the avatar's finalized speech as a role='agent' message from 'adjutant-coordinator'", () => {
    persister.onSegment({ sessionId: "s1", speaker: "avatar", text: "All agents nominal.", segmentId: "a1", final: true });

    const msgs = messagesInDm();
    expect(msgs).toHaveLength(1);
    const m = msgs[0]!;
    expect(m.role).toBe("agent");
    expect(m.agentId).toBe("adjutant-coordinator");
    expect(m.recipient).toBe("user");
    expect(m.conversationId).toBe(DM_ID);
    expect(m.metadata).toMatchObject({ source: "bridge-voice", speaker: "avatar" });
  });

  it("should land BOTH directions in the same order-independent conversation", () => {
    persister.onSegment({ sessionId: "s1", speaker: "commander", text: "Hello", segmentId: "c1", final: true });
    persister.onSegment({ sessionId: "s1", speaker: "avatar", text: "Hello, Commander.", segmentId: "a1", final: true });

    expect(messagesInDm()).toHaveLength(2);
  });

  it("should ensure the DM conversation row exists (getOrCreateDm) so it lists by default", () => {
    persister.onSegment({ sessionId: "s1", speaker: "avatar", text: "Standing by.", segmentId: "a1", final: true });

    const conv = conversationStore.getConversation(DM_ID);
    expect(conv).not.toBeNull();
    expect(conv!.kind).toBe("dm");
    const members = conversationStore.getMembers(DM_ID).map((m) => m.memberId).sort();
    expect(members).toEqual(["adjutant-coordinator", "user"]);
  });

  it("should fire the broadcast hook once per persisted turn with from/to peers", () => {
    persister.onSegment({ sessionId: "s1", speaker: "commander", text: "Go", segmentId: "c1", final: true });

    expect(broadcast).toHaveBeenCalledTimes(1);
    const turn = broadcast.mock.calls[0]![0] as PersistedTranscriptTurn;
    expect(turn.from).toBe("user");
    expect(turn.to).toBe("adjutant-coordinator");
    expect(turn.message.body).toBe("Go");
  });
});

describe("createBridgeTranscriptPersister — dedup + edge cases", () => {
  it("should NOT double-write when the same finalized segment id is re-delivered", () => {
    persister.onSegment({ sessionId: "s1", speaker: "commander", text: "Once", segmentId: "dup", final: true });
    const second = persister.onSegment({ sessionId: "s1", speaker: "commander", text: "Once", segmentId: "dup", final: true });

    expect(second).toBeNull();
    expect(messagesInDm()).toHaveLength(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("should skip an empty finalized utterance", () => {
    const out = persister.onSegment({ sessionId: "s1", speaker: "commander", text: "   ", segmentId: "e1", final: true });

    expect(out).toBeNull();
    expect(messagesInDm()).toHaveLength(0);
  });

  it("should fall back to the last interim text when the finalized segment carries empty text", () => {
    persister.onSegment({ sessionId: "s1", speaker: "avatar", text: "Affirmative", segmentId: "f1", final: false });
    const out = persister.onSegment({ sessionId: "s1", speaker: "avatar", text: "", segmentId: "f1", final: true });

    expect(out).not.toBeNull();
    expect(out!.body).toBe("Affirmative");
    expect(messagesInDm()).toHaveLength(1);
  });

  it("should drop still-buffered interims on endSession (only completed utterances survive)", () => {
    persister.onSegment({ sessionId: "s1", speaker: "commander", text: "unfinished thought", segmentId: "u1", final: false });
    persister.endSession("s1");

    // A late final for the same (now-forgotten) segment is treated as a fresh utterance,
    // but the dropped interim itself never persisted.
    expect(messagesInDm()).toHaveLength(0);
  });

  it("should isolate interim state per session", () => {
    persister.onSegment({ sessionId: "s1", speaker: "commander", text: "session one", segmentId: "x", final: false });
    persister.onSegment({ sessionId: "s2", speaker: "commander", text: "session two", segmentId: "x", final: true });

    const msgs = messagesInDm();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toBe("session two");
    expect(msgs[0]!.metadata).toMatchObject({ sessionId: "s2" });
  });
});
