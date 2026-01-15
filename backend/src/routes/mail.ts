/**
 * Mail routes for the gastown-boy API.
 *
 * Endpoints:
 * - GET  /api/mail        - List all mail messages
 * - POST /api/mail        - Send a new message
 * - GET  /api/mail/:id    - Get a single message by ID
 * - POST /api/mail/:id/read - Mark a message as read
 */

import { Router } from "express";
import { listMail, getMessage, sendMail, markRead } from "../services/mail-service.js";
import { SendMessageRequestSchema } from "../types/index.js";
import {
  success,
  paginated,
  notFound,
  validationError,
  internalError,
} from "../utils/responses.js";

export const mailRouter = Router();

/**
 * GET /api/mail
 * List all mail messages, sorted by newest first.
 */
mailRouter.get("/", async (req, res) => {
  const showAll = req.query["all"] === "true";
  const result = await listMail(showAll ? null : undefined);

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to fetch mail")
    );
  }

  const messages = result.data ?? [];
  return res.json(success(paginated(messages, messages.length, false)));
});

/**
 * POST /api/mail
 * Send a new message.
 */
mailRouter.post("/", async (req, res) => {
  const parseResult = SendMessageRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    return res.status(400).json(
      validationError(firstIssue?.message ?? "Invalid request body")
    );
  }

  const result = await sendMail(parseResult.data);

  if (!result.success) {
    const statusCode = result.error?.code === "VALIDATION_ERROR" ? 400 : 500;
    return res.status(statusCode).json(
      internalError(result.error?.message ?? "Failed to send message")
    );
  }

  return res.status(201).json(success({ sent: true }));
});

/**
 * GET /api/mail/:id
 * Get a single message by ID.
 */
mailRouter.get("/:id", async (req, res) => {
  const { id } = req.params;

  const result = await getMessage(id);

  if (!result.success) {
    if (result.error?.code === "NOT_FOUND" || result.error?.code === "INVALID_ARGUMENT") {
      return res.status(404).json(notFound("Message", id));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to fetch message")
    );
  }

  return res.json(success(result.data));
});

/**
 * POST /api/mail/:id/read
 * Mark a message as read. Idempotent.
 */
mailRouter.post("/:id/read", async (req, res) => {
  const { id } = req.params;

  const result = await markRead(id);

  if (!result.success) {
    if (result.error?.code === "NOT_FOUND" || result.error?.code === "INVALID_ARGUMENT") {
      return res.status(404).json(notFound("Message", id));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to mark message as read")
    );
  }

  return res.status(200).json(success({ read: true }));
});
