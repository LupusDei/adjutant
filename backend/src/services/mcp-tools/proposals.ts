/**
 * MCP tools for agent proposal operations.
 *
 * Provides create_proposal and list_proposals tools that agents use to
 * generate and review improvement proposals when idle.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAgentBySession, getProjectContextBySession } from "../mcp-server.js";
import type { ProposalStore } from "../proposal-store.js";
import { getProject } from "../projects-service.js";
import { logInfo } from "../../utils/index.js";

/**
 * UUID v4 format regex: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex with dashes).
 * Used to enforce that project identifiers stored in proposals are always UUIDs,
 * never human-readable project names (adj-141.3).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cross-project validation helper. Returns an error response if the proposal
 * belongs to a different project than the agent's session context.
 * Requires project context — agents without it are rejected.
 */
function validateProjectAccess(
  proposal: { project: string },
  extra: { sessionId?: string },
): { error: string } | null {
  if (!extra.sessionId) {
    return { error: "Unknown session — not connected via MCP" };
  }
  const projectContext = getProjectContextBySession(extra.sessionId);
  if (!projectContext) {
    return { error: "No project context — cannot access proposals across projects" };
  }
  // Match against both projectId (UUID) and projectName (human-readable).
  // Proposals created before server-side project resolution (adj-088) stored
  // the project name string; newer ones store the UUID. (adj-090)
  if (proposal.project !== projectContext.projectId && proposal.project !== projectContext.projectName) {
    return { error: `Proposal belongs to project ${proposal.project}, but you are scoped to project ${projectContext.projectId}` };
  }
  return null;
}

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
    async ({ title, description, type, project: _clientProject }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      // Server-side project resolution — ignore client-supplied project
      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot create proposal" }) }],
        };
      }

      // Validate that the resolved project ID is a UUID, not a human-readable name (adj-141.3).
      // This is a safety net — projectContext.projectId SHOULD always be a UUID,
      // but we enforce it here to prevent legacy name strings from leaking into storage.
      if (!UUID_RE.test(projectContext.projectId)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            error: `Project ID must be a UUID, got: "${projectContext.projectId}"`,
          }) }],
        };
      }

      const proposal = store.insertProposal({
        author: agentId,
        title,
        description,
        type,
        project: projectContext.projectId,
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
    async ({ id }, extra) => {
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      // Cross-project validation (adj-072.5.3)
      const accessError = validateProjectAccess(proposal, extra);
      if (accessError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(accessError) }],
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
    async ({ id }, extra) => {
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      // Cross-project validation (adj-072.5.4: require project context)
      const accessError = validateProjectAccess(proposal, extra);
      if (accessError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(accessError) }],
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

      // Cross-project validation (adj-072.5.4: require project context)
      const commentAccessError = validateProjectAccess(proposal, extra);
      if (commentAccessError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(commentAccessError) }],
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
    async ({ id }, extra) => {
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      // Cross-project validation (adj-072.5.3)
      const commentsAccessError = validateProjectAccess(proposal, extra);
      if (commentsAccessError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(commentsAccessError) }],
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

      // Cross-project validation (adj-072.5.4: require project context)
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }
      const reviseAccessError = validateProjectAccess(proposal, extra);
      if (reviseAccessError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(reviseAccessError) }],
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
    async ({ id }, extra) => {
      const proposal = store.getProposal(id);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      // Cross-project validation (adj-072.5.3)
      const revisionsAccessError = validateProjectAccess(proposal, extra);
      if (revisionsAccessError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(revisionsAccessError) }],
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
    async ({ status, type, project }, extra) => {
      // After migration (adj-141.1), all proposals store UUID in the project field.
      // When explicit project is provided, use it directly. When omitted, fall back
      // to session context (UUID).
      let resolvedProject: string | undefined;
      if (project !== undefined && project !== "") {
        // Look up the project to get its UUID if a name was passed
        const projectResult = getProject(project);
        resolvedProject = (projectResult.success && projectResult.data) ? projectResult.data.id : project;
      } else if (project === "") {
        // Empty string is an explicit value — pass through (adj-072.5.5)
        resolvedProject = project;
      } else if (extra.sessionId) {
        const projectContext = getProjectContextBySession(extra.sessionId);
        if (projectContext) {
          resolvedProject = projectContext.projectId;
        }
      }
      const proposals = store.getProposals({ status, type, project: resolvedProject });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            proposals: proposals.map((p) => ({
              id: p.id,
              author: p.author,
              title: p.title,
              descriptionPreview: p.description.length > 100
                ? p.description.slice(0, 100) + "…"
                : p.description,
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
