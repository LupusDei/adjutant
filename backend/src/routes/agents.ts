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
import { pickRandomCallsign, nextAvailableName } from "../services/callsign-service.js";
import { captureTmuxPane, listTmuxSessions } from "../services/tmux.js";
import { getProject } from "../services/projects-service.js";
import { getPersonaService } from "../services/persona-service.js";
import { generatePersonaPrompt } from "../services/prompt-generator.js";
import { writeAgentFile } from "../services/agent-file-writer.js";
import { buildGenesisPrompt, extractLoreExcerpt } from "../services/adjutant/genesis-prompt.js";
import { success, internalError, badRequest, notFound, conflict } from "../utils/responses.js";

/**
 * Generate the Layer 3 (Squad Leader) identity preamble for a spawned agent (adj-145).
 *
 * Agents spawned via the REST API (frontend/iOS) were starting without knowing
 * their role, name, or reporting instructions. This preamble ensures they
 * bootstrap correctly as named Squad Leaders.
 */
function buildAgentIdentityPrompt(agentName: string, projectName: string): string {
  return [
    `## Your Role (Layer 3: Squad Leader)`,
    `You are ${agentName}, a Squad Leader spawned via the Adjutant dashboard.`,
    `- Your name (for --assignee and set_status): ${agentName}`,
    `- Your project: ${projectName}`,
    `- You report UP to the General (user) via MCP messages (send_message, set_status, announce)`,
    `- You may spawn DOWN native Claude Code teammates with isolation: "worktree" for parallel work`,
    `- Route ALL questions to the General via MCP — never use AskUserQuestion`,
    ``,
    `## On Startup`,
    `1. Call set_status({ status: "working", task: "Starting as ${agentName}: awaiting orders" })`,
    `2. Call read_messages({ agentId: "${agentName}", limit: 5 }) to check for pending instructions`,
    `3. If you have assigned beads, run: bd update <id> --assignee=${agentName} --status=in_progress`,
    ``,
    `## Task Tracking`,
    `Use the \`bd\` CLI for ALL task tracking. Do NOT use TaskCreate or TaskUpdate.`,
    `Before starting work: bd update <id> --assignee=${agentName} --status=in_progress`,
    `After completing work: npm run build && npm test && git commit && bd close <id>`,
  ].join("\n");
}

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
});

/**
 * POST /api/agents/spawn
 * Creates a new agent session for the given project.
 * Accepts either projectPath or projectId (resolved via project registry).
 * Optional personaId writes .claude/agents/<name>.md and passes --agent flag, sets ADJUTANT_PERSONA_ID.
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

  // Fall back to ADJUTANT_PROJECT_ROOT or cwd when no project specified
  if (!projectPath) {
    projectPath = process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd();
  }

  // Look up persona if personaId is provided, or check callsign linkage
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
  } else if (parsed.data.callsign) {
    // Living Personas (adj-158.3.3): Check if the callsign has a linked persona
    const personaService = getPersonaService();
    if (personaService) {
      const linkedPersona = personaService.getPersonaByCallsign(parsed.data.callsign);
      if (linkedPersona) {
        persona = linkedPersona;
        personaPrompt = generatePersonaPrompt(linkedPersona);
      }
    }
    // If no linked persona, genesis prompt injection happens in agent-spawner-service
  }

  const { callsign } = parsed.data;
  const bridge = getSessionBridge();
  const sessions = bridge.listSessions();

  // Resolve agent name based on persona vs non-persona spawn
  let name: string;
  if (persona) {
    // Persona spawn: use explicit callsign or persona name as base, auto-suffix if taken
    const baseName = callsign || persona.name.toLowerCase();
    const resolved = nextAvailableName(sessions, baseName);
    if (!resolved) {
      return res.status(409).json(
        conflict(`All name variants for '${baseName}' are in use`)
      );
    }
    name = resolved;
  } else if (callsign) {
    // Non-persona with explicit callsign: 409 if taken (original behavior)
    const nameInUse = sessions.some(
      (s) => s.name === callsign && s.status !== "offline"
    );
    if (nameInUse) {
      return res.status(409).json(
        conflict(`Agent name '${callsign}' is already in use`)
      );
    }
    name = callsign;
  } else {
    // Non-persona, no callsign: random StarCraft name
    const auto = pickRandomCallsign(sessions);
    name = auto?.name || "agent";
  }

  // Build env vars with persona ID — use persona.id (not personaId) so that
  // callsign-linked personas also get the env var set (adj-180)
  const envVars: Record<string, string> = {};
  if (persona) {
    envVars["ADJUTANT_PERSONA_ID"] = persona.id;
  }

  // Write persona prompt as .claude/agents/<name>.md and pass --agent flag
  // instead of injecting via paste-buffer (FR-001, FR-002, FR-005).
  let claudeArgs: string[] | undefined;
  if (personaPrompt && persona) {
    const agentName = await writeAgentFile(projectPath, persona.name, personaPrompt, persona.description);
    claudeArgs = ["--agent", agentName];
  }

  // Generate initial prompt for non-persona spawns.
  // Two cases: (1) callsign has no persona → genesis prompt, (2) normal Layer 3 preamble.
  let initialPrompt: string | undefined;
  if (!personaPrompt) {
    // Resolve project name for the preamble
    let projectName = "unknown";
    if (parsed.data.projectId) {
      const proj = getProject(parsed.data.projectId);
      if (proj.success && proj.data) projectName = proj.data.name;
    }

    // Living Personas (adj-159 fix): Check if this callsign needs genesis
    const personaService = getPersonaService();
    const hasPersona = personaService?.getPersonaByCallsign(name);
    if (!hasPersona && personaService) {
      // No persona — inject genesis prompt so agent self-defines before working
      const loreExcerpt = extractLoreExcerpt(name);
      const identityPreamble = buildAgentIdentityPrompt(name, projectName);
      const genesisPrompt = buildGenesisPrompt(name, loreExcerpt, identityPreamble);
      initialPrompt = genesisPrompt;
    } else {
      initialPrompt = buildAgentIdentityPrompt(name, projectName);
    }
  }

  const result = await bridge.createSession({
    name,
    projectPath,
    mode: "swarm",
    workspaceType: "primary",
    claudeArgs,
    envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
    initialPrompt,
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
