/**
 * Auto-develop loop behavior — the core 7-phase autonomous development loop.
 *
 * Phases: ANALYZE → IDEATE → REVIEW → GATE → PLAN → EXECUTE → VALIDATE → (back to ANALYZE)
 *
 * The behavior schedules coordinator wakes with phase-specific context.
 * It never spawns agents or messages them directly — only the coordinator does that.
 *
 * @module services/adjutant/behaviors/auto-develop-loop
 */

import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { StimulusEngine } from "../stimulus-engine.js";
import type { ProposalStore } from "../../proposal-store.js";
import type { AutoDevelopStore } from "../../auto-develop-store.js";
import { getAutoDevelopProjects, getProject } from "../../projects-service.js";
import { getEventBus } from "../../event-bus.js";
import { classifyConfidence } from "../../confidence-engine.js";
import { buildEscalationMessage } from "../../escalation-builder.js";
import {
  AUTO_DEVELOP_LIMITS,
  MAX_REVIEW_ROUNDS,
  type AutoDevelopPhase,
} from "../../../types/auto-develop.js";

// ============================================================================
// Constants
// ============================================================================

/** Metadata key prefix for per-project state */
const META_PREFIX = "auto_develop_";

/** Delay before waking the coordinator (fast loop) */
const SCHEDULE_DELAY_MS = 5_000;

/** Delay for backpressure re-checks */
const BACKPRESSURE_DELAY_MS = 60_000;

// ============================================================================
// Metadata key helpers
// ============================================================================

/** Metadata key for current phase per project */
export function phaseKey(projectId: string): string {
  return `${META_PREFIX}phase_${projectId}`;
}

/** Metadata key for debounce (prevents duplicate scheduling) */
export function debounceKey(projectId: string): string {
  return `${META_PREFIX}debounce_${projectId}`;
}

/** Metadata key for last ideation timestamp (cooldown tracking) */
export function lastIdeationKey(projectId: string): string {
  return `${META_PREFIX}last_ideation_${projectId}`;
}

// ============================================================================
// Phase reason builders
// ============================================================================

/**
 * Build a coordinator wake reason string for the given phase.
 * The coordinator reads this as its situation prompt and decides what to do.
 */
export function buildPhaseReason(
  projectId: string,
  projectName: string,
  phase: AutoDevelopPhase,
  proposalStore: ProposalStore,
  autoDevelopStore: AutoDevelopStore,
  state: AdjutantState,
): string {
  switch (phase) {
    case "analyze":
      return buildAnalyzeReason(projectId, projectName, proposalStore);
    case "ideate":
      return buildIdeateReason(projectId, projectName, proposalStore);
    case "review":
      return buildReviewReason(projectId, projectName, proposalStore);
    case "gate":
      return buildGateReason(projectId, projectName, proposalStore);
    case "plan":
      return buildPlanReason(projectId, projectName, proposalStore);
    case "execute":
      return buildExecuteReason(projectId, projectName, state);
    case "validate":
      return buildValidateReason(projectId, projectName, autoDevelopStore);
    default:
      return `Auto-develop loop: unknown phase "${String(phase)}" for project "${projectName}" (${projectId})`;
  }
}

function buildAnalyzeReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const projectFilter = { project: [projectId, projectName] };
  const pending = proposalStore.getProposals({ status: "pending", ...projectFilter });
  const accepted = proposalStore.getProposals({ status: "accepted", ...projectFilter });

  // Get project vision context
  const projectResult = getProject(projectId);
  const visionContext = projectResult.success ? projectResult.data?.visionContext : undefined;

  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP ANALYZE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push("Current proposal state:");
  parts.push(`  - Pending: ${pending.length}`);
  parts.push(`  - Accepted: ${accepted.length}`);
  if (visionContext) {
    parts.push("");
    parts.push(`Vision context: ${visionContext.slice(0, 500)}`);
  }
  parts.push("");
  parts.push("ACTION: Assess the project state and transition to IDEATE if the project needs new proposals, or skip to REVIEW/PLAN if there are pending/accepted proposals to process.");

  return parts.join("\n");
}

function buildIdeateReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const projectFilter = { project: [projectId, projectName] };
  const existing = proposalStore.getProposals({ ...projectFilter });

  const projectResult = getProject(projectId);
  const visionContext = projectResult.success ? projectResult.data?.visionContext : undefined;

  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP IDEATE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push(`Existing proposals: ${existing.length}`);
  if (existing.length > 0) {
    parts.push("Recent proposals:");
    for (const p of existing.slice(0, 5)) {
      parts.push(`  - [${p.id}] "${p.title}" (${p.status})`);
    }
  }
  if (visionContext) {
    parts.push("");
    parts.push(`Vision context: ${visionContext.slice(0, 500)}`);
  }
  parts.push("");
  parts.push("ACTION: Spawn an ideation agent to analyze the codebase and create new proposals for this project. The ideation agent should consider the vision context and avoid duplicating existing proposals.");

  return parts.join("\n");
}

function buildReviewReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const projectFilter = { project: [projectId, projectName] };
  const pending = proposalStore.getProposals({ status: "pending", ...projectFilter });

  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP REVIEW — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push(`Proposals awaiting review: ${pending.length}`);
  if (pending.length > 0) {
    for (const p of pending.slice(0, 5)) {
      const scoreStr = p.confidenceScore !== undefined ? ` (score: ${p.confidenceScore})` : " (unscored)";
      parts.push(`  - [${p.id}] "${p.title}"${scoreStr} round=${p.reviewRound}`);
    }
  }
  parts.push("");
  parts.push("ACTION: Spawn reviewer agents to evaluate pending proposals. Each reviewer should score the proposals using the confidence signal dimensions (reviewerConsensus, specClarity, codebaseAlignment, riskAssessment, historicalSuccess).");

  return parts.join("\n");
}

function buildGateReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const scored = proposalStore.getProposalsByConfidenceRange(
    [projectId, projectName],
    0,
    100,
  );

  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP GATE — Project: "${projectName}" (${projectId})`);
  parts.push("");

  if (scored.length === 0) {
    parts.push("No scored proposals found. Transition back to REVIEW.");
  } else {
    parts.push("Scored proposals:");
    for (const p of scored.slice(0, 10)) {
      const classification = p.confidenceScore !== undefined
        ? classifyConfidence(p.confidenceScore)
        : "unclassified";
      parts.push(`  - [${p.id}] "${p.title}" score=${p.confidenceScore ?? "?"} → ${classification} (round ${p.reviewRound})`);
    }
  }

  parts.push("");
  parts.push("ACTION: Apply gate decisions to each scored proposal:");
  parts.push("  - Score >= 80: Accept proposal, transition to PLAN");
  parts.push("  - Score 60-79: Increment review round, send back to REVIEW (max 3 rounds)");
  parts.push("  - Score 40-59: Escalate to user (pause auto-develop)");
  parts.push("  - Score < 40: Dismiss proposal");

  return parts.join("\n");
}

function buildPlanReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const projectFilter = { project: [projectId, projectName] };
  const accepted = proposalStore.getProposals({ status: "accepted", ...projectFilter });

  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP PLAN — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push(`Accepted proposals ready for planning: ${accepted.length}`);
  if (accepted.length > 0) {
    for (const p of accepted.slice(0, 5)) {
      parts.push(`  - [${p.id}] "${p.title}"`);
    }
  }
  parts.push("");
  parts.push("ACTION: Run the epic-planner for each accepted proposal. This creates specs, plans, tasks, and beads for execution.");

  return parts.join("\n");
}

function buildExecuteReason(
  projectId: string,
  projectName: string,
  state: AdjutantState,
): string {
  const activeSpawns = state.countActiveSpawns();

  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP EXECUTE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push(`Current active agent spawns: ${activeSpawns}`);
  parts.push("");
  parts.push("ACTION: Spawn engineering squads to execute the planned epics. Assign beads and monitor progress.");

  return parts.join("\n");
}

function buildValidateReason(
  projectId: string,
  projectName: string,
  autoDevelopStore: AutoDevelopStore,
): string {
  const activeCycle = autoDevelopStore.getActiveCycle(projectId);

  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP VALIDATE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  if (activeCycle) {
    parts.push(`Active cycle: ${activeCycle.id}`);
    parts.push(`  - Proposals generated: ${activeCycle.proposalsGenerated}`);
    parts.push(`  - Proposals accepted: ${activeCycle.proposalsAccepted}`);
    parts.push(`  - Proposals escalated: ${activeCycle.proposalsEscalated}`);
    parts.push(`  - Proposals dismissed: ${activeCycle.proposalsDismissed}`);
  }
  parts.push("");
  parts.push("ACTION: Spawn QA/review agents to validate the completed work. After validation, complete the cycle and transition back to ANALYZE.");

  return parts.join("\n");
}

// ============================================================================
// Phase transition logic
// ============================================================================

/**
 * Determine the next phase based on current state.
 * Returns the next phase and any gate actions to perform.
 */
export function determineNextPhase(
  currentPhase: AutoDevelopPhase,
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): { nextPhase: AutoDevelopPhase; gateActions?: GateAction[] } {
  const projectFilter = { project: [projectId, projectName] };

  switch (currentPhase) {
    case "analyze": {
      // Check if there are proposals needing review
      const pending = proposalStore.getProposals({ status: "pending", ...projectFilter });
      const accepted = proposalStore.getProposals({ status: "accepted", ...projectFilter });

      if (accepted.length > 0) return { nextPhase: "plan" };
      if (pending.length > 0) return { nextPhase: "review" };

      // Check proposal cap before ideating
      if (pending.length >= AUTO_DEVELOP_LIMITS.maxProposalsInReview) {
        return { nextPhase: "review" };
      }

      return { nextPhase: "ideate" };
    }
    case "ideate":
      return { nextPhase: "review" };
    case "review":
      return { nextPhase: "gate" };
    case "gate": {
      // Evaluate scored proposals and build gate actions
      const scored = proposalStore.getProposalsByConfidenceRange(
        [projectId, projectName],
        0,
        100,
      );
      const gateActions: GateAction[] = [];

      let hasAccepted = false;
      let hasEscalation = false;

      for (const proposal of scored) {
        if (proposal.confidenceScore === undefined) continue;
        const classification = classifyConfidence(proposal.confidenceScore);

        switch (classification) {
          case "accept":
            gateActions.push({ proposalId: proposal.id, action: "accept", score: proposal.confidenceScore });
            hasAccepted = true;
            break;
          case "refine":
            if (proposal.reviewRound < MAX_REVIEW_ROUNDS) {
              gateActions.push({
                proposalId: proposal.id,
                action: "refine",
                score: proposal.confidenceScore,
                reviewRound: proposal.reviewRound + 1,
              });
            } else {
              gateActions.push({
                proposalId: proposal.id,
                action: "escalate",
                score: proposal.confidenceScore,
                reason: `Max review rounds (${MAX_REVIEW_ROUNDS}) reached`,
              });
              hasEscalation = true;
            }
            break;
          case "escalate":
            gateActions.push({
              proposalId: proposal.id,
              action: "escalate",
              score: proposal.confidenceScore,
              reason: "Low confidence score",
            });
            hasEscalation = true;
            break;
          case "dismiss":
            gateActions.push({ proposalId: proposal.id, action: "dismiss", score: proposal.confidenceScore });
            break;
        }
      }

      if (hasEscalation) return { nextPhase: "analyze", gateActions }; // Escalation pauses; reset to analyze
      if (hasAccepted) return { nextPhase: "plan", gateActions };
      // If only refine/dismiss, go back to review
      return { nextPhase: "review", gateActions };
    }
    case "plan":
      return { nextPhase: "execute" };
    case "execute":
      return { nextPhase: "validate" };
    case "validate":
      return { nextPhase: "analyze" };
    default:
      return { nextPhase: "analyze" };
  }
}

export interface GateAction {
  proposalId: string;
  action: "accept" | "refine" | "escalate" | "dismiss";
  score: number;
  reviewRound?: number;
  reason?: string;
}

// ============================================================================
// Concurrency & backpressure helpers (Task 5)
// ============================================================================

/**
 * Check if ideation should be skipped due to proposal cap.
 * Returns true if the number of pending proposals >= maxProposalsInReview.
 */
export function shouldSkipIdeation(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): boolean {
  const projectFilter = { project: [projectId, projectName] };
  const pending = proposalStore.getProposals({ status: "pending", ...projectFilter });
  return pending.length >= AUTO_DEVELOP_LIMITS.maxProposalsInReview;
}

/**
 * Check if execution should be paused due to agent slot backpressure.
 * Returns true if countActiveSpawns() meets or exceeds a practical limit.
 */
export function shouldPauseExecution(state: AdjutantState): boolean {
  // MAX_SESSIONS=10 is the tmux-managed limit; leave headroom
  const MAX_AGENT_SLOTS = 8;
  return state.countActiveSpawns() >= MAX_AGENT_SLOTS;
}

/**
 * Check if ideation is in cooldown period.
 * Returns true if less than proposalCooldownMs has passed since last ideation.
 */
export function isIdeationOnCooldown(
  projectId: string,
  state: AdjutantState,
): boolean {
  const lastIdeation = state.getMeta(lastIdeationKey(projectId));
  if (!lastIdeation) return false;
  const elapsed = Date.now() - Number(lastIdeation);
  return elapsed < AUTO_DEVELOP_LIMITS.proposalCooldownMs;
}

// ============================================================================
// Behavior factory
// ============================================================================

/**
 * Create the auto-develop-loop behavior.
 *
 * Drives the 7-phase development loop for projects with auto-develop enabled.
 * Schedules coordinator wakes with phase-specific context via stimulusEngine.
 * Never spawns agents or messages them directly.
 */
export function createAutoDevelopLoop(
  stimulusEngine: StimulusEngine,
  proposalStore: ProposalStore,
  autoDevelopStore: AutoDevelopStore,
): AdjutantBehavior {
  return {
    name: "auto-develop-loop",
    triggers: [
      "project:auto_develop_enabled",
      "bead:closed",
      "proposal:scored",
    ],
    schedule: "*/30 * * * *", // 30-minute heartbeat
    excludeRoles: ["coordinator"],

    shouldAct(event: BehaviorEvent, _state: AdjutantState): boolean {
      // Always act on auto_develop_enabled event
      if (event.name === "project:auto_develop_enabled") return true;

      // For cron ticks, check if any auto-develop project exists
      const data = event.data as Record<string, unknown>;
      if (data["cronTick"]) {
        const projects = getAutoDevelopProjects();
        return projects.success && (projects.data?.length ?? 0) > 0;
      }

      // For other events (bead:closed, proposal:scored), always act
      // act() will check project scope
      return true;
    },

    async act(_event: BehaviorEvent, state: AdjutantState, comm: CommunicationManager): Promise<void> {
      // Get all auto-develop projects
      const projectsResult = getAutoDevelopProjects();
      if (!projectsResult.success || !projectsResult.data?.length) return;

      for (const project of projectsResult.data) {
        // Skip paused projects
        if (project.autoDevelopPausedAt) continue;

        // Get or determine current phase
        const currentPhase = (state.getMeta(phaseKey(project.id)) ?? "analyze") as AutoDevelopPhase;

        // Debounce: skip if we already have a pending check
        const existingCheck = state.getMeta(debounceKey(project.id));
        if (existingCheck) continue;

        // Concurrency control: skip ideation if proposal cap reached
        if (currentPhase === "ideate" && shouldSkipIdeation(project.id, project.name, proposalStore)) {
          // Jump to review instead
          state.setMeta(phaseKey(project.id), "review");
          state.logDecision({
            behavior: "auto-develop-loop",
            action: "skip_ideation_proposal_cap",
            target: project.id,
            reason: `Proposal cap reached (>=${AUTO_DEVELOP_LIMITS.maxProposalsInReview}), skipping to review`,
          });
          continue;
        }

        // Cooldown: skip ideation if recently completed
        if (currentPhase === "ideate" && isIdeationOnCooldown(project.id, state)) {
          state.logDecision({
            behavior: "auto-develop-loop",
            action: "skip_ideation_cooldown",
            target: project.id,
            reason: `Ideation cooldown active (${AUTO_DEVELOP_LIMITS.proposalCooldownMs}ms)`,
          });
          continue;
        }

        // Backpressure: pause at execute when agent slots full
        if (currentPhase === "execute" && shouldPauseExecution(state)) {
          const checkId = stimulusEngine.scheduleCheck(
            BACKPRESSURE_DELAY_MS,
            `Waiting for agent slots to free up — Project: "${project.name}" (${project.id})`,
          );
          state.setMeta(debounceKey(project.id), checkId);
          state.logDecision({
            behavior: "auto-develop-loop",
            action: "backpressure_pause",
            target: project.id,
            reason: "Agent slots at capacity, delaying execution",
          });
          continue;
        }

        // Handle gate actions if in gate phase
        if (currentPhase === "gate") {
          const { gateActions } = determineNextPhase(
            currentPhase,
            project.id,
            project.name,
            proposalStore,
          );

          if (gateActions) {
            for (const action of gateActions) {
              if (action.action === "escalate") {
                // Build and send escalation message
                const proposal = proposalStore.getProposal(action.proposalId);
                if (proposal) {
                  const escalationMsg = buildEscalationMessage(
                    project.name,
                    [{
                      id: proposal.id,
                      title: proposal.title,
                      confidenceScore: action.score,
                      primaryConcern: action.reason ?? "Low confidence",
                    }],
                  );
                  await comm.escalate(escalationMsg.body);

                  // Emit escalation event
                  getEventBus().emit("auto_develop:escalated", {
                    projectId: project.id,
                    reason: action.reason ?? "Low confidence score",
                    proposalIds: [action.proposalId],
                  });
                }
              }
            }
          }
        }

        // Record ideation timestamp when entering ideate phase
        if (currentPhase === "ideate") {
          state.setMeta(lastIdeationKey(project.id), String(Date.now()));
        }

        // Ensure we have an active cycle
        let activeCycle = autoDevelopStore.getActiveCycle(project.id);
        if (!activeCycle) {
          activeCycle = autoDevelopStore.startCycle(project.id, currentPhase);
        } else if (activeCycle.phase !== currentPhase) {
          autoDevelopStore.updateCycle(activeCycle.id, { phase: currentPhase });
        }

        // Complete cycle and start fresh when returning to analyze from validate
        if (currentPhase === "validate") {
          autoDevelopStore.completeCycle(activeCycle.id);
        }

        // Build phase-specific reason and schedule coordinator wake
        const reason = buildPhaseReason(
          project.id,
          project.name,
          currentPhase,
          proposalStore,
          autoDevelopStore,
          state,
        );

        const checkId = stimulusEngine.scheduleCheck(SCHEDULE_DELAY_MS, reason);
        state.setMeta(debounceKey(project.id), checkId);

        // Emit phase change event
        getEventBus().emit("auto_develop:phase_changed", {
          projectId: project.id,
          cycleId: activeCycle.id,
          previousPhase: currentPhase,
          newPhase: currentPhase,
        });

        state.logDecision({
          behavior: "auto-develop-loop",
          action: `schedule_${currentPhase}`,
          target: project.id,
          reason: `Auto-develop loop: ${currentPhase} phase for project ${project.name}`,
        });
      }
    },
  };
}
