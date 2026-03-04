/**
 * Agents route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/agents - Get all agents as CrewMember list
 * - POST /api/agents/spawn - Create a new agent session (supports personaId)
 * - GET /api/agents/session/:sessionId/terminal - Capture swarm agent terminal content
 */

import { Router } from "express";
import { z } from "zod";
import { getAgents } from "../services/agents-service.js";
import { getSessionBridge } from "../services/session-bridge.js";
import { pickRandomCallsign } from "../services/callsign-service.js";
import { captureTmuxPane, listTmuxSessions } from "../services/tmux.js";
import { getProject } from "../services/projects-service.js";
import { getPersonaService } from "../services/persona-service.js";
import { generatePersonaPrompt } from "../services/prompt-generator.js";
import { success, internalError, badRequest, notFound, conflict } from "../utils/responses.js";

export const agentsRouter = Router();

/**
 * GET /api/agents
 * Returns all agents as a CrewMember list for the crew stats dashboard.
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
 * Request body schema for spawn agent endpoint.
 * Accepts either projectPath (absolute) or projectId (resolved via registry).
 * Optional personaId to spawn with a specific persona.
 */
const spawnAgentSchema = z.object({
  projectPath: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  callsign: z.string().optional(),
  personaId: z.string().min(1).optional(),
}).refine(
  (data) => data.projectPath || data.projectId,
  { message: "Either projectPath or projectId is required" },
);

/**
 * POST /api/agents/spawn
 * Creates a new agent session for the given project.
 * Accepts either projectPath or projectId (resolved via project registry).
 * Optional personaId injects persona prompt via --prompt and sets ADJUTANT_PERSONA_ID.
 */
agentsRouter.post("/spawn", async (req, res) => {
  const parsed = spawnAgentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json(
      badRequest(parsed.error.issues[0]?.message ?? "Invalid request")
    );
  }

  // Resolve projectPath from projectId if not provided directly
  let projectPath = parsed.data.projectPath;
  if (!projectPath && parsed.data.projectId) {
    const projectResult = getProject(parsed.data.projectId);
    if (!projectResult.success || !projectResult.data) {
      return res.status(404).json(
        notFound("Project", parsed.data.projectId)
      );
    }
    projectPath = projectResult.data.path;
  }

  if (!projectPath) {
    return res.status(400).json(badRequest("Could not resolve project path"));
  }

  // Look up persona if personaId is provided
  let persona = null;
  let personaPrompt: string | undefined;
  const { personaId } = parsed.data;

  if (personaId) {
    const personaService = getPersonaService();
    if (!personaService) {
      return res.status(500).json(
        internalError("Persona service not initialized")
      );
    }
    persona = personaService.getPersona(personaId);
    if (!persona) {
      return res.status(404).json(
        notFound("Persona", personaId)
      );
    }
    personaPrompt = generatePersonaPrompt(persona);
  }

  const { callsign } = parsed.data;
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

  // Auto-assign callsign if not provided.
  // Fallback priority: explicit callsign > random callsign > persona name > "agent"
  const sessions = bridge.listSessions();
  const auto = pickRandomCallsign(sessions);
  const name = callsign || auto?.name || persona?.name || "agent";

  // Build claudeArgs with persona prompt injection
  const claudeArgs: string[] = [];
  if (personaPrompt) {
    claudeArgs.push("--prompt", personaPrompt);
  }

  // Build env vars with persona ID
  const envVars: Record<string, string> = {};
  if (personaId) {
    envVars["ADJUTANT_PERSONA_ID"] = personaId;
  }

  const result = await bridge.createSession({
    name,
    projectPath,
    mode: "swarm",
    workspaceType: "primary",
    claudeArgs,
    envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
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
    ...(persona ? { personaId: persona.id, personaName: persona.name } : {}),
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
  const tmuxSessions = await listTmuxSessions();
  if (!tmuxSessions.has(session.tmuxSession)) {
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
 * POST /api/agents/spawn-polecat
 * Legacy alias for /spawn (backward compatibility).
 */
agentsRouter.post("/spawn-polecat", (req, _res, next) => {
  req.url = "/spawn";
  next("route");
});
