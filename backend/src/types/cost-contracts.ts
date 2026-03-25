/**
 * Shared Zod schemas for cost API response contracts.
 *
 * These schemas are the single source of truth for the shape of cost API
 * responses. Used by:
 * - Contract tests (validate actual HTTP responses)
 * - Frontend (import for type generation)
 * - iOS (export as JSON fixtures for Codable validation)
 *
 * @module types/cost-contracts
 */

import { z } from "zod";

// ============================================================================
// Primitives
// ============================================================================

/** Token breakdown — 4-category token counts used across all cost types. */
export const TokenBreakdownSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});

// ============================================================================
// API Response Envelope
// ============================================================================

/** Standard success wrapper used by all API endpoints. */
export function apiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
    timestamp: z.string(),
  });
}

/** Standard error wrapper used by all API endpoints. */
export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }),
  timestamp: z.string().optional(),
});

// ============================================================================
// Cost Entry (per-session)
// ============================================================================

export const CostEntrySchema = z.object({
  sessionId: z.string(),
  projectPath: z.string(),
  tokens: TokenBreakdownSchema,
  cost: z.number(),
  lastUpdated: z.string(),
  contextPercent: z.number().optional(),
  agentId: z.string().optional(),
  reconciliationStatus: z.enum(["estimated", "verified", "discrepancy"]).optional(),
  jsonlCost: z.number().optional(),
});

// ============================================================================
// Cost Summary (GET /api/costs)
// ============================================================================

export const ProjectCostSummarySchema = z.object({
  projectPath: z.string(),
  totalCost: z.number(),
  totalTokens: TokenBreakdownSchema,
  sessionCount: z.number(),
});

export const CostSummarySchema = z.object({
  totalCost: z.number(),
  totalTokens: TokenBreakdownSchema,
  sessions: z.record(z.string(), CostEntrySchema),
  projects: z.record(z.string(), ProjectCostSummarySchema),
});

// ============================================================================
// Burn Rate (GET /api/costs/burn-rate)
// ============================================================================

export const BurnRateSchema = z.object({
  rate10m: z.number(),
  rate1h: z.number(),
  trend: z.enum(["increasing", "stable", "decreasing"]),
});

// ============================================================================
// Budget (GET /api/costs/budget, POST /api/costs/budget)
// ============================================================================

export const BudgetRecordSchema = z.object({
  id: z.number(),
  scope: z.enum(["session", "project"]),
  scopeId: z.string().nullable(),
  budgetAmount: z.number(),
  warningPercent: z.number(),
  criticalPercent: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ============================================================================
// Bead Cost (GET /api/costs/by-bead/:id)
// ============================================================================

export const BeadCostSessionSchema = z.object({
  sessionId: z.string(),
  cost: z.number(),
  tokens: TokenBreakdownSchema,
});

export const BeadCostResultSchema = z.object({
  beadId: z.string(),
  totalCost: z.number(),
  sessions: z.array(BeadCostSessionSchema),
  tokenBreakdown: TokenBreakdownSchema,
});

// ============================================================================
// Reconciliation (GET /api/costs/reconcile)
// ============================================================================

export const ReconciliationResultSchema = z.object({
  sessionId: z.string(),
  statuslineCost: z.number(),
  jsonlCost: z.number(),
  difference: z.number(),
  percentDiff: z.number(),
  status: z.enum(["verified", "discrepancy"]),
});

// ============================================================================
// Threshold (GET/PUT /api/costs/threshold)
// ============================================================================

export const ThresholdResponseSchema = z.object({
  threshold: z.number(),
});

// ============================================================================
// Composed API response schemas (envelope + data)
// ============================================================================

export const CostSummaryResponseSchema = apiSuccessSchema(CostSummarySchema);
export const SessionCostResponseSchema = apiSuccessSchema(CostEntrySchema);
export const ProjectCostsResponseSchema = apiSuccessSchema(z.array(ProjectCostSummarySchema));
export const BurnRateResponseSchema = apiSuccessSchema(BurnRateSchema);
export const BudgetListResponseSchema = apiSuccessSchema(z.array(BudgetRecordSchema));
export const BudgetCreateResponseSchema = apiSuccessSchema(BudgetRecordSchema);
export const BudgetDeleteResponseSchema = apiSuccessSchema(z.object({ deleted: z.literal(true) }));
export const BeadCostResponseSchema = apiSuccessSchema(BeadCostResultSchema);
export const ReconcileAllResponseSchema = apiSuccessSchema(z.array(ReconciliationResultSchema));
export const ReconcileSessionResponseSchema = apiSuccessSchema(ReconciliationResultSchema);
export const ThresholdGetResponseSchema = apiSuccessSchema(ThresholdResponseSchema);
export const ThresholdPutResponseSchema = apiSuccessSchema(ThresholdResponseSchema);
