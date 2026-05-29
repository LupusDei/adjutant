/**
 * Conversations REST routes (adj-164.1.5).
 *
 * Exposes the unified conversation model to the frontend/iOS clients:
 *  - GET /api/conversations              — conversations the user belongs to
 *  - GET /api/conversations/:id/messages — messages scoped to one conversation
 *
 * Scoping is enforced at the store layer (MessageStore.getMessages with a
 * conversationId), which is the root-cause fix for wrong-thread bleed: there is
 * no agent/recipient widening here.
 */

import { Router } from "express";

import type { ConversationStore } from "../services/conversation-store.js";
import type { MessageStore } from "../services/message-store.js";
import { success, notFound } from "../utils/responses.js";

/** The canonical member id for the dashboard operator (the General). */
const USER_MEMBER_ID = "user";

/**
 * Create a conversations router bound to the given stores.
 * The factory pattern lets tests inject test-scoped stores.
 */
export function createConversationsRouter(
  conversationStore: ConversationStore,
  messageStore: MessageStore,
): Router {
  const router = Router();

  // GET /api/conversations — list conversations the user is a member of.
  router.get("/", (req, res) => {
    const memberId = (req.query["memberId"] as string | undefined) ?? USER_MEMBER_ID;
    const conversations = conversationStore.getConversationsForMember(memberId);
    return res.json(success({ conversations, total: conversations.length }));
  });

  // GET /api/conversations/dm/:agentId — resolve (lookup-or-create) the
  // deterministic DM conversation between the user and an agent. This is the
  // single contract the clients use to scope a 1:1 chat: they never derive the
  // id themselves, keeping the hashing detail owned by the store layer. The
  // operation is idempotent — the deterministic id means repeated calls return
  // the same conversation with no duplicates. Registered before `/:id/messages`
  // so the literal `dm` segment is never shadowed by the `:id` param.
  router.get("/dm/:agentId", (req, res) => {
    const { agentId } = req.params;
    const conversation = conversationStore.getOrCreateDm(USER_MEMBER_ID, agentId);
    return res.json(success({ conversation }));
  });

  // GET /api/conversations/:id/messages — scoped, paginated message history.
  router.get("/:id/messages", (req, res) => {
    const { id } = req.params;

    const conversation = conversationStore.getConversation(id);
    if (conversation === null) {
      return res.status(404).json(notFound("Conversation", id));
    }

    const before = req.query["before"] as string | undefined;
    const beforeId = req.query["beforeId"] as string | undefined;
    const limitStr = req.query["limit"] as string | undefined;
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : undefined;

    const opts: Parameters<typeof messageStore.getMessages>[0] = { conversationId: id };
    if (before !== undefined) opts.before = before;
    if (beforeId !== undefined) opts.beforeId = beforeId;
    if (limit !== undefined) opts.limit = limit;

    const messages = messageStore.getMessages(opts);
    // The store returns DESC (newest first) for cursor pagination; reverse to
    // ASC for display, matching the /api/messages contract.
    const chronological = [...messages].reverse();

    return res.json(
      success({
        items: chronological,
        total: chronological.length,
        hasMore: limit !== undefined && chronological.length === limit,
      }),
    );
  });

  return router;
}
