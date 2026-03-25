/**
 * MCP tools for auto-develop operations.
 *
 * Provides:
 * - score_proposal: Reviewer agents submit confidence signal scores
 * - enable_auto_develop: Enable auto-develop for the agent's project
 * - disable_auto_develop: Disable auto-develop for the agent's project
 * - provide_vision_update: Update vision context and unpause the loop
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getAgentBySession, getProjectContextBySession } from "../mcp-server.js";
import type { ProposalStore } from "../proposal-store.js";
import type { AutoDevelopStore } from "../auto-develop-store.js";
import type { AutoDevelopStatus } from "../../types/auto-develop.js";
import { computeConfidenceScore, classifyConfidence } from "../confidence-engine.js";
import {
  enableAutoDevelop,
  disableAutoDevelop,
  setVisionContext,
  clearAutoDevelopPause,
  getProject,
} from "../projects-service.js";
import { getEventBus } from "../event-bus.js";
import { logInfo } from "../../utils/index.js";

export function registerAutoDevelopTools(server: McpServer, proposalStore: ProposalStore, autoDevelopStore?: AutoDevelopStore): void {
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

      // 3. Verify auto-develop is enabled for this project
      const projectResult = getProject(projectContext.projectId);
      if (!projectResult.success || !projectResult.data?.autoDevelop) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Auto-develop is not enabled for this project" }) }],
        };
      }

      // 4. Get proposal and validate it exists
      const proposal = proposalStore.getProposal(proposalId);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      // 5. Validate proposal belongs to agent's project
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

      // 6. Build ConfidenceSignals
      const signals = {
        reviewerConsensus,
        specClarity,
        codebaseAlignment,
        riskAssessment,
        historicalSuccess,
      };

      // 7. Compute score and classify
      const score = computeConfidenceScore(signals);
      const classification = classifyConfidence(score);

      // 8. Store score on proposal
      proposalStore.setConfidenceScore(proposalId, score, signals);

      // 9. Emit proposal:scored event
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

      // Audit trail for confidence gate decisions
      logInfo("confidence_gate_decision", {
        proposalId,
        projectId: projectContext.projectId,
        score,
        classification,
        signals,
        reviewRound: proposal.reviewRound,
        scoredBy: agentId,
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

  // ---------------------------------------------------------------------------
  // enable_auto_develop
  // ---------------------------------------------------------------------------
  server.tool(
    "enable_auto_develop",
    {
      visionContext: z.string().max(10000).optional().describe("Optional vision/direction context to guide proposal generation"),
    },
    async ({ visionContext }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot enable auto-develop" }) }],
        };
      }

      const result = enableAutoDevelop(projectContext.projectId);
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error?.message ?? "Failed to enable auto-develop" }) }],
        };
      }

      // Set vision context if provided
      if (visionContext !== undefined) {
        const visionResult = setVisionContext(projectContext.projectId, visionContext);
        if (!visionResult.success) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: visionResult.error?.message ?? "Failed to set vision context" }) }],
          };
        }
      }

      // Emit event
      const enabledEvent: { projectId: string; projectName: string; visionContext?: string } = {
        projectId: projectContext.projectId,
        projectName: projectContext.projectName,
      };
      if (visionContext !== undefined) {
        enabledEvent.visionContext = visionContext;
      }
      getEventBus().emit("project:auto_develop_enabled", enabledEvent);

      logInfo("enable_auto_develop", { agentId, projectId: projectContext.projectId, hasVision: !!visionContext });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            projectId: projectContext.projectId,
            projectName: projectContext.projectName,
            autoDevelop: true,
            visionContext: visionContext ?? null,
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // disable_auto_develop
  // ---------------------------------------------------------------------------
  server.tool(
    "disable_auto_develop",
    {},
    async (_params, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot disable auto-develop" }) }],
        };
      }

      const result = disableAutoDevelop(projectContext.projectId);
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error?.message ?? "Failed to disable auto-develop" }) }],
        };
      }

      getEventBus().emit("project:auto_develop_disabled", {
        projectId: projectContext.projectId,
        projectName: projectContext.projectName,
      });

      logInfo("disable_auto_develop", { agentId, projectId: projectContext.projectId });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            projectId: projectContext.projectId,
            projectName: projectContext.projectName,
            autoDevelop: false,
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // provide_vision_update
  // ---------------------------------------------------------------------------
  server.tool(
    "provide_vision_update",
    {
      visionContext: z.string().min(1).max(10000).describe("Updated vision/direction for the project"),
    },
    async ({ visionContext }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot update vision" }) }],
        };
      }

      // Set the new vision context
      const visionResult = setVisionContext(projectContext.projectId, visionContext);
      if (!visionResult.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: visionResult.error?.message ?? "Failed to set vision context" }) }],
        };
      }

      // Clear pause — unpauses the auto-develop loop
      clearAutoDevelopPause(projectContext.projectId);

      // Emit enabled event with resumeFromPause flag to signal the loop to resume
      // from where it paused, rather than starting a fresh cycle
      getEventBus().emit("project:auto_develop_enabled", {
        projectId: projectContext.projectId,
        projectName: projectContext.projectName,
        visionContext,
        resumeFromPause: true,
      });

      logInfo("provide_vision_update", { agentId, projectId: projectContext.projectId });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            projectId: projectContext.projectId,
            projectName: projectContext.projectName,
            visionContext,
            pauseCleared: true,
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // get_auto_develop_status
  // ---------------------------------------------------------------------------
  server.tool(
    "get_auto_develop_status",
    {},
    async (_params, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot get auto-develop status" }) }],
        };
      }

      const projectResult = getProject(projectContext.projectId);
      if (!projectResult.success || !projectResult.data) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Project not found" }) }],
        };
      }

      const project = projectResult.data;

      // Get proposal counts by status for this project
      // ProposalStatus is "pending" | "accepted" | "dismissed" | "completed"
      // Map: pending -> inReview, accepted -> accepted, dismissed -> dismissed
      // escalated is tracked via confidence score range (40-59) on pending proposals
      const projectIds = [projectContext.projectId, projectContext.projectName];
      const pendingProposals = proposalStore.getProposals({ status: "pending", project: projectIds });
      const escalated = pendingProposals.filter(p => p.confidenceScore !== undefined && p.confidenceScore >= 40 && p.confidenceScore < 60).length;
      const inReview = pendingProposals.length - escalated;
      const accepted = proposalStore.getProposals({ status: "accepted", project: projectIds }).length;
      const dismissed = proposalStore.getProposals({ status: "dismissed", project: projectIds }).length;

      // Get cycle stats
      const activeCycle = autoDevelopStore?.getActiveCycle(projectContext.projectId) ?? null;
      const cycleHistory = autoDevelopStore?.getCycleHistory(projectContext.projectId) ?? [];
      const completedCycles = cycleHistory.filter(c => c.completedAt !== null).length;

      // Count epics in execution (accepted proposals that are being worked on)
      // Use accepted count as a proxy for epics in execution
      const epicsInExecution = accepted;

      const status: AutoDevelopStatus = {
        enabled: project.autoDevelop,
        paused: !!project.autoDevelopPausedAt,
        pausedAt: project.autoDevelopPausedAt ?? null,
        currentPhase: activeCycle ? (activeCycle.phase as AutoDevelopStatus["currentPhase"]) : null,
        activeCycleId: activeCycle?.id ?? null,
        visionContext: project.visionContext ?? null,
        proposals: { inReview, accepted, escalated, dismissed },
        epicsInExecution,
        cycleStats: {
          totalCycles: cycleHistory.length,
          completedCycles,
        },
      };

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(status),
        }],
      };
    },
  );
}
