/**
 * The fleet roster — ONE answer to "who exists" (adj-xugvt).
 *
 * THE BUG THIS CLOSES. Two listings answered different questions and neither
 * said which:
 *   - `GET /api/agents` was built from tmux + bridge sessions: "who did this box
 *     spawn, and can it type into them".
 *   - MCP `list_agents` merged that with the live MCP connection map: "which
 *     identities are connected", wherever they happen to run.
 * On 2026-09-02 a Grok-hosted agent ("Adjudicator") connected over MCP and
 * messaged the coordinator. `list_agents` showed it; `GET /api/agents` did not;
 * `direct_message` answered "No agent named 'Adjudicator'" — an existence claim
 * drawn from the tmux-shaped roster, about an agent that was demonstrably there.
 * The coordinator believed the tool and reported the agent unreachable. The same
 * divergence with the sign flipped produced the phantom `unknown-agent-<hash>`:
 * a connection with no session and no real identity, listed as a live agent.
 *
 * THE DISTINCTION, MADE EXPLICIT. An agent IDENTITY (something that exists in
 * the fleet and can be messaged) is not an injectable SESSION (a local tmux pane
 * this box can type into). Conflating them is the whole bug, so every entry
 * carries both facts as data:
 *   - `transport`  — how we reach it: "tmux" (local session) or "mcp" (connection only)
 *   - `injectable` — whether prompt injection (`direct_message`) is even possible
 * Consumers stop guessing from which endpoint they happened to call.
 *
 * PLACEHOLDERS ARE SESSIONS, NOT AGENTS. `unknown-agent-*` / `unknown` clients
 * remain fully tracked as MCP connections (and reaped as such) but are never
 * promoted to roster entries — they polluted exactly the census a coordinator
 * reads to decide whether to spawn.
 */

import { getAgents } from "./agents-service.js";
import { getConnectedAgents } from "./mcp-server.js";
import { getAgentStatuses } from "./mcp-tools/status.js";
import type { CrewMember, CrewMemberStatus } from "../types/index.js";

/** How the fleet can reach an agent. */
export type AgentTransport =
  /** A local tmux/bridge session exists: messageable AND injectable. */
  | "tmux"
  /** A live MCP connection with no local session: messageable, NOT injectable. */
  | "mcp";

export interface RosterEntry extends CrewMember {
  /** When the agent's live MCP connection was established, if it has one. */
  connectedAt?: string;
  transport: AgentTransport;
  /**
   * Whether a prompt can be injected into a local session for this agent.
   * False for every off-platform/MCP-only agent — `send_message` is the
   * transport for those, and callers must say so instead of claiming the
   * agent does not exist.
   */
  injectable: boolean;
}

/**
 * Placeholder identities minted for MCP clients that connect without a usable
 * `X-Agent-Id` (see `resolveAgentId` in mcp-server.ts). Kept in sync with
 * `isPlaceholderAgentId` there — duplicated deliberately rather than exported
 * across the boundary, because the roster's question ("is this a real identity")
 * is not the connection map's question ("may this id supersede another").
 */
function isPlaceholderAgentId(agentId: string): boolean {
  return agentId === "unknown" || agentId.startsWith("unknown-agent-");
}

const MCP_STATUS_TO_CREW: Record<string, CrewMemberStatus> = {
  working: "working",
  blocked: "blocked",
  idle: "idle",
  done: "idle",
};

/**
 * Every agent the fleet knows about, from every transport, once.
 *
 * Never throws and never returns a partial view silently: if the tmux roster
 * cannot be read, connected agents are still reported. Losing the local listing
 * must not be reported as "those agents do not exist" — that mistake is the
 * whole point of this module.
 */
export async function getFleetRoster(): Promise<RosterEntry[]> {
  let sessionAgents: CrewMember[] = [];
  try {
    const result = await getAgents();
    sessionAgents = result.success && result.data ? result.data : [];
  } catch {
    sessionAgents = [];
  }

  const connections = getConnectedAgents().filter((c) => !isPlaceholderAgentId(c.agentId));
  const connectionByAgent = new Map(connections.map((c) => [c.agentId, c]));
  const statuses = getAgentStatuses();

  const roster = new Map<string, RosterEntry>();

  // 1. Agents with a local session. These keep everything agents-service
  //    computed (status enrichment, cost, persona, stale markers) and only gain
  //    the live connection's session id.
  for (const member of sessionAgents) {
    const conn = connectionByAgent.get(member.id) ?? connectionByAgent.get(member.name);
    roster.set(member.id, {
      ...member,
      ...(conn ? { sessionId: conn.sessionId, connectedAt: conn.connectedAt.toISOString() } : {}),
      transport: "tmux",
      injectable: true,
    });
  }

  // 2. Identities that are connected but have no local session — worktree
  //    agents, off-platform clients (Grok, iOS, anything speaking MCP). These
  //    were invisible to REST entirely.
  for (const conn of connections) {
    if (roster.has(conn.agentId)) continue;

    const reported = statuses.get(conn.agentId);
    roster.set(conn.agentId, {
      id: conn.agentId,
      name: conn.agentId,
      type: "agent",
      project: null,
      status: reported ? (MCP_STATUS_TO_CREW[reported.status] ?? "idle") : "idle",
      ...(reported?.task !== undefined ? { currentTask: reported.task } : {}),
      sessionId: conn.sessionId,
      connectedAt: conn.connectedAt.toISOString(),
      isLive: true,
      lastSeen: reported?.updatedAt ?? conn.connectedAt.toISOString(),
      transport: "mcp",
      injectable: false,
    });
  }

  return Array.from(roster.values());
}
