/**
 * Reversible, idempotent backfill of legacy messages into DM conversations
 * (adj-164.1.4).
 *
 * Before the unified conversation model, DMs were reconstructed from
 * `(agent_id, recipient, role)`. This backfill assigns every existing DM-shaped
 * message a stable `conversation_id`:
 *
 *  - Messages sharing a `thread_id` are grouped into one conversation keyed by
 *    that thread_id (we honor the operator's existing grouping).
 *  - Otherwise messages are grouped by their agent↔user pair, using the
 *    deterministic DM id from {@link dmConversationId}.
 *
 * Every scoped message and every conversation the backfill creates is recorded
 * in `conversation_backfill_log`, which makes {@link reverseBackfill} exact:
 * it restores only what the backfill changed, leaving independently-created
 * conversations and pre-scoped messages untouched.
 *
 * Idempotency: messages that already carry a `conversation_id` are skipped, so
 * re-running is a no-op.
 */

import type Database from "better-sqlite3";

import { createConversationStore, dmConversationId } from "./conversation-store.js";

export interface BackfillResult {
  messagesUpdated: number;
  conversationsCreated: number;
}

/** Raw row shape for the legacy-message scan (only the columns we need). */
interface LegacyMessageRow {
  id: string;
  agent_id: string;
  recipient: string | null;
  role: string;
  thread_id: string | null;
}

/**
 * Resolve the agent counterpart of a DM-shaped message. Returns null when the
 * message is not a clear user↔agent DM (e.g. announcements, system, or messages
 * with no resolvable pair) — those are left unscoped.
 */
function resolveAgentCounterpart(row: LegacyMessageRow): string | null {
  if (row.role === "user") {
    // user → agent : counterpart is the recipient.
    if (row.recipient && row.recipient !== "user") return row.recipient;
    return null;
  }
  if (row.role === "agent") {
    // agent → user : counterpart is the sending agent, and it must target the user.
    if (row.agent_id && row.agent_id !== "user" && (row.recipient === "user" || row.recipient === "mayor/")) {
      return row.agent_id;
    }
    return null;
  }
  // system / announcement → not a DM.
  return null;
}

export function backfillConversations(db: Database.Database): BackfillResult {
  const convStore = createConversationStore(db);

  const selectLegacy = db.prepare(`
    SELECT id, agent_id, recipient, role, thread_id
    FROM messages
    WHERE conversation_id IS NULL
    ORDER BY created_at ASC, id ASC
  `);

  const setConversationStmt = db.prepare("UPDATE messages SET conversation_id = ? WHERE id = ?");
  const logStmt = db.prepare(`
    INSERT OR IGNORE INTO conversation_backfill_log (message_id, conversation_id, conversation_created)
    VALUES (?, ?, ?)
  `);

  let messagesUpdated = 0;
  let conversationsCreated = 0;

  const run = db.transaction(() => {
    const rows = selectLegacy.all() as LegacyMessageRow[];

    for (const row of rows) {
      const counterpart = resolveAgentCounterpart(row);
      if (counterpart === null) {
        continue; // not a DM-shaped message — leave unscoped.
      }

      let conversationId: string;
      let createdThisRow = false;

      if (row.thread_id) {
        // Honor the existing thread grouping: the conversation id IS the thread id.
        conversationId = row.thread_id;
        const existing = convStore.getConversation(conversationId);
        if (existing === null) {
          convStore.createConversation({ kind: "dm", id: conversationId });
          convStore.addMember(conversationId, { memberId: "user", memberKind: "user" });
          convStore.addMember(conversationId, { memberId: counterpart, memberKind: "agent" });
          conversationsCreated += 1;
          createdThisRow = true;
        }
      } else {
        // Pair-derived deterministic DM. getOrCreateDm only creates on first use.
        const deterministicId = dmConversationId("user", counterpart);
        const preExisting = convStore.getConversation(deterministicId);
        const conv = convStore.getOrCreateDm("user", counterpart);
        conversationId = conv.id;
        if (preExisting === null) {
          conversationsCreated += 1;
          createdThisRow = true;
        }
      }

      setConversationStmt.run(conversationId, row.id);
      logStmt.run(row.id, conversationId, createdThisRow ? 1 : 0);
      messagesUpdated += 1;
    }
  });

  run();

  return { messagesUpdated, conversationsCreated };
}

/**
 * Reverse a prior backfill: null out conversation_id on every message the
 * backfill scoped, delete every conversation the backfill created, and clear
 * the log. Conversations/messages that existed independently are untouched.
 */
export function reverseBackfill(db: Database.Database): void {
  const selectLog = db.prepare(
    "SELECT message_id, conversation_id, conversation_created FROM conversation_backfill_log",
  );
  const clearMessageStmt = db.prepare("UPDATE messages SET conversation_id = NULL WHERE id = ?");
  const deleteConversationStmt = db.prepare("DELETE FROM conversations WHERE id = ?");
  const clearLogStmt = db.prepare("DELETE FROM conversation_backfill_log");

  const run = db.transaction(() => {
    const rows = selectLog.all() as {
      message_id: string;
      conversation_id: string;
      conversation_created: number;
    }[];

    const createdConversationIds = new Set<string>();
    for (const row of rows) {
      clearMessageStmt.run(row.message_id);
      if (row.conversation_created === 1) {
        createdConversationIds.add(row.conversation_id);
      }
    }

    // Deleting the conversation cascades to its members (FK ON DELETE CASCADE).
    for (const id of createdConversationIds) {
      deleteConversationStmt.run(id);
    }

    clearLogStmt.run();
  });

  run();
}
