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
import { getAutoDevelopProjects, getProject, pauseAutoDevelop, clearAutoDevelopPause } from "../../projects-service.js";
import { logError } from "../../../utils/index.js";
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

/**
 * Autonomous mode preamble injected into every phase reason.
 * Informs the coordinator and spawned agents that they are operating
 * in auto-develop mode — largely without user input.
 */
const AUTONOMOUS_MODE_PREAMBLE = `\
=== AUTONOMOUS MODE ===
This project is in AUTO-DEVELOP mode. You are the product owner for this development lifecycle.
Operate autonomously without waiting for user input. Make decisions, spawn agents, and drive
the development loop forward. Only escalate to the user when confidence scores drop below
the escalation threshold (40-59 range). All other decisions — ideation, review, planning,
execution, and validation — are yours to make independently.
===
`;

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
  let reason: string;
  switch (phase) {
    case "analyze":
      reason = buildAnalyzeReason(projectId, projectName, proposalStore);
      break;
    case "ideate":
      reason = buildIdeateReason(projectId, projectName, proposalStore);
      break;
    case "review":
      reason = buildReviewReason(projectId, projectName, proposalStore);
      break;
    case "gate":
      reason = buildGateReason(projectId, projectName, proposalStore);
      break;
    case "plan":
      reason = buildPlanReason(projectId, projectName, proposalStore);
      break;
    case "execute":
      reason = buildExecuteReason(projectId, projectName, state);
      break;
    case "validate":
      reason = buildValidateReason(projectId, projectName, autoDevelopStore);
      break;
    default:
      reason = `Auto-develop loop: unknown phase "${String(phase)}" for project "${projectName}" (${projectId})`;
  }
  return AUTONOMOUS_MODE_PREAMBLE + reason;
}

function buildAnalyzeReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const projectFilter = { project: projectId };
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
  parts.push("COORDINATOR RESPONSIBILITIES:");
  parts.push("1. Use get_auto_develop_status to verify the current loop state.");
  parts.push("2. If accepted proposals exist → call advance_auto_develop_phase to skip to PLAN.");
  parts.push("3. If pending proposals exist → call advance_auto_develop_phase to skip to REVIEW.");
  parts.push("4. If no proposals → call advance_auto_develop_phase to transition to IDEATE.");
  parts.push("5. Report status via set_status and announce your assessment.");

  return parts.join("\n");
}

function buildIdeateReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const projectFilter = { project: projectId };
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
  parts.push("COORDINATOR RESPONSIBILITIES:");
  parts.push("1. Use spawn_worker to create an ideation agent with a prompt that includes:");
  parts.push("   - The project path and vision context (above).");
  parts.push("   - Instructions to use create_proposal MCP tool for each proposal.");
  parts.push("   - Instructions to avoid duplicating existing proposals (listed above).");
  parts.push("2. The ideation agent should analyze the codebase, identify improvements, and create 1-3 proposals.");
  parts.push("3. After spawning, call advance_auto_develop_phase to transition to REVIEW.");
  parts.push("4. Report progress via set_status.");

  return parts.join("\n");
}

function buildReviewReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const projectFilter = { project: projectId };
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
  parts.push("COORDINATOR RESPONSIBILITIES:");
  parts.push("1. For each pending proposal, use spawn_worker to create a reviewer agent.");
  parts.push("2. Each reviewer's prompt must include the proposal ID and instructions to:");
  parts.push("   - Read the proposal via get_proposal MCP tool.");
  parts.push("   - Evaluate against the 5 confidence signals (0-100 each):");
  parts.push("     reviewerConsensus, specClarity, codebaseAlignment, riskAssessment, historicalSuccess.");
  parts.push("   - Submit scores via score_proposal MCP tool.");
  parts.push("3. After all reviewers are spawned, call advance_auto_develop_phase to transition to GATE.");
  parts.push("4. Report progress via set_status.");

  return parts.join("\n");
}

function buildGateReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const scored = proposalStore.getProposalsByConfidenceRange(
    projectId,
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
  parts.push("COORDINATOR RESPONSIBILITIES:");
  parts.push("1. For each scored proposal, apply the confidence gate:");
  parts.push("   - Score >= 80: Accept the proposal (update status to 'accepted').");
  parts.push("   - Score 60-79: Send back for revision (max 3 rounds). Call advance_auto_develop_phase(targetPhase='review').");
  parts.push("   - Score 40-59: Escalate to user via send_message. The loop will auto-pause.");
  parts.push("   - Score < 40: Dismiss the proposal (update status to 'dismissed').");
  parts.push("2. After processing all proposals, call advance_auto_develop_phase to the appropriate next phase.");
  parts.push("3. If any proposals were accepted → transition to PLAN.");
  parts.push("4. Report all gate decisions via announce for user visibility.");

  return parts.join("\n");
}

function buildPlanReason(
  projectId: string,
  projectName: string,
  proposalStore: ProposalStore,
): string {
  const projectFilter = { project: projectId };
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
  parts.push("COORDINATOR RESPONSIBILITIES:");
  parts.push("1. For each accepted proposal, use spawn_worker to create a planning agent.");
  parts.push("2. The planning agent's prompt must include the proposal ID and instructions to:");
  parts.push("   - Use the /execute-proposal skill or /epic-planner skill.");
  parts.push("   - Create specs, plans, tasks, and beads for execution.");
  parts.push("   - Assign beads to the project.");
  parts.push("3. After all planning agents are spawned, call advance_auto_develop_phase to transition to EXECUTE.");
  parts.push("4. Report progress via set_status.");

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
  parts.push("COORDINATOR RESPONSIBILITIES:");
  parts.push("1. Use spawn_worker to create squad leaders for each planned epic.");
  parts.push("2. Each squad leader's prompt must include:");
  parts.push("   - The epic bead ID and project path.");
  parts.push("   - Instructions to use /squad-execute skill for parallel execution.");
  parts.push("   - Instructions to build, test, and push before closing beads.");
  parts.push("3. Monitor agent status — if agents go idle or blocked, investigate and intervene.");
  parts.push("4. When all execution completes, call advance_auto_develop_phase to transition to VALIDATE.");
  parts.push("5. Report progress via set_status and announce milestones.");

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
  parts.push("COORDINATOR RESPONSIBILITIES:");
  parts.push("1. Use spawn_worker to create QA agents for the completed work.");
  parts.push("2. QA agents should run /code-review and verify build + tests pass.");
  parts.push("3. If QA finds issues, create bug beads and transition back to EXECUTE.");
  parts.push("4. If QA passes, call advance_auto_develop_phase to transition back to ANALYZE (starts new cycle).");
  parts.push("5. Announce cycle completion via announce({ type: 'completion', ... }).");

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
  _projectName: string,
  proposalStore: ProposalStore,
): { nextPhase: AutoDevelopPhase; gateActions?: GateAction[] } {
  const projectFilter = { project: projectId };

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
        projectId,
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
  _projectName: string,
  proposalStore: ProposalStore,
): boolean {
  const projectFilter = { project: projectId };
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
    schedule: "*/20 * * * *", // 20-minute heartbeat
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
        try {
        // Check escalation timeout for paused projects (adj-122.10.5)
        if (project.autoDevelopPausedAt) {
          const pausedAt = new Date(project.autoDevelopPausedAt).getTime();
          if (Date.now() - pausedAt > AUTO_DEVELOP_LIMITS.escalationTimeoutMs) {
            // Escalation timed out — auto-resume with fresh analysis
            clearAutoDevelopPause(project.id);
            state.setMeta(phaseKey(project.id), "analyze");
            state.logDecision({
              behavior: "auto-develop-loop",
              action: "escalation_timeout_resume",
              target: project.id,
              reason: `Escalation timed out after ${AUTO_DEVELOP_LIMITS.escalationTimeoutMs}ms, resuming with fresh analysis`,
            });
            // Fall through to process this project
          } else {
            continue; // Still paused
          }
        }

        // Clear debounce key so a new cycle can proceed (adj-122.10.1)
        state.setMeta(debounceKey(project.id), "");

        // Get or determine current phase
        const currentPhase = (state.getMeta(phaseKey(project.id)) ?? "analyze") as AutoDevelopPhase;

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

        // Concurrency control: limit epics in execution (adj-122.10.5)
        if (currentPhase === "execute") {
          const projectFilter = { project: project.id };
          const acceptedCount = proposalStore.getProposals({ status: "accepted", ...projectFilter }).length;
          if (acceptedCount >= AUTO_DEVELOP_LIMITS.maxEpicsInExecution) {
            const checkId = stimulusEngine.scheduleCheck(
              BACKPRESSURE_DELAY_MS,
              `Epic execution cap reached (${acceptedCount}>=${AUTO_DEVELOP_LIMITS.maxEpicsInExecution}) — Project: "${project.name}" (${project.id})`,
            );
            state.setMeta(debounceKey(project.id), checkId);
            state.logDecision({
              behavior: "auto-develop-loop",
              action: "epic_cap_pause",
              target: project.id,
              reason: `Epic execution cap reached (${acceptedCount} >= ${AUTO_DEVELOP_LIMITS.maxEpicsInExecution})`,
            });
            continue;
          }
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

                  // Pause auto-develop during escalation (adj-122.10.3)
                  pauseAutoDevelop(project.id);

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

        // Update cycle counters from actual proposal data (adj-142, adj-143)
        // Sync counters AFTER cycle creation to ensure we always have a valid cycle.
        {
          const projectFilter = { project: project.id };
          const allProposals = proposalStore.getProposals({ ...projectFilter });
          const acceptedCount = proposalStore.getProposals({ status: "accepted", ...projectFilter }).length;
          const escalatedCount = allProposals.filter(
            p => p.confidenceScore !== undefined && p.confidenceScore !== null && p.confidenceScore >= 40 && p.confidenceScore < 60,
          ).length;
          const dismissedCount = proposalStore.getProposals({ status: "dismissed", ...projectFilter }).length;
          autoDevelopStore.updateCycle(activeCycle.id, {
            proposalsGenerated: allProposals.length,
            proposalsAccepted: acceptedCount,
            proposalsEscalated: escalatedCount,
            proposalsDismissed: dismissedCount,
          });
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

        // Phases that require coordinator work (spawning agents, waiting for
        // completion) must NOT auto-advance. The coordinator calls
        // advance_auto_develop_phase when the work is done. (adj-142)
        const coordinatorDrivenPhases: AutoDevelopPhase[] = ["plan", "execute", "review", "validate"];
        if (!coordinatorDrivenPhases.includes(currentPhase)) {
          // Auto-advance phases that are instant decisions (analyze, ideate, gate)
          const { nextPhase } = determineNextPhase(
            currentPhase,
            project.id,
            project.name,
            proposalStore,
          );
          state.setMeta(phaseKey(project.id), nextPhase);

          // Emit phase change event with correct previous and new values
          getEventBus().emit("auto_develop:phase_changed", {
            projectId: project.id,
            cycleId: activeCycle.id,
            previousPhase: currentPhase,
            newPhase: nextPhase,
          });
        }

        state.logDecision({
          behavior: "auto-develop-loop",
          action: `schedule_${currentPhase}`,
          target: project.id,
          reason: `Auto-develop loop: ${currentPhase} phase for project ${project.name}`,
        });
        } catch (err) {
          // Per-project error isolation (adj-122.10.8)
          logError("auto-develop-loop", { projectId: project.id, error: String(err) });
        }
      }
    },
  };
}
