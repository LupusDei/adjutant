/**
 * Confidence scoring engine for auto-develop proposals.
 *
 * Computes weighted confidence scores from individual signal scores
 * and classifies them into action categories (accept/refine/escalate/dismiss).
 */

import type {
  ConfidenceSignals,
  ConfidenceClassification,
} from "../types/auto-develop.js";
import {
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_THRESHOLDS,
} from "../types/auto-develop.js";
import type { ProposalStore } from "./proposal-store.js";

/**
 * Compute a weighted confidence score from individual signal scores.
 * Each signal is 0-100, weights sum to 1.0.
 * Returns a composite score 0-100 (rounded to nearest integer).
 */
export function computeConfidenceScore(signals: ConfidenceSignals): number {
  const keys = Object.keys(CONFIDENCE_WEIGHTS) as (keyof ConfidenceSignals)[];
  let weightedSum = 0;
  for (const key of keys) {
    // Guard against NaN/Infinity — treat as 0 (adj-122.10.4)
    const value = Number.isFinite(signals[key]) ? signals[key] : 0;
    weightedSum += value * CONFIDENCE_WEIGHTS[key];
  }
  // Clamp to 0-100 and round
  return Math.round(Math.min(100, Math.max(0, weightedSum)));
}

/**
 * Classify a confidence score into an action category.
 * 80-100: accept, 60-79: refine, 40-59: escalate, 0-39: dismiss
 */
export function classifyConfidence(score: number): ConfidenceClassification {
  if (score >= CONFIDENCE_THRESHOLDS.accept) return "accept";
  if (score >= CONFIDENCE_THRESHOLDS.refine) return "refine";
  if (score >= CONFIDENCE_THRESHOLDS.escalate) return "escalate";
  return "dismiss";
}

/**
 * Look up historical success rate for similar proposals.
 * Queries completed proposals in the same project of the same type.
 * Returns a score 0-100 based on acceptance rate.
 * If no historical data exists, returns 50 (neutral).
 */
export function getHistoricalSuccessRate(
  proposalStore: ProposalStore,
  project: string | string[],
  proposalType: "product" | "engineering",
): number {
  const proposals = proposalStore.getProposals({
    project,
    type: proposalType,
  });

  if (proposals.length === 0) return 50;

  // Count accepted/completed vs dismissed
  const successStatuses = new Set(["accepted", "completed"]);
  const failureStatuses = new Set(["dismissed"]);

  let successes = 0;
  let failures = 0;

  for (const p of proposals) {
    if (successStatuses.has(p.status)) successes++;
    else if (failureStatuses.has(p.status)) failures++;
    // pending proposals are excluded from the calculation
  }

  const total = successes + failures;
  if (total === 0) return 50; // No resolved proposals yet

  return Math.round((successes / total) * 100);
}
