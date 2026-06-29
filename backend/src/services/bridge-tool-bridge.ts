/**
 * The Bridge — read-only tool bridge (adj-202.3.2).
 *
 * A READ-ONLY, whitelisted adapter that lets the Adjutant avatar answer
 * fleet-status questions by calling the SAME service layer the MCP tools use.
 * This is deliberately NOT a second control plane (Constitution Rules 4 + 9):
 * every tool here delegates to an existing service function — it adds whitelist
 * enforcement, projectId scoping, and a uniform STRUCTURED result envelope, and
 * nothing else.
 *
 * The structured result is the source of truth; the voice only narrates it later.
 * So every handler returns plain data (never the human-readable text the MCP
 * tool envelopes produce).
 *
 * Cross-project reads are ALLOWED here: the avatar embodies the Layer-2
 * coordinator, and every call names its target projectId. Tools that need a
 * project's `.beads/` directory (list_beads, get_project_state,
 * get_auto_develop_status) REQUIRE a projectId; fleet-wide tools (list_agents,
 * list_questions) treat it as an optional filter.
 *
 * IMPORTANT: only the five read-only tools below are reachable. Anything else —
 * including write tools that exist in the MCP surface (create_bead, close_bead,
 * send_message, …) — is rejected with a structured TOOL_NOT_ALLOWED error.
 */

import { z } from "zod";

import { getAgents } from "./agents-service.js";
import { getConnectedAgents } from "./mcp-server.js";
import { getProject, type Project } from "./projects-service.js";
import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { buildAutoDevelopStatus } from "./auto-develop-status.js";
import { resolveAgentName } from "./bridge-agent-resolver.js";
import type { MessageStore } from "./message-store.js";
import type { ProposalStore } from "./proposal-store.js";
import type { AutoDevelopStore } from "./auto-develop-store.js";
import type { QuestionService } from "./question-service.js";

// ============================================================================
// Whitelist
// ============================================================================

/** The exact set of read-only tools the avatar may call. */
export const BRIDGE_READONLY_TOOLS = [
  "get_project_state",
  "list_agents",
  "get_agent_detail",
  "list_questions",
  "list_beads",
  "get_auto_develop_status",
  "read_messages",
] as const;

export type BridgeToolName = (typeof BRIDGE_READONLY_TOOLS)[number];

const ALLOWED_TOOLS: ReadonlySet<string> = new Set<string>(BRIDGE_READONLY_TOOLS);

// ============================================================================
// Public types
// ============================================================================

/**
 * The slice of the existing service layer the bridge needs injected. Module-level
 * functions (getAgents, getConnectedAgents, getProject, execBd, buildAutoDevelopStatus)
 * are imported directly; only the stateful stores/services are passed in so the
 * caller controls their lifecycle (and tests can substitute fakes).
 */
export interface BridgeToolDeps {
  messageStore: Pick<MessageStore, "getMessages" | "getUnreadCounts">;
  proposalStore: ProposalStore;
  autoDevelopStore: AutoDevelopStore | undefined;
  questionService: Pick<QuestionService, "listQuestions">;
}

export interface BridgeToolRequest {
  /** Tool name the avatar wants to call. */
  tool: string;
  /** Target project UUID. Required for project-scoped tools, optional otherwise. */
  projectId?: string | undefined;
  /** Tool-specific arguments. */
  args?: Record<string, unknown> | undefined;
}

export interface BridgeToolErrorBody {
  code: string;
  message: string;
}

export type BridgeToolResult =
  | { ok: true; tool: BridgeToolName; projectId: string | null; data: unknown }
  | { ok: false; tool: string; projectId: string | null; error: BridgeToolErrorBody };

export interface BridgeToolBridge {
  /** Execute a whitelisted, read-only tool and return a structured result. */
  executeTool(req: BridgeToolRequest): Promise<BridgeToolResult>;
  /** Type guard: is the given tool name on the read-only whitelist? */
  isAllowed(tool: string): tool is BridgeToolName;
  /** The list of callable tool names. */
  listTools(): BridgeToolName[];
}

// ============================================================================
// Result helpers
// ============================================================================

function ok(tool: BridgeToolName, projectId: string | null, data: unknown): BridgeToolResult {
  return { ok: true, tool, projectId, data };
}

function reject(
  tool: string,
  projectId: string | null,
  code: string,
  message: string,
): BridgeToolResult {
  return { ok: false, tool, projectId, error: { code, message } };
}

// ============================================================================
// Per-tool argument schemas (defensive — this surface is reachable from the
// avatar's tool loop over HTTP).
// ============================================================================

const listAgentsArgs = z.object({
  status: z.enum(["active", "idle", "all"]).optional(),
});

const listQuestionsArgs = z.object({
  status: z.enum(["open", "answered", "dismissed"]).optional(),
  category: z.enum(["decision", "clarification", "approval", "action_required", "other"]).optional(),
  agentId: z.string().optional(),
  urgency: z.enum(["low", "normal", "high", "blocking"]).optional(),
});

const listBeadsArgs = z.object({
  status: z.enum(["open", "in_progress", "closed", "all"]).optional(),
  assignee: z.string().optional(),
  type: z.enum(["epic", "task", "bug"]).optional(),
});

const getAgentDetailArgs = z.object({
  agent: z.string().min(1),
});

const READ_MESSAGES_DEFAULT_LIMIT = 20;
const READ_MESSAGES_MAX_LIMIT = 50;

const readMessagesArgs = z.object({
  agentId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
});

// ============================================================================
// Project resolution
// ============================================================================

interface ResolvedProject {
  project: Project;
  cwd: string;
  beadsDir: string;
}

type ProjectResolution =
  | { ok: true; resolved: ResolvedProject }
  | { ok: false; code: string; message: string };

/**
 * Resolve a named projectId to its registry record + `.beads/` directory.
 * Returns a structured failure (never throws) so callers can map it to a
 * BridgeToolResult.
 */
function resolveProject(projectId: string | undefined): ProjectResolution {
  if (!projectId) {
    return { ok: false, code: "PROJECT_REQUIRED", message: "This tool requires a target projectId." };
  }

  const result = getProject(projectId);
  if (!result.success || !result.data) {
    return { ok: false, code: "PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` };
  }

  const project = result.data;
  let beadsDir: string;
  try {
    beadsDir = resolveBeadsDir(project.path);
  } catch {
    return {
      ok: false,
      code: "PROJECT_NOT_FOUND",
      message: `Could not resolve the beads directory for project '${projectId}'.`,
    };
  }

  return { ok: true, resolved: { project, cwd: project.path, beadsDir } };
}

// ============================================================================
// Factory
// ============================================================================

export function createBridgeToolBridge(deps: BridgeToolDeps): BridgeToolBridge {
  function isAllowed(tool: string): tool is BridgeToolName {
    return ALLOWED_TOOLS.has(tool);
  }

  async function executeTool(req: BridgeToolRequest): Promise<BridgeToolResult> {
    const tool = req.tool;
    const projectId = req.projectId ?? null;
    const args = req.args ?? {};

    // ---- Whitelist enforcement (fail-closed) ----
    if (!isAllowed(tool)) {
      return reject(
        tool,
        projectId,
        "TOOL_NOT_ALLOWED",
        `Tool '${tool}' is not in the read-only Bridge whitelist.`,
      );
    }

    try {
      switch (tool) {
        case "list_agents":
          return await runListAgents(deps, args, projectId);
        case "get_agent_detail":
          return await runGetAgentDetail(deps, args, projectId);
        case "list_questions":
          return runListQuestions(deps, args, projectId);
        case "list_beads":
          return await runListBeads(args, req.projectId);
        case "get_project_state":
          return await runGetProjectState(deps, req.projectId);
        case "get_auto_develop_status":
          return runGetAutoDevelopStatus(deps, req.projectId);
        case "read_messages":
          return await runReadMessages(deps, args, projectId);
        default:
          // Unreachable — isAllowed already gated the set, but keep TS exhaustive.
          return reject(tool, projectId, "TOOL_NOT_ALLOWED", `Tool '${String(tool)}' is not callable.`);
      }
    } catch (err) {
      return reject(
        tool,
        projectId,
        "TOOL_FAILED",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    executeTool,
    isAllowed,
    listTools: () => [...BRIDGE_READONLY_TOOLS],
  };
}

// ============================================================================
// Tool handlers — each delegates to the existing service layer.
// ============================================================================

const TOOL_LIST_AGENTS: BridgeToolName = "list_agents";
const TOOL_GET_AGENT_DETAIL: BridgeToolName = "get_agent_detail";
const TOOL_LIST_QUESTIONS: BridgeToolName = "list_questions";
const TOOL_LIST_BEADS: BridgeToolName = "list_beads";
const TOOL_GET_PROJECT_STATE: BridgeToolName = "get_project_state";
const TOOL_GET_AUTO_DEVELOP_STATUS: BridgeToolName = "get_auto_develop_status";
const TOOL_READ_MESSAGES: BridgeToolName = "read_messages";

async function runListAgents(
  _deps: BridgeToolDeps,
  args: Record<string, unknown>,
  projectId: string | null,
): Promise<BridgeToolResult> {
  const parsed = listAgentsArgs.safeParse(args);
  if (!parsed.success) {
    return reject(TOOL_LIST_AGENTS, projectId, "INVALID_ARGS", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const status = parsed.data.status ?? "all";

  // Delegate to the same sources list_agents (MCP) uses.
  const connected = getConnectedAgents();
  const connectedIds = new Set(connected.map((c) => c.agentId));

  const agentsResult = await getAgents();
  let agents = agentsResult.success && agentsResult.data ? agentsResult.data : [];

  // Cross-project read: when a projectId is named, scope to that project's crew.
  // getAgents() sets CrewMember.project to the project NAME (resolveProjectName),
  // NOT the UUID — so we must resolve the named projectId to its registry name
  // before comparing (adj-202.3.2.1). Comparing the UUID directly returns zero
  // agents and silently breaks cross-project reads.
  if (projectId) {
    const projectResult = getProject(projectId);
    if (!projectResult.success || !projectResult.data) {
      return reject(TOOL_LIST_AGENTS, projectId, "PROJECT_NOT_FOUND", `Project '${projectId}' not found.`);
    }
    const projectName = projectResult.data.name;
    agents = agents.filter((a) => a.project === projectName);
  }

  if (status === "active") {
    agents = agents.filter((a) => a.status === "working" || a.status === "blocked" || a.status === "stuck");
  } else if (status === "idle") {
    agents = agents.filter((a) => a.status === "idle");
  }

  const enriched = agents.map((a) => ({ ...a, connected: connectedIds.has(a.id) }));
  return ok(TOOL_LIST_AGENTS, projectId, { agents: enriched, count: enriched.length });
}

/**
 * get_agent_detail — "what is <agent> working on?" Resolves a spoken/typed agent name to a
 * registered agent (Phoenix → fenix), returns its live status + the beads it is actually
 * IN PROGRESS on (the reliable source of work — MCP `currentTask` is frequently empty). bd
 * runs in the agent's own project (falling back to the named projectId, else "adjutant").
 */
async function runGetAgentDetail(
  _deps: BridgeToolDeps,
  args: Record<string, unknown>,
  projectId: string | null,
): Promise<BridgeToolResult> {
  const parsed = getAgentDetailArgs.safeParse(args);
  if (!parsed.success) {
    return reject(TOOL_GET_AGENT_DETAIL, projectId, "INVALID_ARGS", parsed.error.issues.map((i) => i.message).join("; "));
  }

  const connectedIds = new Set(getConnectedAgents().map((c) => c.agentId));
  const agentsResult = await getAgents();
  const allAgents = agentsResult.success && agentsResult.data ? agentsResult.data : [];

  // Resolve the spoken/typed name to a registered agent (case/alias/phonetic/edit-distance).
  const resolution = resolveAgentName(parsed.data.agent, allAgents.map((a) => ({ id: a.id, name: a.name })));
  if (!resolution.matched || !resolution.canonical) {
    const hint = resolution.candidates.length ? ` Closest: ${resolution.candidates.join(", ")}.` : "";
    return reject(TOOL_GET_AGENT_DETAIL, projectId, "AGENT_NOT_FOUND", `No agent named '${parsed.data.agent}'.${hint}`);
  }
  const canonical = resolution.canonical;
  const agent = allAgents.find((a) => a.name === canonical);

  // Reliable "what are they working on": the beads bd reports as in_progress for this assignee.
  const projectKey = agent?.project ?? projectId ?? "adjutant";
  let inProgressBeads: BeadsIssue[] = [];
  let beadsError: string | undefined;
  const projResult = getProject(projectKey);
  if (projResult.success && projResult.data) {
    try {
      const beadsDir = resolveBeadsDir(projResult.data.path);
      const bdResult = await execBd<BeadsIssue[]>(
        ["list", "--assignee", canonical, "--status", "in_progress", "--json"],
        { cwd: projResult.data.path, beadsDir },
      );
      if (bdResult.success && Array.isArray(bdResult.data)) {
        inProgressBeads = bdResult.data;
      } else {
        beadsError = bdResult.error?.message ?? "bd list failed";
      }
    } catch (err) {
      beadsError = err instanceof Error ? err.message : String(err);
    }
  }

  return ok(TOOL_GET_AGENT_DETAIL, projectId, {
    agent: agent
      ? {
          name: agent.name,
          status: agent.status,
          currentTask: agent.currentTask ?? null,
          project: agent.project,
          connected: connectedIds.has(agent.id),
        }
      : { name: canonical, status: "unknown", currentTask: null, project: null, connected: false },
    inProgressBeads,
    inProgressCount: inProgressBeads.length,
    ...(beadsError ? { beadsError } : {}),
  });
}

function runListQuestions(
  deps: BridgeToolDeps,
  args: Record<string, unknown>,
  projectId: string | null,
): BridgeToolResult {
  const parsed = listQuestionsArgs.safeParse(args);
  if (!parsed.success) {
    return reject(TOOL_LIST_QUESTIONS, projectId, "INVALID_ARGS", parsed.error.issues.map((i) => i.message).join("; "));
  }

  // projectId is an optional scope: omitted ⇒ fleet-wide listing.
  const questions = deps.questionService.listQuestions({
    projectId: projectId ?? undefined,
    status: parsed.data.status,
    category: parsed.data.category,
    agentId: parsed.data.agentId,
    urgency: parsed.data.urgency,
  });

  return ok(TOOL_LIST_QUESTIONS, projectId, { questions, count: questions.length });
}

async function runListBeads(
  args: Record<string, unknown>,
  rawProjectId: string | undefined,
): Promise<BridgeToolResult> {
  const projectId = rawProjectId ?? null;

  const parsed = listBeadsArgs.safeParse(args);
  if (!parsed.success) {
    return reject(TOOL_LIST_BEADS, projectId, "INVALID_ARGS", parsed.error.issues.map((i) => i.message).join("; "));
  }

  const resolution = resolveProject(rawProjectId);
  if (!resolution.ok) {
    return reject(TOOL_LIST_BEADS, projectId, resolution.code, resolution.message);
  }
  const { cwd, beadsDir } = resolution.resolved;

  const bdArgs: string[] = ["list", "--json"];
  if (parsed.data.status === "all") {
    bdArgs.push("--all");
  } else if (parsed.data.status) {
    bdArgs.push("--status", parsed.data.status);
  }
  if (parsed.data.assignee) bdArgs.push("--assignee", parsed.data.assignee);
  if (parsed.data.type) bdArgs.push("--type", parsed.data.type);

  const result = await execBd<BeadsIssue[]>(bdArgs, { cwd, beadsDir });
  if (!result.success) {
    return reject(TOOL_LIST_BEADS, projectId, "TOOL_FAILED", result.error?.message ?? "bd list failed");
  }

  const beads = Array.isArray(result.data) ? result.data : [];
  return ok(TOOL_LIST_BEADS, projectId, { beads, count: beads.length });
}

async function runGetProjectState(
  deps: BridgeToolDeps,
  rawProjectId: string | undefined,
): Promise<BridgeToolResult> {
  const projectId = rawProjectId ?? null;

  const resolution = resolveProject(rawProjectId);
  if (!resolution.ok) {
    return reject(TOOL_GET_PROJECT_STATE, projectId, resolution.code, resolution.message);
  }
  const { project, cwd, beadsDir } = resolution.resolved;

  // GROUNDING CONTRACT (adj-202.3.2.2): the avatar narrates this result verbatim
  // from the authoritative panel, so the envelope must NOT let a consumer mistake
  // fleet-wide numbers for one project's state. We split the result into:
  //   - `project`: fields genuinely scoped to the named project, and
  //   - `fleet`:   fields the underlying services only expose fleet-wide.
  // The message store has no project/conversation→project dimension, so recent
  // messages and unread counts are honestly labeled fleet-wide rather than
  // mislabeled as this project's.

  // Connected agents scoped to the named project via each session's projectContext.
  const connectedAgents = getConnectedAgents().filter(
    (c) => c.projectContext?.projectId === project.id,
  ).length;

  // Open beads scoped to the named project's .beads/ directory.
  let openBeads = 0;
  const bdResult = await execBd<BeadsIssue[]>(["list", "--json"], { cwd, beadsDir });
  if (bdResult.success && Array.isArray(bdResult.data)) {
    openBeads = bdResult.data.filter((b) => b.status !== "closed").length;
  }

  // Fleet-wide (NOT project-scoped) — the message store is not partitioned by project.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentMessages = deps.messageStore.getMessages({ after: since }).length;
  const unreadCounts = deps.messageStore.getUnreadCounts();

  return ok(TOOL_GET_PROJECT_STATE, projectId, {
    projectId,
    project: {
      connectedAgents,
      openBeads,
    },
    fleet: {
      recentMessages,
      unreadCounts,
    },
  });
}

function runGetAutoDevelopStatus(
  deps: BridgeToolDeps,
  rawProjectId: string | undefined,
): BridgeToolResult {
  const projectId = rawProjectId ?? null;

  const resolution = resolveProject(rawProjectId);
  if (!resolution.ok) {
    return reject(TOOL_GET_AUTO_DEVELOP_STATUS, projectId, resolution.code, resolution.message);
  }

  const status = buildAutoDevelopStatus(resolution.resolved.project, deps.proposalStore, deps.autoDevelopStore);
  return ok(TOOL_GET_AUTO_DEVELOP_STATUS, projectId, status);
}

/**
 * read_messages — let the avatar recall past agent/user communications so it can give the
 * Commander context on prior discussions (the gap the avatar flagged about itself, adj-202.11).
 * REUSES the SAME messageStore.getMessages the REST/MCP paths use — no new store.
 *
 * Fleet-wide by default; an optional `agentId` (resolved Phoenix → fenix via the shared
 * agent-name resolver) scopes to that agent's DM thread, and a `conversationId` scopes strictly
 * to one conversation (bleed-free, takes precedence in the store). The store returns newest-first;
 * we present oldest-first so the avatar narrates the discussion in conversation order.
 */
async function runReadMessages(
  deps: BridgeToolDeps,
  args: Record<string, unknown>,
  projectId: string | null,
): Promise<BridgeToolResult> {
  const parsed = readMessagesArgs.safeParse(args);
  if (!parsed.success) {
    return reject(TOOL_READ_MESSAGES, projectId, "INVALID_ARGS", parsed.error.issues.map((i) => i.message).join("; "));
  }

  const limit = Math.min(parsed.data.limit ?? READ_MESSAGES_DEFAULT_LIMIT, READ_MESSAGES_MAX_LIMIT);
  const opts: { limit: number; agentId?: string; conversationId?: string } = { limit };

  // Resolve a spoken/typed agent name to the canonical id (case/alias/phonetic), mirroring
  // get_agent_detail — so "Phoenix" filters to fenix's thread. An unresolvable name is a hard
  // miss (don't silently widen to a fleet-wide read the Commander didn't ask for).
  if (parsed.data.agentId !== undefined) {
    const agentsResult = await getAgents();
    const allAgents = agentsResult.success && agentsResult.data ? agentsResult.data : [];
    const resolution = resolveAgentName(parsed.data.agentId, allAgents.map((a) => ({ id: a.id, name: a.name })));
    if (!resolution.matched || !resolution.canonical) {
      const hint = resolution.candidates.length ? ` Closest: ${resolution.candidates.join(", ")}.` : "";
      return reject(TOOL_READ_MESSAGES, projectId, "AGENT_NOT_FOUND", `No agent named '${parsed.data.agentId}'.${hint}`);
    }
    opts.agentId = resolution.canonical;
  }

  // conversationId takes precedence in the store (strict scoping); pass it through when given.
  if (parsed.data.conversationId !== undefined) opts.conversationId = parsed.data.conversationId;

  const newestFirst = deps.messageStore.getMessages(opts);
  // Present oldest → newest for natural narration of the prior discussion.
  const ordered = [...newestFirst].reverse();
  const messages = ordered.map((m) => ({
    id: m.id,
    sender: m.agentId,
    recipient: m.recipient,
    role: m.role,
    body: m.body,
    conversationId: m.conversationId,
    timestamp: m.createdAt,
  }));

  return ok(TOOL_READ_MESSAGES, projectId, { messages, count: messages.length });
}
