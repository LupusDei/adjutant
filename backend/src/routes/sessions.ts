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
import { success, error } from "../utils/responses.js";
import {
  getAllSessions,
  getSession,
  discoverSessions,
} from "../services/session/session-bridge.js";
import { launchSession } from "../services/session/lifecycle-manager.js";
import { killSession } from "../services/session/lifecycle-manager.js";

export const sessionsRouter = Router();

sessionsRouter.get("/", (_req, res) => {
  res.json(success(getAllSessions()));
});

sessionsRouter.get("/:id", (req, res) => {
  const session = getSession(req.params["id"]!);
  if (!session) {
    res.status(404).json(error("not_found", "Session not found"));
    return;
  }
  res.json(success(session));
});

sessionsRouter.post("/", async (req, res) => {
  const { name, projectPath, mode, workspaceType } = req.body;
  if (!projectPath) {
    res.status(400).json(error("bad_request", "projectPath is required"));
    return;
  }

  try {
    const session = await launchSession({
      name: name ?? `session-${Date.now()}`,
      projectPath,
      mode: mode ?? "standalone",
      workspaceType,
    });
    res.status(201).json(success(session));
  } catch (err) {
    res.status(500).json(error("launch_failed", String(err instanceof Error ? err.message : err)));
  }
});

sessionsRouter.delete("/:id", async (req, res) => {
  try {
    await killSession(req.params["id"]!);
    res.json(success({ killed: true }));
  } catch (err) {
    res.status(500).json(error("kill_failed", String(err instanceof Error ? err.message : err)));
  }
});

sessionsRouter.post("/discover", async (_req, res) => {
  try {
    const discovered = await discoverSessions();
    res.json(success({ discovered: discovered.length, sessions: discovered }));
  } catch (err) {
    res.status(500).json(error("discover_failed", String(err instanceof Error ? err.message : err)));
  }
});
