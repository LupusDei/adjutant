/**
 * Mail routes for the Adjutant API.
 *
 * Endpoints:
 * - GET  /api/mail        - List all mail messages
 * - POST /api/mail        - Send a new message
 * - GET  /api/mail/:id    - Get a single message by ID
 * - POST /api/mail/:id/read - Mark a message as read
 */

import { Router } from "express";
import { listMail, getMessage, sendMail, markRead, getMailIdentity } from "../services/mail-service.js";
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
 *
 * Query params:
 * - filter: "user" | "infrastructure" | undefined (default: all)
 * - all: "true" to include all messages (overrides default filters)
 */
mailRouter.get("/", async (req, res) => {
  const showAll = req.query["all"] === "true";
  const filter = req.query["filter"] as string | undefined;
  const result = await listMail(showAll ? null : undefined);

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to fetch mail")
    );
  }

  let messages = result.data ?? [];

  // Apply infrastructure filter if specified
  if (filter === "user") {
    messages = messages.filter((m) => !m.isInfrastructure);
  } else if (filter === "infrastructure") {
    messages = messages.filter((m) => m.isInfrastructure);
  }

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
 * GET /api/mail/identity
 * Get the current mail sender identity.
 */
mailRouter.get("/identity", (_req, res) => {
  const identity = getMailIdentity();
  return res.json(success({ identity }));
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
