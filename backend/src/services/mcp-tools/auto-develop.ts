/**
 * MCP tools for auto-develop operations.
 *
 * Provides:
 * - score_proposal: Reviewer agents submit confidence signal scores
 * - enable_auto_develop: Enable auto-develop for the agent's project
 * - disable_auto_develop: Disable auto-develop for the agent's project
 * - provide_vision_update: Update vision context and unpause the loop
 * - advance_auto_develop_phase: Coordinator tool to push phase forward immediately (adj-135)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getAgentBySession, getProjectContextBySession } from "../mcp-server.js";
import type { ProposalStore } from "../proposal-store.js";
import type { AutoDevelopStore } from "../auto-develop-store.js";
import { computeConfidenceScore, classifyConfidence } from "../confidence-engine.js";
import { buildAutoDevelopStatus } from "../auto-develop-status.js";
import {
  enableAutoDevelop,
  disableAutoDevelop,
  setVisionContext,
  clearAutoDevelopPause,
  getProject,
} from "../projects-service.js";
import { getEventBus } from "../event-bus.js";
import { logInfo } from "../../utils/index.js";
import type { AdjutantState } from "../adjutant/state-store.js";
import type { StimulusEngine } from "../adjutant/stimulus-engine.js";
import {
  phaseKey,
  debounceKey,
  buildPhaseReason,
  determineNextPhase,
} from "../adjutant/behaviors/auto-develop-loop.js";
import type { AutoDevelopPhase } from "../../types/auto-develop.js";

/** Valid phase transition order — each phase can only advance to the next in sequence */
const PHASE_ORDER: AutoDevelopPhase[] = [
  "analyze", "ideate", "review", "gate", "plan", "execute", "validate",
];

export interface AutoDevelopToolDeps {
  adjutantState?: AdjutantState;
  stimulusEngine?: StimulusEngine;
}

export function registerAutoDevelopTools(
  server: McpServer,
  proposalStore: ProposalStore,
  autoDevelopStore?: AutoDevelopStore,
  deps?: AutoDevelopToolDeps,
): void {
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

      // 2. Get proposal and validate it exists
      const proposal = proposalStore.getProposal(proposalId);
      if (!proposal) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Proposal not found" }) }],
        };
      }

      // 3. Resolve project from the proposal itself (adj-136).
      // Agents spawned to review cross-project proposals may have a session
      // context pointing to a different project (e.g., coordinator's project).
      // The proposal's project field is the source of truth.
      const projectResult = getProject(proposal.project);
      if (!projectResult.success || !projectResult.data) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Project not found for proposal: ${proposal.project}` }) }],
        };
      }

      // 4. Verify auto-develop is enabled for the proposal's project
      if (!projectResult.data.autoDevelop) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Auto-develop is not enabled for this project" }) }],
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
      // Use resolved project UUID, not proposal.project which may be a legacy name string (adj-138)
      getEventBus().emit("proposal:scored", {
        proposalId,
        projectId: projectResult.data.id,
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
        projectId: projectResult.data.id,
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

      // Use shared helper to build status (adj-122.10.6)
      const status = buildAutoDevelopStatus(project, proposalStore, autoDevelopStore);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(status),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // advance_auto_develop_phase (adj-135)
  // ---------------------------------------------------------------------------
  server.tool(
    "advance_auto_develop_phase",
    {
      targetPhase: z.enum(["analyze", "ideate", "review", "gate", "plan", "execute", "validate"])
        .optional()
        .describe("Explicit phase to transition to. If omitted, auto-determines the next phase."),
    },
    async ({ targetPhase }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context" }) }],
        };
      }

      if (!deps?.adjutantState || !deps?.stimulusEngine) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Auto-develop dependencies not available" }) }],
        };
      }

      const projectResult = getProject(projectContext.projectId);
      if (!projectResult.success || !projectResult.data) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Project not found" }) }],
        };
      }

      if (!projectResult.data.autoDevelop) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Auto-develop is not enabled for this project" }) }],
        };
      }

      const { adjutantState, stimulusEngine } = deps;
      const currentPhase = (adjutantState.getMeta(phaseKey(projectContext.projectId)) ?? "analyze") as AutoDevelopPhase;

      // Determine next phase
      let nextPhase: AutoDevelopPhase;
      if (targetPhase) {
        // Validate the transition is legal (can only advance forward in the phase order)
        const currentIdx = PHASE_ORDER.indexOf(currentPhase);
        const targetIdx = PHASE_ORDER.indexOf(targetPhase);

        // Allow wrap-around (validate → analyze) and forward transitions
        const isForward = targetIdx > currentIdx;
        const isWrapAround = currentPhase === "validate" && targetPhase === "analyze";
        const isSamePhase = targetPhase === currentPhase;

        if (!isForward && !isWrapAround && !isSamePhase) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: `Invalid phase transition: ${currentPhase} → ${targetPhase}. Can only advance forward or wrap from validate → analyze.`,
              }),
            }],
          };
        }
        nextPhase = targetPhase;
      } else {
        // Auto-determine next phase
        const result = determineNextPhase(
          currentPhase,
          projectContext.projectId,
          projectContext.projectName,
          proposalStore,
        );
        nextPhase = result.nextPhase;
      }

      // Update phase state
      adjutantState.setMeta(phaseKey(projectContext.projectId), nextPhase);

      // Get or create cycle ID for the event
      const activeCycle = autoDevelopStore?.getActiveCycle(projectContext.projectId);
      const cycleId = activeCycle?.id ?? `manual-${Date.now()}`;

      // Emit phase change event
      getEventBus().emit("auto_develop:phase_changed", {
        projectId: projectContext.projectId,
        cycleId,
        previousPhase: currentPhase,
        newPhase: nextPhase,
      });

      // Build reason and schedule coordinator wake
      const reason = buildPhaseReason(
        projectContext.projectId,
        projectContext.projectName,
        nextPhase,
        proposalStore,
        autoDevelopStore!,
        adjutantState,
      );
      const checkId = stimulusEngine.scheduleCheck(5_000, reason);
      adjutantState.setMeta(debounceKey(projectContext.projectId), checkId);

      logInfo("advance_auto_develop_phase", {
        agentId,
        projectId: projectContext.projectId,
        previousPhase: currentPhase,
        newPhase: nextPhase,
        scheduledCheckId: checkId,
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            previousPhase: currentPhase,
            newPhase: nextPhase,
            scheduledCheckId: checkId,
          }),
        }],
      };
    },
  );
}
