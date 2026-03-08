/**
 * Tests for REST memory routes (/api/memory/*).
 *
 * Bead: adj-053.4.3
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type {
  MemoryStore,
  Learning,
  Retrospective,
  Correction,
} from "../../src/services/adjutant/memory-store.js";

// ============================================================================
// Mock Helpers
// ============================================================================

function makeLearning(overrides: Partial<Learning> & { id: number }): Learning {
  return {
    id: overrides.id,
    category: overrides.category ?? "operational",
    topic: overrides.topic ?? "test-topic",
    content: overrides.content ?? "Test learning content",
    sourceType: overrides.sourceType ?? "user_correction",
    sourceRef: overrides.sourceRef ?? null,
    confidence: overrides.confidence ?? 0.5,
    reinforcementCount: overrides.reinforcementCount ?? 1,
    lastAppliedAt: overrides.lastAppliedAt ?? null,
    lastValidatedAt: overrides.lastValidatedAt ?? null,
    supersededBy: overrides.supersededBy ?? null,
    createdAt: overrides.createdAt ?? "2026-03-08T12:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-03-08T12:00:00Z",
  };
}

function makeRetrospective(overrides: Partial<Retrospective> & { id: number }): Retrospective {
  return {
    id: overrides.id,
    sessionDate: overrides.sessionDate ?? "2026-03-08",
    beadsClosed: overrides.beadsClosed ?? 5,
    beadsFailed: overrides.beadsFailed ?? 1,
    correctionsReceived: overrides.correctionsReceived ?? 2,
    agentsUsed: overrides.agentsUsed ?? 3,
    avgBeadTimeMins: overrides.avgBeadTimeMins ?? 30,
    wentWell: overrides.wentWell ?? '["Good test coverage"]',
    wentWrong: overrides.wentWrong ?? '["Build failures"]',
    actionItems: overrides.actionItems ?? '["Add more tests"]',
    metrics: overrides.metrics ?? null,
    createdAt: overrides.createdAt ?? "2026-03-08T23:00:00Z",
  };
}

function makeCorrection(overrides: Partial<Correction> & { id: number }): Correction {
  return {
    id: overrides.id,
    messageId: overrides.messageId ?? null,
    correctionType: overrides.correctionType ?? "behavioral",
    pattern: overrides.pattern ?? "don't do X",
    description: overrides.description ?? "Test correction",
    learningId: overrides.learningId ?? null,
    recurrenceCount: overrides.recurrenceCount ?? 0,
    lastRecurrenceAt: overrides.lastRecurrenceAt ?? null,
    resolved: overrides.resolved ?? false,
    createdAt: overrides.createdAt ?? "2026-03-08T12:00:00Z",
  };
}

function createMockMemoryStore(): MemoryStore {
  return {
    insertLearning: vi.fn(),
    getLearning: vi.fn(),
    updateLearning: vi.fn(),
    queryLearnings: vi.fn().mockReturnValue([]),
    searchLearnings: vi.fn().mockReturnValue([]),
    findSimilarLearnings: vi.fn().mockReturnValue([]),
    reinforceLearning: vi.fn(),
    supersedeLearning: vi.fn(),
    pruneStale: vi.fn().mockReturnValue(0),
    insertRetrospective: vi.fn(),
    getRecentRetrospectives: vi.fn().mockReturnValue([]),
    insertCorrection: vi.fn(),
    findSimilarCorrection: vi.fn(),
    incrementRecurrence: vi.fn(),
    getUnresolvedCorrections: vi.fn().mockReturnValue([]),
    getTopicFrequency: vi.fn().mockReturnValue([]),
    getCorrectionRecurrenceRate: vi.fn().mockReturnValue([]),
    getLearningEffectiveness: vi.fn().mockReturnValue([]),
  };
}

// ============================================================================
// Test Setup
// ============================================================================

let mockStore: MemoryStore;
let app: express.Express;

async function setupApp(store: MemoryStore) {
  const { createMemoryRouter } = await import("../../src/routes/memory.js");
  const testApp = express();
  testApp.use(express.json());
  testApp.use("/api/memory", createMemoryRouter(store));
  return testApp;
}

// ============================================================================
// Tests
// ============================================================================

describe("Memory Routes", () => {
  beforeEach(async () => {
    mockStore = createMockMemoryStore();
    app = await setupApp(mockStore);
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/learnings
  // --------------------------------------------------------------------------

  describe("GET /api/memory/learnings", () => {
    it("should return learnings list with default params", async () => {
      const learnings = [
        makeLearning({ id: 1, category: "operational", topic: "worktree" }),
        makeLearning({ id: 2, category: "technical", topic: "build" }),
      ];
      vi.mocked(mockStore.queryLearnings).mockReturnValue(learnings);

      const res = await request(app).get("/api/memory/learnings");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(2);
      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    it("should filter by category", async () => {
      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const res = await request(app).get("/api/memory/learnings?category=operational");

      expect(res.status).toBe(200);
      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ category: "operational" }),
      );
    });

    it("should filter by topic", async () => {
      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const res = await request(app).get("/api/memory/learnings?topic=worktree");

      expect(res.status).toBe(200);
      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "worktree" }),
      );
    });

    it("should filter by minConfidence", async () => {
      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const res = await request(app).get("/api/memory/learnings?minConfidence=0.7");

      expect(res.status).toBe(200);
      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ minConfidence: 0.7 }),
      );
    });

    it("should respect limit parameter", async () => {
      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const res = await request(app).get("/api/memory/learnings?limit=10");

      expect(res.status).toBe(200);
      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });

    it("should clamp limit to max 200", async () => {
      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const res = await request(app).get("/api/memory/learnings?limit=500");

      expect(res.status).toBe(200);
      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200 }),
      );
    });

    it("should reject invalid category", async () => {
      const res = await request(app).get("/api/memory/learnings?category=invalid");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/learnings/search
  // --------------------------------------------------------------------------

  describe("GET /api/memory/learnings/search", () => {
    it("should search learnings by FTS query", async () => {
      const learnings = [
        makeLearning({ id: 1, content: "worktree isolation is critical" }),
      ];
      vi.mocked(mockStore.searchLearnings).mockReturnValue(learnings);

      const res = await request(app).get("/api/memory/learnings/search?q=worktree");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(mockStore.searchLearnings).toHaveBeenCalledWith("worktree", 50);
    });

    it("should return 400 when q param is missing", async () => {
      const res = await request(app).get("/api/memory/learnings/search");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should respect limit param in search", async () => {
      vi.mocked(mockStore.searchLearnings).mockReturnValue([]);

      const res = await request(app).get("/api/memory/learnings/search?q=test&limit=5");

      expect(res.status).toBe(200);
      expect(mockStore.searchLearnings).toHaveBeenCalledWith("test", 5);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/retrospectives
  // --------------------------------------------------------------------------

  describe("GET /api/memory/retrospectives", () => {
    it("should return recent retrospectives with default limit", async () => {
      const retros = [
        makeRetrospective({ id: 1, sessionDate: "2026-03-08" }),
      ];
      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue(retros);

      const res = await request(app).get("/api/memory/retrospectives");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(mockStore.getRecentRetrospectives).toHaveBeenCalledWith(20);
    });

    it("should respect limit param", async () => {
      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue([]);

      const res = await request(app).get("/api/memory/retrospectives?limit=5");

      expect(res.status).toBe(200);
      expect(mockStore.getRecentRetrospectives).toHaveBeenCalledWith(5);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/corrections
  // --------------------------------------------------------------------------

  describe("GET /api/memory/corrections", () => {
    it("should return unresolved corrections", async () => {
      const corrections = [
        makeCorrection({ id: 1, pattern: "don't use any", resolved: false }),
      ];
      vi.mocked(mockStore.getUnresolvedCorrections).mockReturnValue(corrections);

      const res = await request(app).get("/api/memory/corrections");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/memory/stats
  // --------------------------------------------------------------------------

  describe("GET /api/memory/stats", () => {
    it("should return aggregate memory stats", async () => {
      const learnings = [
        makeLearning({ id: 1, confidence: 0.8, category: "operational" }),
        makeLearning({ id: 2, confidence: 0.5, category: "technical" }),
      ];
      vi.mocked(mockStore.queryLearnings).mockReturnValue(learnings);
      vi.mocked(mockStore.getTopicFrequency).mockReturnValue([
        { topic: "worktree", count: 8 },
        { topic: "bead-assignment", count: 5 },
      ]);
      vi.mocked(mockStore.getUnresolvedCorrections).mockReturnValue([
        makeCorrection({ id: 1 }),
      ]);
      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue([
        makeRetrospective({ id: 1 }),
        makeRetrospective({ id: 2 }),
      ]);

      const res = await request(app).get("/api/memory/stats");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalLearnings).toBe(2);
      expect(res.body.data.totalRetrospectives).toBe(2);
      expect(res.body.data.totalCorrections).toBe(1);
      expect(res.body.data.avgConfidence).toBe(0.65);
      expect(res.body.data.topTopics).toHaveLength(2);
      expect(res.body.data.categoryCounts.operational).toBe(1);
      expect(res.body.data.categoryCounts.technical).toBe(1);
    });
  });
});
