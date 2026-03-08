/**
 * REST routes for memory management (dashboard views).
 *
 * Provides HTTP endpoints for the frontend to interact with the
 * Adjutant's persistent memory system.
 *
 * Endpoints:
 * - GET /api/memory/learnings          - List learnings (query: category, topic, minConfidence, limit)
 * - GET /api/memory/learnings/search   - FTS search (query: q, limit)
 * - GET /api/memory/retrospectives     - List retros (query: limit)
 * - GET /api/memory/corrections        - List unresolved corrections
 * - GET /api/memory/stats              - Aggregate stats
 *
 * Bead: adj-053.4.3
 */

import { Router } from "express";
import { z } from "zod";
import type { MemoryStore, LearningQuery } from "../services/adjutant/memory-store.js";
import { success, validationError, badRequest } from "../utils/responses.js";

// ============================================================================
// Query Parameter Schemas
// ============================================================================

const LearningsQuerySchema = z.object({
  category: z
    .enum(["operational", "technical", "coordination", "project"])
    .optional(),
  topic: z.string().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .transform((v) => (v !== undefined ? Math.min(v, 200) : v)),
});

const SearchQuerySchema = z.object({
  q: z.string().min(1, "Search query is required"),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const RetroQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ============================================================================
// Router Factory
// ============================================================================

/**
 * Create a memory router bound to the given MemoryStore.
 * This factory pattern lets tests inject a test-scoped store.
 */
export function createMemoryRouter(store: MemoryStore): Router {
  const router = Router();

  // --------------------------------------------------------------------------
  // GET /api/memory/learnings/search — must come before /:id-style routes
  // --------------------------------------------------------------------------
  router.get("/learnings/search", (req, res) => {
    const parseResult = SearchQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      return res
        .status(400)
        .json(badRequest(firstIssue?.message ?? "Invalid search query"));
    }

    const { q, limit } = parseResult.data;
    const effectiveLimit = limit ?? 50;
    const items = store.searchLearnings(q, effectiveLimit);

    return res.json(success({ items, total: items.length }));
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/learnings
  // --------------------------------------------------------------------------
  router.get("/learnings", (req, res) => {
    const parseResult = LearningsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      return res
        .status(400)
        .json(validationError(firstIssue?.message ?? "Invalid query parameters"));
    }

    const { category, topic, minConfidence, limit } = parseResult.data;
    const effectiveLimit = limit ?? 50;

    // Build query object without undefined values to satisfy exactOptionalPropertyTypes
    const query: LearningQuery = { limit: effectiveLimit };
    if (category !== undefined) query.category = category;
    if (topic !== undefined) query.topic = topic;
    if (minConfidence !== undefined) query.minConfidence = minConfidence;

    const items = store.queryLearnings(query);

    return res.json(
      success({
        items,
        total: items.length,
        hasMore: items.length === effectiveLimit,
      }),
    );
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/retrospectives
  // --------------------------------------------------------------------------
  router.get("/retrospectives", (req, res) => {
    const parseResult = RetroQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      return res
        .status(400)
        .json(validationError(firstIssue?.message ?? "Invalid query parameters"));
    }

    const { limit } = parseResult.data;
    const effectiveLimit = limit ?? 20;
    const items = store.getRecentRetrospectives(effectiveLimit);

    return res.json(success({ items, total: items.length }));
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/corrections
  // --------------------------------------------------------------------------
  router.get("/corrections", (_req, res) => {
    const items = store.getUnresolvedCorrections();
    return res.json(success({ items, total: items.length }));
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/stats
  // --------------------------------------------------------------------------
  router.get("/stats", (_req, res) => {
    // Compute stats from available store methods
    const allLearnings = store.queryLearnings({ limit: 1000 });
    const topicFreq = store.getTopicFrequency();
    const corrections = store.getUnresolvedCorrections();
    const retros = store.getRecentRetrospectives(100);

    const avgConfidence =
      allLearnings.length > 0
        ? allLearnings.reduce((sum, l) => sum + l.confidence, 0) / allLearnings.length
        : 0;

    // Count by category
    const categoryCounts: Record<string, number> = {};
    for (const l of allLearnings) {
      categoryCounts[l.category] = (categoryCounts[l.category] ?? 0) + 1;
    }

    return res.json(
      success({
        totalLearnings: allLearnings.length,
        totalRetrospectives: retros.length,
        totalCorrections: corrections.length,
        unresolvedCorrections: corrections.length,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        topTopics: topicFreq.slice(0, 10),
        categoryCounts,
      }),
    );
  });

  return router;
}
