/**
 * Sessions REST API — CRUD for managed tmux sessions.
 *
 * GET    /api/sessions          — list all sessions
 * GET    /api/sessions/:id      — get single session
 * POST   /api/sessions          — create a new session
 * DELETE /api/sessions/:id      — kill a session
 * POST   /api/sessions/discover — trigger session discovery
 */

import { Router } from "express";
import { z } from "zod";
import { success, badRequest, notFound, internalError } from "../utils/responses.js";
import {
  getAllSessions,
  getSession,
  discoverSessions,
} from "../services/session/session-bridge.js";
import { launchSession, killSession } from "../services/session/lifecycle-manager.js";

export const sessionsRouter = Router();

const createSessionSchema = z.object({
  name: z.string().min(1).optional(),
  projectPath: z.string().min(1, "projectPath is required"),
  mode: z.enum(["standalone", "swarm", "gastown"]).default("standalone"),
  workspaceType: z.enum(["primary", "worktree", "copy"]).default("primary"),
});

sessionsRouter.get("/", (_req, res) => {
  res.json(success(getAllSessions()));
});

sessionsRouter.get("/:id", (req, res) => {
  const session = getSession(req.params["id"]!);
  if (!session) {
    res.status(404).json(notFound("Session", req.params["id"]));
    return;
  }
  res.json(success(session));
});

sessionsRouter.post("/", async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badRequest(parsed.error.issues[0]?.message ?? "Invalid request"));
    return;
  }

  const { name, projectPath, mode, workspaceType } = parsed.data;

  try {
    const session = await launchSession({
      name: name ?? `session-${Date.now()}`,
      projectPath,
      mode,
      workspaceType,
    });
    res.status(201).json(success(session));
  } catch (err) {
    res.status(500).json(internalError(String(err instanceof Error ? err.message : err)));
  }
});

sessionsRouter.delete("/:id", async (req, res) => {
  try {
    await killSession(req.params["id"]!);
    res.json(success({ killed: true }));
  } catch (err) {
    res.status(500).json(internalError(String(err instanceof Error ? err.message : err)));
  }
});

sessionsRouter.post("/discover", async (_req, res) => {
  try {
    const discovered = await discoverSessions();
    res.json(success({ discovered: discovered.length, sessions: discovered }));
  } catch (err) {
    res.status(500).json(internalError(String(err instanceof Error ? err.message : err)));
  }
});
