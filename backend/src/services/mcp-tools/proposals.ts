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
      project: z.string().describe("Project this proposal is for (e.g., 'adjutant')"),
    },
    async ({ title, description, type, project }, extra) => {
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
        project,
      });

      logInfo("create_proposal", { agentId, proposalId: proposal.id, type, title });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: proposal.id,
            title: proposal.title,
            type: proposal.type,
            project: proposal.project,
            status: proposal.status,
            createdAt: proposal.createdAt,
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // get_proposal
  // ---------------------------------------------------------------------------
  server.tool(
    "get_proposal",
    {
      id: z.string().describe("Proposal UUID to fetch"),
    },
    async ({ id }) => {
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(proposal) }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // discuss_proposal
  // ---------------------------------------------------------------------------
  server.tool(
    "discuss_proposal",
    {
      id: z.string().describe("Proposal UUID to discuss"),
    },
    async ({ id }) => {
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            proposal,
            context: "You are reviewing this proposal with the user. Analyze strengths, weaknesses, feasibility, and suggest improvements. Ask clarifying questions via send_message to 'user'.",
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // comment_on_proposal
  // ---------------------------------------------------------------------------
  server.tool(
    "comment_on_proposal",
    {
      id: z.string().describe("Proposal UUID to comment on"),
      body: z.string().min(1).describe("Comment text"),
    },
    async ({ id, body }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      const comment = store.insertComment({
        proposalId: id,
        author: agentId,
        body,
      });

      logInfo("comment_on_proposal", { agentId, proposalId: id, commentId: comment.id });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(comment),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // list_proposal_comments
  // ---------------------------------------------------------------------------
  server.tool(
    "list_proposal_comments",
    {
      id: z.string().describe("Proposal UUID to list comments for"),
    },
    async ({ id }) => {
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      const comments = store.getComments(id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ comments, count: comments.length }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // revise_proposal
  // ---------------------------------------------------------------------------
  server.tool(
    "revise_proposal",
    {
      id: z.string().describe("Proposal UUID to revise"),
      title: z.string().min(1).optional().describe("New title (optional — omit to keep current)"),
      description: z.string().min(1).optional().describe("New description (optional — omit to keep current)"),
      type: z.enum(["product", "engineering"]).optional().describe("New type (optional — omit to keep current)"),
      changelog: z.string().min(1).describe("Description of what changed and why"),
    },
    async ({ id, title, description, type, changelog }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      if (title === undefined && description === undefined && type === undefined) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "At least one of title, description, or type must be provided" }) }],
        };
      }

      const revised = store.reviseProposal(id, {
        author: agentId,
        title,
        description,
        type,
        changelog,
      });

      if (!revised) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      logInfo("revise_proposal", { agentId, proposalId: id, title: revised.title });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(revised),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // list_revisions
  // ---------------------------------------------------------------------------
  server.tool(
    "list_revisions",
    {
      id: z.string().describe("Proposal UUID to list revisions for"),
    },
    async ({ id }) => {
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      const revisions = store.getRevisions(id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ revisions, count: revisions.length }),
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
      status: z.enum(["pending", "accepted", "dismissed", "completed"]).optional().describe("Filter by status"),
      type: z.enum(["product", "engineering"]).optional().describe("Filter by type"),
      project: z.string().optional().describe("Filter by project"),
    },
    async ({ status, type, project }) => {
      const proposals = store.getProposals({ status, type, project });

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
              project: p.project,
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
