/**
 * MCP tools for auto-develop operations.
 *
 * Provides the score_proposal tool that reviewer agents use to submit
 * confidence signal scores for proposals in the auto-develop pipeline.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getAgentBySession, getProjectContextBySession } from "../mcp-server.js";
import type { ProposalStore } from "../proposal-store.js";
import { computeConfidenceScore, classifyConfidence } from "../confidence-engine.js";
import { getEventBus } from "../event-bus.js";
import { logInfo } from "../../utils/index.js";

export function registerAutoDevelopTools(server: McpServer, proposalStore: ProposalStore): void {
  // ---------------------------------------------------------------------------
  // score_proposal
  // ---------------------------------------------------------------------------
  server.tool(
    "score_proposal",
    {
      proposalId: z.string().describe("Proposal UUID to score"),
      reviewerConsensus: z.number().min(0).max(100).describe("Reviewer agreement score"),
      specClarity: z.number().min(0).max(100).describe("Spec clarity score"),
      codebaseAlignment: z.number().min(0).max(100).describe("Codebase alignment score"),
      riskAssessment: z.number().min(0).max(100).describe("Risk assessment score (higher = less risky)"),
      historicalSuccess: z.number().min(0).max(100).describe("Historical success rate score"),
    },
    async (
      { proposalId, reviewerConsensus, specClarity, codebaseAlignment, riskAssessment, historicalSuccess },
      extra,
    ) => {
      // 1. Resolve agent identity
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      // 2. Resolve project context
      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot score proposals" }) }],
        };
      }

      // 3. Get proposal and validate it exists
      const proposal = proposalStore.getProposal(proposalId);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      // 4. Validate proposal belongs to agent's project
      if (proposal.project !== projectContext.projectId && proposal.project !== projectContext.projectName) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `Proposal belongs to project ${proposal.project}, but you are scoped to project ${projectContext.projectId}`,
            }),
          }],
        };
      }

      // 5. Build ConfidenceSignals
      const signals = {
        reviewerConsensus,
        specClarity,
        codebaseAlignment,
        riskAssessment,
        historicalSuccess,
      };

      // 6. Compute score and classify
      const score = computeConfidenceScore(signals);
      const classification = classifyConfidence(score);

      // 7. Store score on proposal
      proposalStore.setConfidenceScore(proposalId, score, signals);

      // 8. Emit proposal:scored event
      getEventBus().emit("proposal:scored", {
        proposalId,
        projectId: projectContext.projectId,
        score,
        classification,
        reviewRound: proposal.reviewRound,
      });

      logInfo("score_proposal", {
        agentId,
        proposalId,
        score,
        classification,
        reviewRound: proposal.reviewRound,
      });

      // 9. Return result
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ score, classification, signals }),
        }],
      };
    },
  );
}
