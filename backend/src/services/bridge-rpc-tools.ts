/**
 * The Bridge — read-only RPC tool descriptors (adj-202.7).
 *
 * These are the `backend_rpc` tool definitions handed to Runway at session-create
 * time so GWM-1 (the avatar's model) KNOWS the read-only fleet tools exist and can
 * invoke them mid-conversation. Without them the avatar has nothing to call and a
 * status question stalls forever ("querying…") — the gap this task closes.
 *
 * The descriptors mirror the read-only whitelist in {@link BRIDGE_READONLY_TOOLS}
 * exactly: every callable tool, no write tools. The avatar never speaks a project
 * UUID, so `projectId` is NOT a model-visible parameter — it is injected
 * server-side from the session's project context (see bridge-rpc-handler.ts). Only
 * the functional arguments (status / type / urgency / …) are exposed to the model.
 *
 * Runway tool-parameter shape (verified against the avatars-sdk-react
 * `nextjs-rpc-*` examples): `{ name, type, description }`. There is no enum field,
 * so allowed values are spelled out in each parameter description.
 */

import type { RunwayRpcToolDef } from "./runway-client.js";

/**
 * The `backend_rpc` tool descriptors for the five read-only fleet tools. The order
 * and names are kept in lockstep with {@link BRIDGE_READONLY_TOOLS}; a drift is
 * caught by bridge-rpc-tools.test.ts.
 */
export const BRIDGE_RPC_TOOLS: RunwayRpcToolDef[] = [
  {
    type: "backend_rpc",
    name: "list_agents",
    description:
      "List the fleet's agents (the crew roster) with their status and connection state. Use this whenever the Commander asks who is working, the roster, or crew status.",
    parameters: [
      {
        name: "status",
        type: "string",
        description: 'Optional filter: "active" (working/blocked/stuck), "idle", or "all" (default).',
      },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "list_questions",
    description:
      "List open agent questions awaiting the Commander, sorted blocking → high → normal → low. Use when asked what needs a decision, what is blocking, or the triage queue.",
    parameters: [
      {
        name: "status",
        type: "string",
        description: 'Optional: "open" (default), "answered", or "dismissed".',
      },
      {
        name: "category",
        type: "string",
        description: 'Optional: "decision", "clarification", "approval", "action_required", or "other".',
      },
      { name: "agentId", type: "string", description: "Optional: only questions filed by this agent." },
      {
        name: "urgency",
        type: "string",
        description: 'Optional: "blocking", "high", "normal", or "low".',
      },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "list_beads",
    description:
      "List issues (beads) for the currently selected project — epics, tasks, and bugs. Use when asked about open work, what's in progress, or the backlog.",
    parameters: [
      {
        name: "status",
        type: "string",
        description: 'Optional: "open", "in_progress", "closed", or "all".',
      },
      { name: "assignee", type: "string", description: "Optional: only beads assigned to this person." },
      { name: "type", type: "string", description: 'Optional: "epic", "task", or "bug".' },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "get_project_state",
    description:
      "Get a snapshot of the currently selected project: connected agents, open beads, and recent message activity. Use for a general 'how are we doing' briefing on the project.",
    parameters: [],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "get_auto_develop_status",
    description:
      "Get the auto-develop loop status for the currently selected project (phase, active proposal, progress). Use when asked whether auto-develop is running or what phase it's in.",
    parameters: [],
    timeoutSeconds: 8,
  },
];

/**
 * The default per-session persona for the Bridge avatar. It tells GWM-1 it is the
 * Adjutant fleet coordinator, that the read-only tools exist, and — crucially —
 * to CALL them (rather than stall) and to ground every answer in the structured
 * result the tool returns (never invent fleet numbers; the readout is the truth).
 */
export const BRIDGE_RPC_PERSONALITY = `You are the Adjutant — the fleet coordinator's conversational body. Address the user as Commander.

You can query live fleet state using these read-only tools. CALL the matching tool whenever the Commander asks — never say "querying" and stall; never guess or invent numbers.
- list_agents — the crew roster and who is working (the agent roster / crew status).
- list_questions — open questions awaiting a decision (the triage queue / what's blocking).
- list_beads — issues for the selected project (open work / backlog).
- get_project_state — a snapshot of the selected project.
- get_auto_develop_status — the auto-develop loop status for the selected project.

After a tool returns, narrate its STRUCTURED result faithfully and conversationally. The returned data is the source of truth. If a tool reports it needs a project and none is selected, say so plainly and ask the Commander to select one. Keep answers brief and grounded.`;

/**
 * Compose the per-session personality: append the fleet-tool guidance to a caller-
 * supplied base persona, or fall back to {@link BRIDGE_RPC_PERSONALITY} when none
 * is given. Either way the model is told the tools exist and how to use them.
 */
export function composeBridgePersonality(base?: string): string {
  if (!base) return BRIDGE_RPC_PERSONALITY;
  return `${base}\n\n${BRIDGE_RPC_PERSONALITY}`;
}
