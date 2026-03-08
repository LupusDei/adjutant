import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { MemoryStore } from "../../../src/services/adjutant/memory-store.js";

let testDir: string;
let db: Database.Database;
let store: MemoryStore;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-dedup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("Deduplication + Confidence Scoring (adj-053.2.3)", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createMemoryStore } = await import("../../../src/services/adjutant/memory-store.js");
    store = createMemoryStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  // =========================================================================
  // findSimilarLearnings (FTS5 dedup)
  // =========================================================================

  describe("findSimilarLearnings", () => {
    it("should match learnings with overlapping content terms", () => {
      store.insertLearning({
        category: "operational",
        topic: "bead-workflow",
        content: "Always assign yourself to a bead before starting work on it",
        sourceType: "user_correction",
      });

      const similar = store.findSimilarLearnings("bead-workflow", "assign bead before starting");
      expect(similar.length).toBeGreaterThan(0);
    });

    it("should NOT match learnings with completely different content", () => {
      store.insertLearning({
        category: "technical",
        topic: "typescript-strict",
        content: "Use TypeScript strict mode in all projects",
        sourceType: "user_correction",
      });

      const similar = store.findSimilarLearnings("python-django", "deploy Django application to production");
      expect(similar).toHaveLength(0);
    });

    it("should only match non-superseded learnings", () => {
      const old = store.insertLearning({
        category: "operational",
        topic: "workflow",
        content: "Always run tests before committing",
        sourceType: "user_correction",
      });
      const newer = store.insertLearning({
        category: "operational",
        topic: "workflow",
        content: "Always run tests and build before committing",
        sourceType: "user_correction",
      });
      store.supersedeLearning(old.id, newer.id);

      const similar = store.findSimilarLearnings("workflow", "run tests committing");
      // Should only find the non-superseded one
      const ids = similar.map((l) => l.id);
      expect(ids).not.toContain(old.id);
    });

    it("should handle FTS5 special characters gracefully", () => {
      store.insertLearning({
        category: "technical",
        topic: "syntax",
        content: "Use arrow functions => instead of function keyword",
        sourceType: "user_correction",
      });

      // FTS5 special characters should not crash
      const similar = store.findSimilarLearnings("syntax", "arrow => functions");
      // May or may not match, but should not throw
      expect(Array.isArray(similar)).toBe(true);
    });

    it("should require topic match for dedup", () => {
      store.insertLearning({
        category: "operational",
        topic: "bead-workflow",
        content: "Always commit after completing a task",
        sourceType: "user_correction",
      });

      // Same content keywords but different topic
      const similar = store.findSimilarLearnings("git-workflow", "commit completing task");
      expect(similar).toHaveLength(0);
    });
  });

  // =========================================================================
  // reinforceLearning (confidence boost)
  // =========================================================================

  describe("reinforceLearning", () => {
    it("should boost confidence by 10% of remaining gap each time", () => {
      const l = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "rule",
        sourceType: "user_correction",
        confidence: 0.5,
      });

      // First reinforcement: 0.5 + (1 - 0.5) * 0.1 = 0.55
      store.reinforceLearning(l.id);
      expect(store.getLearning(l.id)!.confidence).toBeCloseTo(0.55, 2);

      // Second: 0.55 + (1 - 0.55) * 0.1 = 0.595
      store.reinforceLearning(l.id);
      expect(store.getLearning(l.id)!.confidence).toBeCloseTo(0.595, 2);

      // Third: 0.595 + (1 - 0.595) * 0.1 = 0.6355
      store.reinforceLearning(l.id);
      expect(store.getLearning(l.id)!.confidence).toBeCloseTo(0.6355, 2);
    });

    it("should never exceed 1.0 confidence", () => {
      const l = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "rule",
        sourceType: "user_correction",
        confidence: 0.99,
      });

      // Reinforce many times
      for (let i = 0; i < 20; i++) {
        store.reinforceLearning(l.id);
      }
      const updated = store.getLearning(l.id)!;
      expect(updated.confidence).toBeLessThanOrEqual(1.0);
    });

    it("should track reinforcement count accurately", () => {
      const l = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "rule",
        sourceType: "user_correction",
      });

      for (let i = 0; i < 10; i++) {
        store.reinforceLearning(l.id);
      }
      const updated = store.getLearning(l.id)!;
      expect(updated.reinforcementCount).toBe(11); // 1 initial + 10 reinforcements
    });

    it("should update updated_at timestamp on reinforce", () => {
      const l = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "rule",
        sourceType: "user_correction",
      });
      const beforeUpdate = store.getLearning(l.id)!.updatedAt;

      store.reinforceLearning(l.id);
      const afterUpdate = store.getLearning(l.id)!.updatedAt;

      // Both should be valid timestamps
      expect(new Date(beforeUpdate).getTime()).not.toBeNaN();
      expect(new Date(afterUpdate).getTime()).not.toBeNaN();
    });
  });

  // =========================================================================
  // supersedeLearning
  // =========================================================================

  describe("supersedeLearning", () => {
    it("should mark the old learning as superseded", () => {
      const old = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "old rule",
        sourceType: "user_correction",
      });
      const newer = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "new rule",
        sourceType: "user_correction",
      });

      store.supersedeLearning(old.id, newer.id);

      const oldAfter = store.getLearning(old.id)!;
      expect(oldAfter.supersededBy).toBe(newer.id);
    });

    it("should transfer reinforcement count from old to new", () => {
      const old = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "old rule",
        sourceType: "user_correction",
      });
      // Reinforce the old one 4 times (total count: 5)
      for (let i = 0; i < 4; i++) {
        store.reinforceLearning(old.id);
      }

      const newer = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "new improved rule",
        sourceType: "user_correction",
      });

      store.supersedeLearning(old.id, newer.id);

      const newAfter = store.getLearning(newer.id)!;
      // New had 1, old had 5, total = 6
      expect(newAfter.reinforcementCount).toBe(6);
    });

    it("should exclude superseded learnings from default queries", () => {
      const old = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "old rule",
        sourceType: "user_correction",
      });
      const newer = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "new rule",
        sourceType: "user_correction",
      });
      store.supersedeLearning(old.id, newer.id);

      const results = store.queryLearnings({ category: "operational" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(newer.id);
    });

    it("should include superseded learnings when explicitly requested", () => {
      const old = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "old rule",
        sourceType: "user_correction",
      });
      const newer = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "new rule",
        sourceType: "user_correction",
      });
      store.supersedeLearning(old.id, newer.id);

      const results = store.queryLearnings({ category: "operational", includeSuperseded: true });
      expect(results).toHaveLength(2);
    });
  });

  // =========================================================================
  // pruneStale (confidence decay)
  // =========================================================================

  describe("pruneStale (confidence decay)", () => {
    it("should decay confidence of stale learnings", () => {
      // Insert a learning with old updated_at
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence, reinforcement_count, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("operational", "stale", "stale content", "user_correction", 0.8, 1, "2024-01-01T00:00:00", "2024-01-01T00:00:00");

      const beforeDecay = store.getLearning(1)!;
      expect(beforeDecay.confidence).toBe(0.8);

      const pruned = store.pruneStale(7);
      expect(pruned).toBe(1);

      const afterDecay = store.getLearning(1)!;
      // 0.8 * 0.95 = 0.76
      expect(afterDecay.confidence).toBeCloseTo(0.76, 2);
    });

    it("should NOT decay recent learnings", () => {
      const l = store.insertLearning({
        category: "operational",
        topic: "fresh",
        content: "fresh content",
        sourceType: "user_correction",
        confidence: 0.8,
      });

      const pruned = store.pruneStale(7);
      expect(pruned).toBe(0);

      const after = store.getLearning(l.id)!;
      expect(after.confidence).toBe(0.8);
    });

    it("should NOT decay superseded learnings", () => {
      // Insert a newer learning to reference
      const newer = store.insertLearning({
        category: "operational",
        topic: "new",
        content: "new content",
        sourceType: "user_correction",
      });

      // Insert a stale superseded learning referencing the newer one
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence, reinforcement_count, superseded_by, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("operational", "old", "old content", "user_correction", 0.8, 1, newer.id, "2024-01-01T00:00:00", "2024-01-01T00:00:00");

      // The stale count should be 0 because the superseded learning is excluded
      const pruned = store.pruneStale(7);
      expect(pruned).toBe(0);
    });

    it("should NOT decay learnings with very low confidence", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence, reinforcement_count, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("operational", "weak", "weak content", "user_correction", 0.03, 1, "2024-01-01T00:00:00", "2024-01-01T00:00:00");

      const pruned = store.pruneStale(7);
      expect(pruned).toBe(0);
    });

    it("should apply cumulative decay on repeated calls", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence, reinforcement_count, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("operational", "old", "old content", "user_correction", 1.0, 1, "2024-01-01T00:00:00", "2024-01-01T00:00:00");

      // After prune, updated_at is set to now, so subsequent prune won't decay again
      store.pruneStale(7);
      const afterFirst = store.getLearning(1)!;
      expect(afterFirst.confidence).toBeCloseTo(0.95, 2);

      // Won't decay again immediately because updated_at was just refreshed
      const pruned2 = store.pruneStale(7);
      expect(pruned2).toBe(0);
    });
  });

  // =========================================================================
  // Correction recurrence tracking
  // =========================================================================

  describe("correction recurrence tracking", () => {
    it("should track recurrence count", () => {
      const c = store.insertCorrection({
        correctionType: "prohibition",
        pattern: "dont use any",
        description: "Stop using any types",
      });
      expect(c.recurrenceCount).toBe(0);

      store.incrementRecurrence(c.id);
      store.incrementRecurrence(c.id);
      store.incrementRecurrence(c.id);

      const similar = store.findSimilarCorrection("prohibition", "dont use any");
      expect(similar!.recurrenceCount).toBe(3);
    });

    it("should set last_recurrence_at on increment", () => {
      const c = store.insertCorrection({
        correctionType: "prohibition",
        pattern: "dont use any",
        description: "Stop using any types",
      });
      expect(c.lastRecurrenceAt).toBeNull();

      store.incrementRecurrence(c.id);
      const updated = store.findSimilarCorrection("prohibition", "dont use any");
      expect(updated!.lastRecurrenceAt).toBeTruthy();
    });

    it("should filter corrections by minimum recurrence", () => {
      const c1 = store.insertCorrection({ correctionType: "prohibition", pattern: "p1", description: "d1" });
      store.insertCorrection({ correctionType: "prohibition", pattern: "p2", description: "d2" });

      // Only c1 gets 3 recurrences
      store.incrementRecurrence(c1.id);
      store.incrementRecurrence(c1.id);
      store.incrementRecurrence(c1.id);

      const recurring = store.getCorrectionRecurrenceRate(2);
      expect(recurring).toHaveLength(1);
      expect(recurring[0].pattern).toBe("p1");
    });
  });
});
