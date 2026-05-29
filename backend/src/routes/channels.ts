/**
 * Channels REST routes (adj-164.4.4).
 *
 * Exposes the channel surface of the unified conversation model to the
 * dashboard/iOS clients. Channels reuse the conversation store — these handlers
 * are thin HTTP adapters over ConversationStore channel methods.
 *
 *  - POST   /api/channels              — create a channel
 *  - GET    /api/channels              — list channels (with member counts)
 *  - POST   /api/channels/:id/join     — add a member
 *  - POST   /api/channels/:id/leave    — remove a member
 *  - POST   /api/channels/:id/messages — post a message (room-scoped fan-out)
 *
 * Membership is enforced at the store layer for posts; this layer translates
 * store errors into the correct HTTP status (404 unknown channel, 403 non-member).
 */

import { Router } from "express";

import type { ConversationStore } from "../services/conversation-store.js";
import { wsBroadcastToConversation } from "../services/ws-server.js";
import { isAPNsConfigured, sendNotificationToAll } from "../services/apns-service.js";
import { logWarn } from "../utils/index.js";
import { success, badRequest, notFound, forbidden } from "../utils/responses.js";

/** The canonical member id for the dashboard operator (the General). */
const USER_MEMBER_ID = "user";

/**
 * Create a channels router bound to the given conversation store.
 * The factory pattern lets tests inject a test-scoped store.
 */
export function createChannelsRouter(conversationStore: ConversationStore): Router {
  const router = Router();

  // POST /api/channels — create a channel; creator defaults to the user.
  router.post("/", (req, res) => {
    const body = req.body as { title?: unknown; createdBy?: unknown };
    const title = typeof body.title === "string" ? body.title : "";
    if (title.trim().length === 0) {
      return res.status(400).json(badRequest("title is required and must be non-empty"));
    }
    const createdBy = typeof body.createdBy === "string" ? body.createdBy : USER_MEMBER_ID;

    const channel = conversationStore.createChannel({ title, createdBy });
    return res.status(201).json(success(channel));
  });

  // GET /api/channels — list channels with member counts.
  router.get("/", (_req, res) => {
    const channels = conversationStore.listChannels();
    return res.json(success({ channels, total: channels.length }));
  });

  // GET /api/channels/unread — per-conversation unread counts for the operator
  // (adj-164.5). Registered before any `/:id` route would be — there is no
  // `/:id` GET here, but keeping it above the param-bearing routes documents the
  // intent that `unread` is a literal segment, never a channel id.
  router.get("/unread", (req, res) => {
    const memberId = typeof req.query["memberId"] === "string" ? req.query["memberId"] : USER_MEMBER_ID;
    const counts = conversationStore.getUnreadCountsForMember(memberId);
    return res.json(success({ counts }));
  });

  // POST /api/channels/:id/join — add a member.
  router.post("/:id/join", (req, res) => {
    const { id } = req.params;
    const conv = conversationStore.getConversation(id);
    if (conv?.kind !== "channel") {
      return res.status(404).json(notFound("Channel", id));
    }

    const body = req.body as { memberId?: unknown; memberKind?: unknown };
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    if (memberId.length === 0) {
      return res.status(400).json(badRequest("memberId is required"));
    }
    const memberKind: "user" | "agent" =
      body.memberKind === "user" ? "user" : memberId === USER_MEMBER_ID ? "user" : "agent";

    conversationStore.joinChannel(id, { memberId, memberKind });
    return res.json(success({ success: true }));
  });

  // POST /api/channels/:id/leave — remove a member.
  router.post("/:id/leave", (req, res) => {
    const { id } = req.params;
    const conv = conversationStore.getConversation(id);
    if (conv?.kind !== "channel") {
      return res.status(404).json(notFound("Channel", id));
    }

    const body = req.body as { memberId?: unknown };
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    if (memberId.length === 0) {
      return res.status(400).json(badRequest("memberId is required"));
    }

    conversationStore.leaveChannel(id, memberId);
    return res.json(success({ success: true }));
  });

  // POST /api/channels/:id/messages — post a message (member-only) + fan out.
  router.post("/:id/messages", (req, res) => {
    const { id } = req.params;
    const conv = conversationStore.getConversation(id);
    if (conv?.kind !== "channel") {
      return res.status(404).json(notFound("Channel", id));
    }

    const body = req.body as { body?: unknown; senderId?: unknown; metadata?: unknown };
    const text = typeof body.body === "string" ? body.body : "";
    if (text.length === 0) {
      return res.status(400).json(badRequest("body is required"));
    }
    const senderId = typeof body.senderId === "string" ? body.senderId : USER_MEMBER_ID;

    // Enforce membership: non-members get 403, not a generic 500.
    const members = conversationStore.getMembers(id);
    const isMember = members.some((m) => m.memberId === senderId);
    if (!isMember) {
      return res.status(403).json(forbidden(`${senderId} is not a member of this channel`));
    }

    const postInput: Parameters<typeof conversationStore.postToChannel>[0] = {
      channelId: id,
      senderId,
      body: text,
    };
    if (body.metadata !== undefined && body.metadata !== null) {
      postInput.metadata = body.metadata as Record<string, unknown>;
    }
    const message = conversationStore.postToChannel(postInput);

    wsBroadcastToConversation(id, {
      type: "chat_message",
      id: message.id,
      from: senderId,
      to: id,
      body: message.body,
      timestamp: message.createdAt,
      conversationId: id,
      metadata: message.metadata ?? undefined,
    });

    // adj-164.7.3: notify the operator of channel posts they did not author.
    // View-time suppression is handled client-side (iOS NotificationService).
    if (
      senderId !== USER_MEMBER_ID &&
      members.some((m) => m.memberId === USER_MEMBER_ID) &&
      isAPNsConfigured()
    ) {
      const truncated = text.length > 200 ? text.slice(0, 197) + "..." : text;
      sendNotificationToAll({
        title: conv.title ? `#${conv.title}` : "Channel message",
        body: `${senderId}: ${truncated}`,
        sound: "default",
        category: "CHANNEL_MESSAGE",
        threadId: id,
        data: {
          type: "channel_message",
          conversationId: id,
          channelTitle: conv.title ?? undefined,
          senderId,
          body: truncated,
        },
      }).catch((err) => {
        logWarn("Failed to send APNS for channel post", { error: String(err), channelId: id });
      });
    }

    return res.status(201).json(success({ messageId: message.id, timestamp: message.createdAt }));
  });

  return router;
}
