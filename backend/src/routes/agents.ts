/**
 * Agents route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/agents - Get all agents as CrewMember list
 * - POST /api/agents/spawn-polecat - Request polecat spawn for a rig
 * - GET /api/agents/session/:sessionId/terminal - Capture swarm agent terminal content
 * - GET /api/agents/:rig/:polecat/terminal - Capture polecat terminal content (legacy)
 */

import { Router } from "express";
import { z } from "zod";
import { getAgents } from "../services/agents-service.js";
import { getSessionBridge } from "../services/session-bridge.js";
import { pickRandomCallsign } from "../services/callsign-service.js";
import { captureTmuxPane, listTmuxSessions } from "../services/tmux.js";
import { success, internalError, badRequest, notFound, conflict } from "../utils/responses.js";

export const agentsRouter = Router();

/**
 * GET /api/agents
 * Returns all agents in the gastown system as a CrewMember list
 * for the crew stats dashboard.
 */
agentsRouter.get("/", async (_req, res) => {
  const result = await getAgents();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to get agents list")
    );
  }

  return res.json(success(result.data));
});

/**
 * Request body schema for spawn polecat endpoint.
 */
const spawnPolecatSchema = z.object({
  projectPath: z.string().min(1, "Project path is required"),
  callsign: z.string().optional(),
});

/**
 * POST /api/agents/spawn-polecat
 * Creates a new agent session for the given project.
 */
agentsRouter.post("/spawn-polecat", async (req, res) => {
  const parsed = spawnPolecatSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json(
      badRequest(parsed.error.issues[0]?.message ?? "Invalid request")
    );
  }

  const { projectPath, callsign } = parsed.data;
  const bridge = getSessionBridge();

  // Check for name conflicts with active sessions
  if (callsign) {
    const sessions = bridge.listSessions();
    const nameInUse = sessions.some(
      (s) => s.name === callsign && s.status !== "offline"
    );
    if (nameInUse) {
      return res.status(409).json(
        conflict(`Agent name '${callsign}' is already in use`)
      );
    }
  }

  // Auto-assign callsign if not provided
  const sessions = bridge.listSessions();
  const auto = pickRandomCallsign(sessions);
  const name = callsign || auto?.name || "agent";

  const result = await bridge.createSession({
    name,
    projectPath,
    mode: "swarm",
    workspaceType: "primary",
    claudeArgs: [],
  });

  if (!result.success) {
    return res.status(400).json(
      badRequest(result.error ?? "Failed to spawn agent")
    );
  }

  const session = bridge.getSession(result.sessionId!);
  return res.status(201).json(success({
    sessionId: result.sessionId,
    callsign: session?.name ?? name,
    projectPath,
    spawned: true,
  }));
});

/**
 * GET /api/agents/session/:sessionId/terminal
 * Captures terminal content for a swarm agent by session ID.
 * Looks up the tmux session via SessionBridge.
 */
agentsRouter.get("/session/:sessionId/terminal", async (req, res) => {
  const { sessionId } = req.params;

  const bridge = getSessionBridge();
  const session = bridge.getSession(sessionId);

  if (!session) {
    return res.status(404).json(
      notFound("Session", sessionId)
    );
  }

  // Verify tmux session is running
  const sessions = await listTmuxSessions();
  if (!sessions.has(session.tmuxSession)) {
    return res.status(404).json(
      notFound("Terminal session", session.tmuxSession)
    );
  }

  try {
    const content = await captureTmuxPane(session.tmuxSession);

    return res.json(
      success({
        content,
        sessionId,
        sessionName: session.tmuxSession,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to capture terminal";
    return res.status(500).json(internalError(message));
  }
});

/**
 * GET /api/agents/:rig/:polecat/terminal
 * Captures and returns the terminal content for a polecat's tmux session.
 * Includes ANSI escape codes for proper terminal rendering with xterm.js.
 */
agentsRouter.get("/:rig/:polecat/terminal", async (req, res) => {
  const { rig, polecat } = req.params;

  // Build the expected tmux session name
  const sessionName = `gt-${rig}-${polecat}`;

  // Check if session exists
  const sessions = await listTmuxSessions();
  if (!sessions.has(sessionName)) {
    return res.status(404).json(
      notFound("Terminal session", sessionName)
    );
  }

  try {
    const content = await captureTmuxPane(sessionName);

    return res.json(
      success({
        content,
        sessionName,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to capture terminal";
    return res.status(500).json(internalError(message));
  }
});
