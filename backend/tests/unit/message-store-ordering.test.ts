/**
 * Message ordering determinism within a same-second burst (adj-cax0y).
 *
 * messages.created_at is stamped with datetime('now') — SECOND granularity — and reads order by
 * `created_at DESC, id DESC`. Message ids are randomUUID(), so lexicographic id order carries NO
 * temporal meaning: within one second the tiebreak is effectively random.
 *
 * This is not theoretical. Measured against the production DB (10,395 messages): 110 same-second
 * tie groups covering 223 messages, and 50 of those groups (45%) are ordered DIFFERENTLY from
 * true insertion order (rowid). Channel bursts and rapid agent chatter are exactly the case.
 *
 * The fix must keep the created_at STRING FORMAT untouched — iOS parses timestamps with fixed
 * formatters (e.g. OpenQuestionsView's "yyyy-MM-dd HH:mm:ss"), so appending fractional seconds
 * would break consumers. Ordering is therefore made deterministic via the monotonic rowid, which
 * is invisible to every client.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";

let db: Database.Database;
let store: MessageStore;

/** Insert a message into one conversation; every insert lands in the same second. */
function post(body: string, id?: string): string {
  const msg = store.insertMessage({
    ...(id !== undefined ? { id } : {}),
    agentId: "fenix",
    role: "agent",
    body,
    conversationId: "conv_burst",
  });
  return msg.id;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createMessageStore(db);
});

afterEach(() => {
  db.close();
});

describe("MessageStore same-second ordering (adj-cax0y)", () => {
  it("should return a same-second burst newest-first in INSERTION order when ids sort the other way", () => {
    // Ids chosen to sort OPPOSITE to insertion order — precisely what randomUUID does by chance.
    post("first", "zzz");
    post("second", "mmm");
    post("third", "aaa");

    const got = store.getMessages({ conversationId: "conv_burst", limit: 10 });

    // Newest-first: the LAST inserted message must come back first, regardless of its id.
    expect(got.map((m) => m.body)).toEqual(["third", "second", "first"]);
  });

  it("should order a 20-message burst of real randomUUID ids by insertion, not by id", () => {
    const bodies = Array.from({ length: 20 }, (_, i) => `msg-${i}`);
    for (const b of bodies) post(b);

    const got = store.getMessages({ conversationId: "conv_burst", limit: 50 });

    // With a random tiebreak this ordering survives with probability 1/20! — i.e. never.
    expect(got.map((m) => m.body)).toEqual([...bodies].reverse());
  });

  it("should page through a same-second burst returning every message EXACTLY once", () => {
    const bodies = Array.from({ length: 9 }, (_, i) => `p-${i}`);
    for (const b of bodies) post(b);

    // Walk the cursor the way the chat surfaces do: (before, beforeId) from the last row seen.
    const seen: string[] = [];
    let cursor: { before?: string; beforeId?: string } = {};
    for (let page = 0; page < 5; page++) {
      const batch = store.getMessages({ conversationId: "conv_burst", limit: 3, ...cursor });
      if (batch.length === 0) break;
      seen.push(...batch.map((m) => m.body));
      const last = batch[batch.length - 1]!;
      cursor = { before: last.createdAt, beforeId: last.id };
    }

    // No duplicates...
    expect(new Set(seen).size).toBe(seen.length);
    // ...and no skips: every message is accounted for, newest-first overall.
    expect(seen).toEqual([...bodies].reverse());
  });

  it("should still order strictly by timestamp across different seconds", () => {
    const older = post("older");
    const newer = post("newer");
    // Force distinct seconds: `older` is backdated a full minute.
    db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run("2026-08-19 10:00:00", older);
    db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run("2026-08-19 10:01:00", newer);

    const got = store.getMessages({ conversationId: "conv_burst", limit: 10 });

    expect(got.map((m) => m.body)).toEqual(["newer", "older"]);
  });

  it("should not change the created_at string format (iOS parses it with fixed formatters)", () => {
    post("format check");

    const [msg] = store.getMessages({ conversationId: "conv_burst", limit: 1 });

    // "YYYY-MM-DD HH:MM:SS" — no fractional seconds, no "T", no trailing "Z".
    expect(msg!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

// ============================================================================
// Sibling read paths — pinning ordering that currently holds only BY ACCIDENT (adj-cax0y).
//
// HONEST STATUS: these three tests PASSED before the fix as well as after. They are regression
// pins, not proof of a repaired bug. `getPendingForRecipient`, `searchMessages`, and the
// `getThreads` latest_body subquery order by `created_at` with NO tiebreak, and they come out in
// insertion order only because SQLite appends the rowid to non-unique index keys and scans tables
// in rowid order. That is an implementation detail of the storage engine and of whichever plan the
// query planner happens to pick (measured: the pending-delivery query SEARCHes via
// idx_messages_recipient, so it is walking an index, not the table).
//
// This is also what makes getMessages' failure so pointed: it was the ONE path with an explicit
// tiebreak — `id DESC` on random UUIDs — and that tiebreak OVERRODE the incidentally-correct
// order. The cure there was not to add sorting but to sort on the right key.
//
// Adding an explicit rowid tiebreak to these three makes guaranteed what is presently incidental,
// at zero cost, so a future index or planner change cannot silently reorder:
//   - getPendingForRecipient -> the order messages are injected into an agent's tmux session
//   - searchMessages         -> search results
//   - getThreads.latest_body -> which message a thread preview shows as "latest"
// ============================================================================

describe("MessageStore sibling read paths — same-second determinism (adj-cax0y)", () => {
  it("should hand pending messages to a recipient in INSERTION order", () => {
    // Ids anti-correlated with insertion order, as randomUUID would be by chance.
    for (const [body, id] of [["one", "zzz"], ["two", "mmm"], ["three", "aaa"]] as const) {
      store.insertMessage({ id, agentId: "user", recipient: "fenix", role: "user", body });
    }

    const pending = store.getPendingForRecipient("fenix");

    // Oldest-first delivery queue: an agent must read instructions in the order they were sent.
    expect(pending.map((m) => m.body)).toEqual(["one", "two", "three"]);
  });

  it("should return search hits newest-first by insertion within the same second", () => {
    for (const body of ["alpha burst 1", "alpha burst 2", "alpha burst 3"]) {
      post(body);
    }

    const hits = store.searchMessages("alpha", { conversationId: "conv_burst" });

    expect(hits.map((m) => m.body)).toEqual(["alpha burst 3", "alpha burst 2", "alpha burst 1"]);
  });

  it("should show the TRUE latest message as a thread's preview body", () => {
    for (const [body, id] of [["oldest", "zzz"], ["middle", "mmm"], ["actual latest", "aaa"]] as const) {
      store.insertMessage({ id, agentId: "fenix", role: "agent", body, threadId: "t1" });
    }

    const [thread] = store.getThreads();

    expect(thread!.latestBody).toBe("actual latest");
  });
});

// ============================================================================
// senderId — a strict sender filter that COMPOSES with conversationId (adj-xbszj).
//
// The existing `agentId` option is DM-shaped: it widens to
// `(agent_id = ? OR (role='user' AND recipient = ?))` and is skipped entirely when a
// conversationId is present. So there was no way to ask "what did kerrigan say in THIS channel" —
// the Bridge passed both and silently got the whole room back, which is how it ended up describing
// its own capabilities wrongly to the Commander.
// ============================================================================

describe("MessageStore senderId filter (adj-xbszj)", () => {
  beforeEach(() => {
    for (const [agent, body] of [
      ["kerrigan", "kerrigan in room"],
      ["raynor", "raynor in room"],
      ["kerrigan", "kerrigan again"],
    ] as const) {
      store.insertMessage({ agentId: agent, role: "agent", body, conversationId: "conv_room" });
    }
    // Same sender, DIFFERENT conversation — must never leak into a scoped read.
    store.insertMessage({
      agentId: "kerrigan",
      role: "agent",
      body: "kerrigan elsewhere",
      conversationId: "conv_other",
    });
  });

  it("should return only that sender's messages within the given conversation", () => {
    const got = store.getMessages({ conversationId: "conv_room", senderId: "kerrigan", limit: 20 });

    expect(got.map((m) => m.body)).toEqual(["kerrigan again", "kerrigan in room"]);
  });

  it("should not leak the same sender's messages from another conversation", () => {
    const got = store.getMessages({ conversationId: "conv_room", senderId: "kerrigan", limit: 20 });

    expect(got.some((m) => m.body === "kerrigan elsewhere")).toBe(false);
  });

  it("should return the whole room when senderId is omitted", () => {
    const got = store.getMessages({ conversationId: "conv_room", limit: 20 });

    expect(got).toHaveLength(3);
  });

  it("should return an empty result for a sender who never posted in that conversation", () => {
    const got = store.getMessages({ conversationId: "conv_room", senderId: "artanis", limit: 20 });

    expect(got).toEqual([]);
  });
});
