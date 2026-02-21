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
import { wsBroadcast } from "../services/ws-server.js";
import {
  success,
  notFound,
  validationError,
} from "../utils/responses.js";

const SendChatMessageSchema = z.object({
  to: z.string().min(1, "Recipient is required"),
  body: z.string().min(1, "Message body is required"),
  threadId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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

  // GET /api/messages
  router.get("/", (req, res) => {
    const agentId = req.query["agentId"] as string | undefined;
    const threadId = req.query["threadId"] as string | undefined;
    const before = req.query["before"] as string | undefined;
    const beforeId = req.query["beforeId"] as string | undefined;
    const limitStr = req.query["limit"] as string | undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    const opts: Parameters<typeof store.getMessages>[0] = {};
    if (agentId !== undefined) opts.agentId = agentId;
    if (threadId !== undefined) opts.threadId = threadId;
    if (before !== undefined) opts.before = before;
    if (beforeId !== undefined) opts.beforeId = beforeId;
    if (limit !== undefined) opts.limit = limit;
    const messages = store.getMessages(opts);
    return res.json(success({
      items: messages,
      total: messages.length,
      hasMore: limit !== undefined && messages.length === limit,
    }));
  });

  // GET /api/messages/:id
  router.get("/:id", (req, res) => {
    const { id } = req.params;
    const message = store.getMessage(id!);

    if (!message) {
      return res.status(404).json(notFound("Message", id));
    }

    return res.json(success(message));
  });

  // PATCH /api/messages/:id/read
  router.patch("/:id/read", (req, res) => {
    const { id } = req.params;
    const message = store.getMessage(id!);

    if (!message) {
      return res.status(404).json(notFound("Message", id));
    }

    store.markRead(id!);
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

    const { to, body, threadId, metadata } = parseResult.data;

    const insertInput: Parameters<typeof store.insertMessage>[0] = {
      agentId: "user",
      recipient: to,
      role: "user",
      body,
    };
    if (threadId !== undefined) insertInput.threadId = threadId;
    if (metadata !== undefined) insertInput.metadata = metadata;
    const message = store.insertMessage(insertInput);

    // Broadcast via WebSocket
    wsBroadcast({
      type: "chat_message" as any,
      id: message.id,
      from: "user",
      to,
      body: message.body,
      timestamp: message.createdAt,
      threadId: message.threadId ?? undefined,
      metadata: message.metadata ?? undefined,
    });

    return res.status(201).json(success({ messageId: message.id, timestamp: message.createdAt }));
  });

  return router;
}
