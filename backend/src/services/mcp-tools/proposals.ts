/**
 * MCP tools for agent proposal operations.
 *
 * Provides create_proposal and list_proposals tools that agents use to
 * generate and review improvement proposals when idle.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAgentBySession } from "../mcp-server.js";
import type { ProposalStore } from "../proposal-store.js";
import { logInfo } from "../../utils/index.js";

export function registerProposalTools(server: McpServer, store: ProposalStore): void {
  // ---------------------------------------------------------------------------
  // create_proposal
  // ---------------------------------------------------------------------------
  server.tool(
    "create_proposal",
    {
      title: z.string().describe("Concise proposal title"),
      description: z.string().describe("Deep description of the improvement: what, why, and how"),
      type: z.enum(["product", "engineering"]).describe("Proposal type: 'product' for UX/product improvements, 'engineering' for refactoring/architecture"),
    },
    async ({ title, description, type }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const proposal = store.insertProposal({
        author: agentId,
        title,
        description,
        type,
      });

      logInfo("create_proposal", { agentId, proposalId: proposal.id, type, title });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: proposal.id,
            title: proposal.title,
            type: proposal.type,
            status: proposal.status,
            createdAt: proposal.createdAt,
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // list_proposals
  // ---------------------------------------------------------------------------
  server.tool(
    "list_proposals",
    {
      status: z.enum(["pending", "accepted", "dismissed"]).optional().describe("Filter by status"),
      type: z.enum(["product", "engineering"]).optional().describe("Filter by type"),
    },
    async ({ status, type }) => {
      const proposals = store.getProposals({ status, type });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            proposals: proposals.map((p) => ({
              id: p.id,
              author: p.author,
              title: p.title,
              description: p.description,
              type: p.type,
              status: p.status,
              createdAt: p.createdAt,
            })),
            count: proposals.length,
          }),
        }],
      };
    },
  );
}
