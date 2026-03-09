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
  getCallsigns,
  pickRandomCallsign,
} from "../services/callsign-service.js";
import { getProject } from "../services/projects-service.js";
import { getPersonaService } from "../services/persona-service.js";
import { generatePersonaPrompt } from "../services/prompt-generator.js";
import { writeAgentFile } from "../services/agent-file-writer.js";
import {
  success,
  notFound,
  badRequest,
  conflict,
  validationError,
} from "../utils/index.js";

export const sessionsRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  projectPath: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  mode: z.literal("swarm").optional(),
  workspaceType: z.enum(["primary", "worktree", "copy"]).optional(),
  claudeArgs: z.array(z.string()).optional(),
  personaId: z.string().min(1).optional(),
}).refine(
  (data) => data.projectPath || data.projectId,
  { message: "Either projectPath or projectId is required" },
);

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
 * GET /api/sessions/callsigns
 * List all StarCraft callsigns with availability status.
 */
sessionsRouter.get("/callsigns", (_req, res) => {
  const bridge = getSessionBridge();
  const sessions = bridge.listSessions();
  const callsigns = getCallsigns(sessions);
  return res.json(success(callsigns));
});

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
 * Optional personaId writes .claude/agents/<name>.md and passes --agent flag, sets ADJUTANT_PERSONA_ID.
 */
sessionsRouter.post("/", async (req, res) => {
  const parsed = CreateSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  const data = parsed.data;
  const bridge = getSessionBridge();

  // Resolve projectPath from projectId if not provided directly
  let projectPath = data.projectPath;
  if (!projectPath && data.projectId) {
    const projectResult = getProject(data.projectId);
    if (!projectResult.success || !projectResult.data) {
      return res.status(404).json(notFound("Project", data.projectId));
    }
    projectPath = projectResult.data.path;
  }

  if (!projectPath) {
    return res.status(400).json(badRequest("Could not resolve project path"));
  }

  // Look up persona if personaId is provided
  let persona = null;
  let personaPrompt: string | undefined;

  if (data.personaId) {
    const personaService = getPersonaService();
    if (!personaService) {
      return res.status(500).json(badRequest("Persona service not initialized"));
    }
    persona = personaService.getPersona(data.personaId);
    if (!persona) {
      return res.status(404).json(notFound("Persona", data.personaId));
    }
    personaPrompt = generatePersonaPrompt(persona);
  }

  // If an explicit name was provided, check for conflicts with active sessions
  if (data.name) {
    const sessions = bridge.listSessions();
    const nameInUse = sessions.some(
      (s) => s.name === data.name && s.status !== "offline"
    );
    if (nameInUse) {
      return res
        .status(409)
        .json(conflict(`Agent name '${data.name}' is already in use`));
    }
  }

  // Auto-assign a callsign if no name provided.
  // Fallback priority: explicit name > random callsign > persona name > project-based name
  const sessions = bridge.listSessions();
  const callsign = pickRandomCallsign(sessions);
  const name = data.name || callsign?.name || persona?.name || `${basename(projectPath)}-agent`;

  // Build claudeArgs — add --agent flag if persona prompt was generated
  const claudeArgs = [...(data.claudeArgs ?? [])];

  if (personaPrompt && persona) {
    const agentName = await writeAgentFile(projectPath, persona.name, personaPrompt);
    claudeArgs.push("--agent", agentName);
  }

  // Build env vars with persona ID
  const envVars: Record<string, string> = {};
  if (data.personaId) {
    envVars["ADJUTANT_PERSONA_ID"] = data.personaId;
  }

  // Write persona prompt as .claude/agents/<name>.md and pass --agent flag
  // instead of injecting via paste-buffer (FR-001, FR-002, FR-005).
  const result = await bridge.createSession({
    name,
    projectPath,
    mode: data.mode ?? "swarm",
    workspaceType: data.workspaceType ?? "primary",
    claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
    envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
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
