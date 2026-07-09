/**
 * Messages REST routes for the Adjutant API.
 *
 * Provides HTTP endpoints for the frontend to interact with the
 * SQLite-backed message store.
 *
 * Endpoints:
 * - GET    /api/messages           - List messages (query: agentId, threadId, before, beforeId, limit)
 * - GET    /api/messages/unread    - Get unread counts per agent
 * - GET    /api/messages/threads   - List threads (query: agentId)
 * - GET    /api/messages/:id       - Get single message
 * - PATCH  /api/messages/read-all  - Mark all from agent as read (query: agentId)
 * - PATCH  /api/messages/:id/read  - Mark single message as read
 * - POST   /api/messages           - Send message from user
 */

import { Router } from "express";
import { z } from "zod";
import type { MessageStore } from "../services/message-store.js";
import { toClientMessage } from "../services/message-store.js";
import { wsBroadcast } from "../services/ws-server.js";
import { dmConversationId } from "../services/conversation-store.js";
import { getSessionBridge } from "../services/session-bridge.js";
import { deliverDirectMessage } from "../services/direct-message-delivery.js";

import { getAgents } from "../services/agents-service.js";
import {
  success,
  notFound,
  validationError,
} from "../utils/responses.js";

/** Max image attachments per message (adj-203 security cap). */
const MAX_ATTACHMENTS_PER_MESSAGE = 4;

const SendChatMessageSchema = z
  .object({
    to: z.string().min(1, "Recipient is required"),
    // adj-203.2.5.2: body is OPTIONAL when attachments are present (image-only DMs).
    // The object-level refine below enforces "at least one of {non-empty body, ≥1
    // attachment}", so an empty/whitespace body with no attachments is still rejected.
    body: z.string().max(10000, "Message body too long").optional(),
    threadId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    attachmentIds: z
      .array(z.string().min(1))
      .max(MAX_ATTACHMENTS_PER_MESSAGE, `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`)
      .optional(),
  })
  .refine(
    (data) => (data.body?.trim().length ?? 0) > 0 || (data.attachmentIds?.length ?? 0) > 0,
    { message: "A message must have a non-empty body or at least one attachment", path: ["body"] },
  );

/**
 * Create a messages router bound to the given MessageStore.
 * This factory pattern lets tests inject a test-scoped store.
 */
export function createMessagesRouter(store: MessageStore): Router {
  const router = Router();

  // GET /api/messages/unread — must come before /:id
  router.get("/unread", (_req, res) => {
    const counts = store.getUnreadCounts();
    return res.json(success({ counts }));
  });

  // GET /api/messages/threads — must come before /:id
  router.get("/threads", (req, res) => {
    const agentId = req.query["agentId"] as string | undefined;
    const threads = store.getThreads(agentId);
    return res.json(success({ threads }));
  });

  // PATCH /api/messages/read-all — must come before /:id/read
  router.patch("/read-all", (req, res) => {
    const agentId = req.query["agentId"] as string | undefined;
    if (!agentId) {
      return res.status(400).json(validationError("agentId query param is required"));
    }
    store.markAllRead(agentId);
    return res.json(success({ read: true }));
  });

  // GET /api/messages/search — FTS search (must come before /:id).
  // Scopes by conversationId (preferred, bleed-free) or agentId.
  router.get("/search", (req, res) => {
    const q = req.query["q"] as string | undefined;
    if (!q || q.trim().length === 0) {
      return res.json(success({ items: [], total: 0 }));
    }
    const agentId = req.query["agentId"] as string | undefined;
    const conversationId = req.query["conversationId"] as string | undefined;
    const limitStr = req.query["limit"] as string | undefined;
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : undefined;

    const opts: Parameters<typeof store.searchMessages>[1] = {};
    if (conversationId !== undefined) opts.conversationId = conversationId;
    else if (agentId !== undefined) opts.agentId = agentId;
    if (limit !== undefined) opts.limit = limit;
    const items = store.searchMessages(q, opts);
    return res.json(success({ items, total: items.length }));
  });

  // GET /api/messages
  router.get("/", (req, res) => {
    const agentId = req.query["agentId"] as string | undefined;
    const threadId = req.query["threadId"] as string | undefined;
    const before = req.query["before"] as string | undefined;
    const beforeId = req.query["beforeId"] as string | undefined;
    const limitStr = req.query["limit"] as string | undefined;
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : undefined;

    const opts: Parameters<typeof store.getMessages>[0] = {};
    if (agentId !== undefined) opts.agentId = agentId;
    if (threadId !== undefined) opts.threadId = threadId;
    if (before !== undefined) opts.before = before;
    if (beforeId !== undefined) opts.beforeId = beforeId;
    if (limit !== undefined) opts.limit = limit;
    const messages = store.getMessages(opts);
    // DB returns DESC (newest first) for cursor pagination; reverse to ASC for display.
    // adj-203.2.5.1: serialize as ClientMessage so the absolute storagePath never leaks.
    const chronological = [...messages].reverse().map(toClientMessage);
    return res.json(success({
      items: chronological,
      total: chronological.length,
      hasMore: limit !== undefined && chronological.length === limit,
    }));
  });

  // GET /api/messages/:id
  router.get("/:id", (req, res) => {
    const { id } = req.params;
    const message = store.getMessage(id);

    if (!message) {
      return res.status(404).json(notFound("Message", id));
    }

    // adj-203.2.5.1: strip the absolute storagePath from the client payload.
    return res.json(success(toClientMessage(message)));
  });

  // PATCH /api/messages/:id/read
  router.patch("/:id/read", (req, res) => {
    const { id } = req.params;
    const message = store.getMessage(id);

    if (!message) {
      return res.status(404).json(notFound("Message", id));
    }

    store.markRead(id);
    return res.json(success({ read: true }));
  });

  // POST /api/messages
  router.post("/", (req, res) => {
    const parseResult = SendChatMessageSchema.safeParse(req.body);

    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      return res.status(400).json(
        validationError(firstIssue?.message ?? "Invalid request body"),
      );
    }

    const { to, threadId, metadata, attachmentIds } = parseResult.data;
    // adj-203.2.5.2: body is optional for image-only DMs — normalize to "" for the store/WS.
    const body = parseResult.data.body ?? "";

    // adj-x6qln follow-up — DIAGNOSTIC: this route stamps every message from="user"/role="user"
    // (it is the Commander's send endpoint). AGENTS are supposed to use MCP send_message (role=
    // agent). We're seeing agent STATUS REPORTS land here — i.e. an agent posting via curl/REST is
    // impersonating the Commander (its report shows as the user's message). Log the caller's origin
    // so we can name the offender: real clients carry a browser Origin (dashboard) or the iOS app
    // User-Agent; an agent posting via curl/node does not.
    const ua = req.get("user-agent") ?? "";
    const origin = req.get("origin") ?? "";
    const looksLikeAgentPost =
      !origin && !/Adjutant|Mozilla|WebKit|Safari|CFNetwork|Darwin/i.test(ua);
    if (looksLikeAgentPost) {
      logWarn("POST /api/messages from a NON-USER caller (agent impersonating the Commander?)", {
        to,
        threadId: threadId ?? null,
        userAgent: ua.slice(0, 100),
        ip: req.ip ?? null,
        bodyPreview: body.slice(0, 60),
      });
    }

    // adj-164.2 + adj-202.4.1: persist (tagged with the deterministic DM conversation id
    // for the (user, recipient) pair — the wrong-thread-bleed fix), broadcast, and inject
    // into the recipient's live session via the SHARED deliverDirectMessage helper (the
    // same path the avatar's send_message command tool uses — no second impl). No APNs
    // here: this is the user→agent direction and the user is in the app when sending.
    const result = deliverDirectMessage(
      { store },
      {
        from: "user",
        to,
        body,
        role: "user",
        ...(threadId !== undefined ? { threadId } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        ...(attachmentIds !== undefined ? { attachmentIds } : {}),
      },
    );

    return res.status(201).json(success({ messageId: result.messageId, timestamp: result.timestamp }));
  });

  // POST /api/messages/broadcast — send a status update request to all active agents
  router.post("/broadcast", async (_req, res) => {
    const agentsResult = await getAgents();
    if (!agentsResult.success || !agentsResult.data) {
      return res.status(500).json({
        success: false,
        error: { code: "AGENTS_ERROR", message: "Failed to fetch agents" },
      });
    }

    const activeAgents = agentsResult.data.filter(
      (a) => a.status !== "offline"
    );

    const body = "Use set_status to update your current status. Report what you just completed or what you are actively working on right now. Always reference specific work — never say 'idle awaiting next task'. Example: set_status({ status: \"working\", task: \"Implementing auth token refresh for session service\" }) or set_status({ status: \"done\", task: \"Completed adj-042: refactored beads-repository into modules\" }). Reply to me via send_message with a brief summary too.";
    const sent: string[] = [];

    for (const agent of activeAgents) {
      const broadcastConversationId = dmConversationId("user", agent.name);
      const message = store.insertMessage({
        agentId: "user",
        recipient: agent.name,
        role: "user",
        body,
        conversationId: broadcastConversationId,
      });

      wsBroadcast({
        type: "chat_message",
        id: message.id,
        from: "user",
        to: agent.name,
        body: message.body,
        timestamp: message.createdAt,
        conversationId: message.conversationId ?? undefined,
      });

      // Deliver to agent's tmux pane
      try {
        const bridge = getSessionBridge();
        const sessions = bridge.registry.findByName(agent.name);
        for (const session of sessions) {
          bridge.sendInput(session.id, body).then((ok) => {
            if (ok) store.markDelivered(message.id);
          }).catch(() => {});
        }
      } catch {
        // Session bridge not initialized — agent will pull via MCP
      }

      sent.push(agent.name);
    }

    return res.json(success({ sent, count: sent.length }));
  });

  return router;
}
