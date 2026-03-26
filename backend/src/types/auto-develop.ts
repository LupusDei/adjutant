/**
 * Auto-develop shared types.
 * Used across the confidence engine, loop behavior, stores, and MCP tools.
 */

import { z } from "zod";

// ============================================================================
// Confidence Types
// ============================================================================

/** Individual confidence signal scores (0-100 each) */
export interface ConfidenceSignals {
  /** Agreement between reviewer agents on feasibility/value (weight: 30%) */
  reviewerConsensus: number;
  /** Does the proposal have clear acceptance criteria? (weight: 20%) */
  specClarity: number;
  /** Does it fit existing architecture and conventions? (weight: 20%) */
  codebaseAlignment: number;
  /** Scope size, files touched, dependency changes (weight: 15%). Higher = less risky */
  riskAssessment: number;
  /** Past proposals of similar type/scope success rate (weight: 15%) */
  historicalSuccess: number;
}

/** Confidence signal weights — must sum to 1.0 */
export const CONFIDENCE_WEIGHTS: Record<keyof ConfidenceSignals, number> = {
  reviewerConsensus: 0.30,
  specClarity: 0.20,
  codebaseAlignment: 0.20,
  riskAssessment: 0.15,
  historicalSuccess: 0.15,
};

/** Confidence classification result */
export type ConfidenceClassification = "accept" | "refine" | "escalate" | "dismiss";

/** Confidence threshold boundaries */
export const CONFIDENCE_THRESHOLDS = {
  accept: 80,    // 80-100: auto-accept
  refine: 60,    // 60-79: send back for revision
  escalate: 40,  // 40-59: escalate to user
  // 0-39: auto-dismiss
} as const;

/** Maximum revision rounds before forced escalation */
export const MAX_REVIEW_ROUNDS = 3;

// ============================================================================
// Loop & Phase Types
// ============================================================================

/** Auto-develop loop phases */
export type AutoDevelopPhase =
  | "analyze"
  | "ideate"
  | "review"
  | "gate"
  | "plan"
  | "execute"
  | "validate";

/** Auto-develop concurrency limits */
export const AUTO_DEVELOP_LIMITS = {
  maxProposalsInReview: 3,
  maxEpicsInExecution: 2,
  proposalCooldownMs: 600_000, // 10 minutes
  heartbeatIntervalMs: 900_000, // 15 minutes
  escalationTimeoutMs: 86_400_000, // 24 hours
} as const;

// ============================================================================
// Status Types
// ============================================================================

/** Auto-develop project status (for API responses) */
export interface AutoDevelopStatus {
  enabled: boolean;
  paused: boolean;
  pausedAt: string | null;
  currentPhase: AutoDevelopPhase | null;
  activeCycleId: string | null;
  visionContext: string | null;
  proposals: {
    inReview: number;
    accepted: number;
    escalated: number;
    dismissed: number;
  };
  epicsInExecution: number;
  cycleStats: {
    totalCycles: number;
    completedCycles: number;
    /** Current cycle number (1-based, equal to totalCycles when a cycle is active) */
    currentCycleNumber: number;
  };
  /** Agent assigned as product owner for the auto-develop lifecycle */
  productOwner: string | null;
}

// ============================================================================
// Zod Schemas (API Input Validation)
// ============================================================================

/** Schema for enabling auto-develop on a project */
export const EnableAutoDevelopSchema = z.object({
  visionContext: z.string().max(10000).optional(),
});

/** Schema for providing a vision update */
export const ProvideVisionUpdateSchema = z.object({
  visionContext: z.string().min(1, "Vision context is required").max(10000),
});

/** Schema for scoring a proposal (from reviewer agents) */
export const ScoreProposalSchema = z.object({
  proposalId: z.string().min(1, "Proposal ID is required"),
  reviewerConsensus: z.number().min(0).max(100),
  specClarity: z.number().min(0).max(100),
  codebaseAlignment: z.number().min(0).max(100),
  riskAssessment: z.number().min(0).max(100),
  historicalSuccess: z.number().min(0).max(100),
});

/** Schema for the PATCH /api/projects/:id auto-develop fields */
export const UpdateProjectAutoDevelopSchema = z.object({
  autoDevelop: z.boolean().optional(),
  visionContext: z.string().max(10000).optional(),
});
