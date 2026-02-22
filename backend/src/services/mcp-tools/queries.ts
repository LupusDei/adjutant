/**
 * Query MCP tools for Adjutant.
 *
 * Read-only tools that let agents understand system state:
 * - list_agents: List connected/known agents with status
 * - get_project_state: Aggregate dashboard of beads, agents, messages
 * - search_messages: Full-text search across the message store
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConnectedAgents } from "../mcp-server.js";
import { getAgents } from "../agents-service.js";
import { execBd } from "../bd-client.js";
import type { MessageStore } from "../message-store.js";
import type { BeadsIssue } from "../bd-client.js";

// ============================================================================
// Types
// ============================================================================

interface AgentInfo {
  agentId: string;
  status: string;
  connectedAt?: string | undefined;
  sessionId?: string | undefined;
  currentTask?: string | undefined;
}

// ============================================================================
// Tool registration
// ============================================================================

export function registerQueryTools(server: McpServer, store: MessageStore): void {
  registerListAgents(server);
  registerGetProjectState(server, store);
  registerSearchMessages(server, store);
}

// ============================================================================
// list_agents
// ============================================================================

function registerListAgents(server: McpServer): void {
  server.tool(
    "list_agents",
    {
      status: z
        .enum(["active", "idle", "all"])
        .optional()
        .default("all")
        .describe("Filter agents by status"),
    },
    async ({ status }) => {
      // Gather MCP-connected agents
      const connected = getConnectedAgents();
      const connectedMap = new Map(
        connected.map((c) => [
          c.agentId,
          {
            sessionId: c.sessionId,
            connectedAt: c.connectedAt.toISOString(),
          },
        ]),
      );

      // Gather broader agent info from agents-service
      const agentsResult = await getAgents();
      const serviceAgents = agentsResult.success && agentsResult.data ? agentsResult.data : [];

      // Build merged agent list, keyed by agent ID
      const agentMap = new Map<string, AgentInfo>();

      // Add all agents from the service
      for (const agent of serviceAgents) {
        const conn = connectedMap.get(agent.id);
        agentMap.set(agent.id, {
          agentId: agent.id,
          status: agent.status,
          currentTask: agent.currentTask,
          sessionId: conn?.sessionId,
          connectedAt: conn?.connectedAt,
        });
      }

      // Add MCP-connected agents not already in the service list
      for (const [agentId, conn] of connectedMap) {
        if (!agentMap.has(agentId)) {
          agentMap.set(agentId, {
            agentId,
            status: "idle",
            sessionId: conn.sessionId,
            connectedAt: conn.connectedAt,
          });
        }
      }

      let agents = Array.from(agentMap.values());

      // Apply status filter
      if (status === "active") {
        agents = agents.filter(
          (a) => a.status === "working" || a.status === "blocked" || a.status === "stuck",
        );
      } else if (status === "idle") {
        agents = agents.filter((a) => a.status === "idle");
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ agents, count: agents.length }) }],
      };
    },
  );
}

// ============================================================================
// get_project_state
// ============================================================================

function registerGetProjectState(server: McpServer, store: MessageStore): void {
  server.tool(
    "get_project_state",
    {},
    async () => {
      // Connected agents count
      const connected = getConnectedAgents();
      const connectedAgents = connected.length;

      // Open beads count
      let openBeads = 0;
      const bdResult = await execBd<BeadsIssue[]>(["list", "--json"]);
      if (bdResult.success && Array.isArray(bdResult.data)) {
        openBeads = bdResult.data.filter(
          (b) => b.status !== "closed",
        ).length;
      }

      // Recent messages (last 24h)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentMsgs = store.getMessages({ after: since });
      const recentMessages = recentMsgs.length;

      // Unread counts
      const unreadCounts = store.getUnreadCounts();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              connectedAgents,
              openBeads,
              recentMessages,
              unreadCounts,
            }),
          },
        ],
      };
    },
  );
}

// ============================================================================
// search_messages
// ============================================================================

function registerSearchMessages(server: McpServer, store: MessageStore): void {
  server.tool(
    "search_messages",
    {
      query: z.string().describe("Full-text search query"),
      agentId: z.string().optional().describe("Filter to specific agent"),
      limit: z.number().optional().default(20).describe("Max results"),
    },
    async ({ query, agentId, limit }) => {
      const effectiveLimit = limit ?? 20;
      const results = store.searchMessages(query, { agentId, limit: effectiveLimit });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ results, count: results.length }),
          },
        ],
      };
    },
  );
}
