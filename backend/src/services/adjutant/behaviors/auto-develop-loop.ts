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
import { getAutoDevelopProjects, pauseAutoDevelop, clearAutoDevelopPause } from "../../projects-service.js";
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
  _proposalStore: ProposalStore,
): string {
  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP ANALYZE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push("NUDGE: Time to assess the project and decide the next phase.");
  parts.push("");
  parts.push("VERIFY STATE (do not trust this prompt for data — check manually):");
  parts.push("1. Call get_auto_develop_status to see current phase, proposals, and cycle state.");
  parts.push("2. Call list_beads to see open/in-progress work.");
  parts.push("3. Call list_agents to see who is active and what they are doing.");
  parts.push("");
  parts.push("THEN DECIDE:");
  parts.push("- If accepted proposals exist → advance_auto_develop_phase to PLAN.");
  parts.push("- If pending unscored proposals exist → advance_auto_develop_phase to REVIEW.");
  parts.push("- If no proposals → advance_auto_develop_phase to IDEATE.");
  parts.push("- Report your assessment via set_status.");

  return parts.join("\n");
}

function buildIdeateReason(
  projectId: string,
  projectName: string,
  _proposalStore: ProposalStore,
): string {
  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP IDEATE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push("NUDGE: Time to generate new proposals for this project.");
  parts.push("");
  parts.push("VERIFY STATE FIRST:");
  parts.push("1. Call get_auto_develop_status to check existing proposals and vision context.");
  parts.push("2. Call list_proposals (if available) to see what already exists — avoid duplicates.");
  parts.push("");
  parts.push("THEN ACT:");
  parts.push("1. Use spawn_worker to create an ideation agent. Include in the prompt:");
  parts.push("   - The project path and vision context.");
  parts.push("   - Instructions to use create_proposal MCP tool for each proposal.");
  parts.push("   - Instructions to analyze the codebase and create 1-3 proposals.");
  parts.push("2. After spawning, call advance_auto_develop_phase to transition to REVIEW.");
  parts.push("3. Report progress via set_status.");

  return parts.join("\n");
}

function buildReviewReason(
  projectId: string,
  projectName: string,
  _proposalStore: ProposalStore,
): string {
  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP REVIEW — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push("NUDGE: Proposals need reviewing. Check if reviewers are already working or need spawning.");
  parts.push("");
  parts.push("VERIFY STATE FIRST:");
  parts.push("1. Call get_auto_develop_status to see pending proposal count and scores.");
  parts.push("2. Call list_agents to check if reviewer agents are already active.");
  parts.push("3. If reviewers are still working → wait (do nothing, you'll be nudged again).");
  parts.push("4. If all proposals are scored → call advance_auto_develop_phase to transition to GATE.");
  parts.push("");
  parts.push("IF REVIEWERS NEED SPAWNING:");
  parts.push("1. Use spawn_worker for each unscored proposal with instructions to:");
  parts.push("   - Read the proposal via get_proposal MCP tool.");
  parts.push("   - Score using the 5 confidence signals via score_proposal MCP tool.");
  parts.push("2. Report progress via set_status.");

  return parts.join("\n");
}

function buildGateReason(
  projectId: string,
  projectName: string,
  _proposalStore: ProposalStore,
): string {
  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP GATE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push("NUDGE: Scored proposals need gate decisions.");
  parts.push("");
  parts.push("VERIFY STATE FIRST:");
  parts.push("1. Call get_auto_develop_status to see proposal scores and classifications.");
  parts.push("2. If no scored proposals → advance_auto_develop_phase back to REVIEW.");
  parts.push("");
  parts.push("THEN APPLY GATE DECISIONS:");
  parts.push("- Score >= 80: Accept (update status to 'accepted').");
  parts.push("- Score 60-79: Send back for revision (max 3 rounds) → advance to REVIEW.");
  parts.push("- Score 40-59: Escalate to user via send_message (loop auto-pauses).");
  parts.push("- Score < 40: Dismiss (update status to 'dismissed').");
  parts.push("");
  parts.push("AFTER PROCESSING:");
  parts.push("- If any accepted → advance_auto_develop_phase to PLAN.");
  parts.push("- Report all gate decisions via announce for user visibility.");

  return parts.join("\n");
}

function buildPlanReason(
  projectId: string,
  projectName: string,
  _proposalStore: ProposalStore,
): string {
  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP PLAN — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push("NUDGE: Accepted proposals need planning. Check if planners are working or need spawning.");
  parts.push("");
  parts.push("VERIFY STATE FIRST:");
  parts.push("1. Call get_auto_develop_status to see accepted proposals.");
  parts.push("2. Call list_agents to check if planning agents are already active.");
  parts.push("3. Call list_beads to see if epics/tasks have already been created for accepted proposals.");
  parts.push("4. If planners are still working → wait (you'll be nudged again when they finish).");
  parts.push("5. If all accepted proposals have been planned (beads exist) → advance_auto_develop_phase to EXECUTE.");
  parts.push("");
  parts.push("IF PLANNERS NEED SPAWNING:");
  parts.push("1. Use spawn_worker for each accepted proposal with instructions to:");
  parts.push("   - Use /execute-proposal or /epic-planner skill.");
  parts.push("   - Create specs, plans, tasks, and beads.");
  parts.push("2. Report progress via set_status.");

  return parts.join("\n");
}

function buildExecuteReason(
  projectId: string,
  projectName: string,
  _state: AdjutantState,
): string {
  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP EXECUTE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push("NUDGE: Execution phase — check if squads are working, done, or need spawning.");
  parts.push("");
  parts.push("VERIFY STATE FIRST:");
  parts.push("1. Call list_agents to see who is active, idle, or done.");
  parts.push("2. Call list_beads to check open/in-progress tasks under the planned epics.");
  parts.push("3. If agents are still working → wait (you'll be nudged again on status changes).");
  parts.push("4. If agents are done/idle AND open beads remain → investigate (blocked? crashed?).");
  parts.push("5. If all epic tasks are closed → advance_auto_develop_phase to VALIDATE.");
  parts.push("   NOTE: QA sentinels may have created follow-on beads — check those too.");
  parts.push("");
  parts.push("PARALLEL EXECUTION — DEPENDENCY ANALYSIS (REQUIRED BEFORE SPAWNING):");
  parts.push("Before assigning agents, analyze epic dependencies:");
  parts.push("1. Call list_beads to get all planned epics for this project.");
  parts.push("2. For each epic, check its dependency chain (parent/child beads).");
  parts.push("3. Classify epics into groups:");
  parts.push("   - INDEPENDENT: Epics with no shared dependency chains → assign to DIFFERENT agents via separate spawn_worker calls.");
  parts.push("   - DEPENDENT: Epics sharing dependency chains → assign to the SAME agent sequentially.");
  parts.push("4. Spawn one squad leader per independent group. For dependent groups, include ALL epics in a single spawn_worker prompt.");
  parts.push("5. Monitor ALL parallel agents — only advance_auto_develop_phase to VALIDATE when ALL agents are done.");
  parts.push("");
  parts.push("IF SQUADS NEED SPAWNING:");
  parts.push("1. Use spawn_worker to create squad leaders for each planned epic (or group of dependent epics).");
  parts.push("   Include: epic bead ID(s), project path, /squad-execute skill instructions.");
  parts.push("2. Report progress via set_status.");

  return parts.join("\n");
}

/**
 * QA Sentinel spawn prompt template.
 *
 * The coordinator fills in {{acceptance_criteria}} and {{epic_id}} before
 * passing this to spawn_worker. The sentinel verifies each criterion,
 * files bug beads for failures, and reports findings.
 */
export const QA_SENTINEL_PROMPT_TEMPLATE = `\
=== QA SENTINEL — VALIDATION PASS ===

You are a QA Sentinel. Your job is to validate that the implemented feature
meets ALL acceptance criteria and works end-to-end as a user would experience it.

## Epic Under Test
{{epic_id}}

## Acceptance Criteria to Verify
{{acceptance_criteria}}

## Instructions

1. **Run the app** — start the backend and frontend (npm run dev or equivalent).
   Verify the app boots without errors.

2. **Verify EACH acceptance criterion** listed above:
   - For each criterion, describe what you tested and whether it passed or failed.
   - Do NOT skip any criterion. Every one must have an explicit pass/fail.

3. **Check integration gaps**:
   - Are all new systems wired together? (e.g., new backend route actually called by frontend)
   - Are new MCP tools registered and callable by agents?
   - Are new database tables/columns migrated and populated?
   - Do WebSocket events propagate from backend to frontend?

4. **Run tests**: Execute \`npm test\` and \`npm run build\` to confirm CI-level checks pass.

5. **File bugs for failures**:
   - For each failed criterion or integration gap, create a bug bead:
     \`bd create --id={{epic_id}}.N.M.P --title="Bug: <description>" --type=bug --priority=1\`
   - Use priority=1 for blocking issues, priority=2 for non-blocking issues.
   - Include reproduction steps in the bug description.

6. **Report findings**:
   - Use send_message to report your findings to the coordinator.
   - Summarize: total criteria checked, passed, failed, bugs filed.
   - If all criteria pass and no integration gaps found, state: "VALIDATION PASSED".
   - If any criterion fails, state: "VALIDATION FAILED — N bugs filed".

7. **Set status**: Use set_status({ status: "done" }) when finished.
`;

function buildValidateReason(
  projectId: string,
  projectName: string,
  _autoDevelopStore: AutoDevelopStore,
): string {
  const parts: string[] = [];
  parts.push(`AUTO-DEVELOP VALIDATE — Project: "${projectName}" (${projectId})`);
  parts.push("");
  parts.push("NUDGE: Validation phase — check if QA is running, done, or needs spawning.");
  parts.push("");
  parts.push("VERIFY STATE FIRST:");
  parts.push("1. Call list_agents to see if QA/review agents are active.");
  parts.push("2. Call list_beads to check if any bug beads were created by QA.");
  parts.push("3. Call get_auto_develop_status to see cycle stats.");
  parts.push("4. If QA agents are still working → wait (you'll be nudged again).");
  parts.push("5. If QA found bugs (open P0/P1 bug beads under the epic) → advance_auto_develop_phase back to EXECUTE.");
  parts.push("6. If QA passed (no open P0/P1 bugs) → advance_auto_develop_phase to ANALYZE (starts new cycle).");
  parts.push("");
  parts.push("BEFORE SPAWNING QA — LOOK UP ACCEPTANCE CRITERIA:");
  parts.push("1. Find the epic being validated (the accepted proposal that was just executed).");
  parts.push("2. Read the proposal description or the spec.md in the specs/ directory for acceptance criteria.");
  parts.push("3. Extract a concrete checklist of acceptance criteria to pass to the QA Sentinel.");
  parts.push("4. If no explicit criteria exist, derive them from the proposal title and description.");
  parts.push("");
  parts.push("IF QA NEEDS SPAWNING:");
  parts.push("1. Use spawn_worker to create a QA Sentinel agent.");
  parts.push("2. Use the QA_SENTINEL_PROMPT_TEMPLATE (exported from auto-develop-loop.ts) as the base prompt.");
  parts.push("3. Replace {{acceptance_criteria}} with the checklist you extracted above.");
  parts.push("4. Replace {{epic_id}} with the epic bead ID under validation.");
  parts.push("5. Instruct the QA Sentinel to verify EACH criterion, not just 'check tests pass'.");
  parts.push("");
  parts.push("CHECK FOR INTEGRATION GAPS:");
  parts.push("- Systems built but not wired together (e.g., API exists but frontend never calls it).");
  parts.push("- Database migrations created but not applied.");
  parts.push("- MCP tools registered but not exposed or documented.");
  parts.push("- Include integration gap checks in the QA Sentinel spawn prompt.");
  parts.push("");
  parts.push("END-TO-END VERIFICATION:");
  parts.push("- The feature must work as a user would experience it, not just pass unit tests.");
  parts.push("- QA should attempt the user flow described in the acceptance criteria.");
  parts.push("- If the feature involves UI, QA should verify the UI renders and behaves correctly.");
  parts.push("");
  parts.push("AFTER QA COMPLETES:");
  parts.push("- Check for open P0/P1 bug beads under the epic.");
  parts.push("- advance_auto_develop_phase will BLOCK if P0/P1 bugs remain open.");
  parts.push("- Fix bugs first (loop back to EXECUTE), then re-validate.");
  parts.push("- Announce cycle completion only when validation passes with no open critical bugs.");

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
      "agent:status_changed",
      "proposal:scored",
    ],
    schedule: "*/15 * * * *", // 15-minute heartbeat
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

      // For agent status changes, only act on completion signals (done/idle)
      // These indicate an agent may have finished work for a coordinator-driven phase
      if (event.name === "agent:status_changed") {
        const status = data["status"] as string | undefined;
        return status === "done" || status === "idle";
      }

      // For proposal:scored, always act — the gate phase needs to process scores
      return true;
    },

    async act(_event: BehaviorEvent, state: AdjutantState, comm: CommunicationManager): Promise<void> {
      // Handle proposal:scored event — increment cycle counter in real-time (adj-152.6.4)
      if (_event.name === "proposal:scored") {
        const scoredData = _event.data as { projectId?: string };
        if (scoredData.projectId) {
          const activeCycle = autoDevelopStore.getActiveCycle(scoredData.projectId);
          if (activeCycle) {
            // Re-sync counters using cycle-scoped filter
            const cycleFilter = { project: scoredData.projectId, createdAfter: activeCycle.startedAt };
            const allProposals = proposalStore.getProposals({ ...cycleFilter });
            const acceptedCount = proposalStore.getProposals({ status: "accepted", ...cycleFilter }).length;
            const escalatedCount = allProposals.filter(
              p => p.confidenceScore !== undefined && p.confidenceScore !== null && p.confidenceScore >= 40 && p.confidenceScore < 60,
            ).length;
            const dismissedCount = proposalStore.getProposals({ status: "dismissed", ...cycleFilter }).length;
            autoDevelopStore.updateCycle(activeCycle.id, {
              proposalsGenerated: allProposals.length,
              proposalsAccepted: acceptedCount,
              proposalsEscalated: escalatedCount,
              proposalsDismissed: dismissedCount,
            });
          }
        }
      }

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

        // Ensure we have an active cycle (single getActiveCycle call, reused below)
        let activeCycle = autoDevelopStore.getActiveCycle(project.id);

        // Empty cycle prevention (adj-152.6.2): avoid creating cycles that show 0/0/0.
        // Only applies when: (a) no active cycle, (b) a completed cycle exists (we looped back),
        // (c) analyze/ideate phase, and (d) no proposals exist. First-ever cycle is always allowed.
        if (!activeCycle) {
          const previousCycles = autoDevelopStore.getCycleHistory(project.id, 1);
          if (previousCycles.length > 0 && (currentPhase === "analyze" || currentPhase === "ideate")) {
            const projectFilter = { project: project.id };
            const hasPendingProposals = proposalStore.getProposals({ status: "pending", ...projectFilter }).length > 0;
            const hasAcceptedProposals = proposalStore.getProposals({ status: "accepted", ...projectFilter }).length > 0;

            if (!hasPendingProposals && !hasAcceptedProposals) {
              // No work to do — transition to ideate:research instead of creating empty cycle
              state.setMeta(phaseKey(project.id), "ideate");
              state.logDecision({
                behavior: "auto-develop-loop",
                action: "empty_cycle_prevention",
                target: project.id,
                reason: "No pending/accepted proposals after previous cycle — transitioning to ideate:research instead of creating empty cycle",
              });
              continue;
            }
          }
        }

        if (!activeCycle) {
          activeCycle = autoDevelopStore.startCycle(project.id, currentPhase);
        } else if (activeCycle.phase !== currentPhase) {
          autoDevelopStore.updateCycle(activeCycle.id, { phase: currentPhase });
        }

        // Update cycle counters from actual proposal data (adj-142, adj-143, adj-152.6.4)
        // Sync counters AFTER cycle creation to ensure we always have a valid cycle.
        // Filter by cycle start time so we only count proposals created during THIS cycle.
        {
          const cycleFilter = { project: project.id, createdAfter: activeCycle.startedAt };
          const allProposals = proposalStore.getProposals({ ...cycleFilter });
          const acceptedCount = proposalStore.getProposals({ status: "accepted", ...cycleFilter }).length;
          const escalatedCount = allProposals.filter(
            p => p.confidenceScore !== undefined && p.confidenceScore !== null && p.confidenceScore >= 40 && p.confidenceScore < 60,
          ).length;
          const dismissedCount = proposalStore.getProposals({ status: "dismissed", ...cycleFilter }).length;
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
