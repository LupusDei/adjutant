/**
 * Sessions route for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/sessions         - List all sessions
 * - GET    /api/sessions/:id     - Get session details
 * - POST   /api/sessions         - Create a new session
 * - POST   /api/sessions/:id/connect    - Connect client to session
 * - POST   /api/sessions/:id/disconnect - Disconnect client from session
 * - POST   /api/sessions/:id/input      - Send input to session
 * - POST   /api/sessions/:id/interrupt  - Send Ctrl-C to session
 * - POST   /api/sessions/:id/permission - Respond to permission prompt
 * - DELETE /api/sessions/:id     - Kill a session
 */

import { Router } from "express";
import { basename } from "path";
import { z } from "zod";
import { getSessionBridge } from "../services/session-bridge.js";
import {
  success,
  notFound,
  badRequest,
  validationError,
} from "../utils/index.js";

export const sessionsRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  projectPath: z.string().min(1, "Project path is required"),
  mode: z.enum(["swarm", "gastown"]).optional(),
  workspaceType: z.enum(["primary", "worktree", "copy"]).optional(),
  claudeArgs: z.array(z.string()).optional(),
});

const ConnectSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  replay: z.boolean().optional(),
});

const InputSchema = z.object({
  text: z.string().min(1, "Text is required"),
});

const PermissionSchema = z.object({
  approved: z.boolean(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/sessions
 * List all managed sessions.
 */
sessionsRouter.get("/", (_req, res) => {
  const bridge = getSessionBridge();
  const sessions = bridge.listSessions();
  return res.json(success(sessions));
});

/**
 * GET /api/sessions/:id
 * Get details for a specific session.
 */
sessionsRouter.get("/:id", (req, res) => {
  const bridge = getSessionBridge();
  const session = bridge.getSession(req.params.id);

  if (!session) {
    return res.status(404).json(notFound("Session", req.params.id));
  }

  return res.json(success(session));
});

/**
 * POST /api/sessions
 * Create a new session.
 */
sessionsRouter.post("/", async (req, res) => {
  const parsed = CreateSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  const data = parsed.data;
  const name = data.name || `${basename(data.projectPath)}-agent`;

  const bridge = getSessionBridge();
  const result = await bridge.createSession({
    name,
    projectPath: data.projectPath,
    mode: data.mode ?? "swarm",
    workspaceType: data.workspaceType ?? "primary",
    claudeArgs: data.claudeArgs ?? [],
  });

  if (!result.success) {
    return res.status(400).json(badRequest(result.error ?? "Failed to create session"));
  }

  const session = bridge.getSession(result.sessionId!);
  return res.status(201).json(success(session));
});

/**
 * POST /api/sessions/:id/connect
 * Connect a WebSocket client to a session.
 */
sessionsRouter.post("/:id/connect", async (req, res) => {
  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  const bridge = getSessionBridge();
  const result = await bridge.connectClient(
    req.params.id,
    parsed.data.clientId,
    parsed.data.replay
  );

  if (!result.success) {
    return res.status(400).json(badRequest(result.error ?? "Failed to connect"));
  }

  return res.json(success({ connected: true, buffer: result.buffer }));
});

/**
 * POST /api/sessions/:id/disconnect
 * Disconnect a WebSocket client from a session.
 */
sessionsRouter.post("/:id/disconnect", async (req, res) => {
  const { clientId } = req.body ?? {};
  if (!clientId) {
    return res.status(400).json(badRequest("clientId is required"));
  }

  const bridge = getSessionBridge();
  await bridge.disconnectClient(req.params.id, clientId);
  return res.json(success({ disconnected: true }));
});

/**
 * POST /api/sessions/:id/input
 * Send text input to a session.
 */
sessionsRouter.post("/:id/input", async (req, res) => {
  const parsed = InputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  const bridge = getSessionBridge();
  const sent = await bridge.sendInput(req.params.id, parsed.data.text);

  if (!sent) {
    return res.status(400).json(badRequest("Failed to send input"));
  }

  return res.json(success({ sent: true }));
});

/**
 * POST /api/sessions/:id/interrupt
 * Send Ctrl-C interrupt to a session.
 */
sessionsRouter.post("/:id/interrupt", async (req, res) => {
  const bridge = getSessionBridge();
  const sent = await bridge.sendInterrupt(req.params.id);

  if (!sent) {
    return res.status(400).json(badRequest("Failed to send interrupt"));
  }

  return res.json(success({ interrupted: true }));
});

/**
 * POST /api/sessions/:id/permission
 * Respond to a permission prompt.
 */
sessionsRouter.post("/:id/permission", async (req, res) => {
  const parsed = PermissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  const bridge = getSessionBridge();
  const sent = await bridge.sendPermissionResponse(
    req.params.id,
    parsed.data.approved
  );

  if (!sent) {
    return res.status(400).json(badRequest("Failed to send permission response"));
  }

  return res.json(success({ sent: true }));
});

/**
 * DELETE /api/sessions/:id
 * Kill a session and clean up.
 */
sessionsRouter.delete("/:id", async (req, res) => {
  const bridge = getSessionBridge();
  const killed = await bridge.killSession(req.params.id);

  if (!killed) {
    return res.status(404).json(notFound("Session", req.params.id));
  }

  return res.json(success({ killed: true }));
});
