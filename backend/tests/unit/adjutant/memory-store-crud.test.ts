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
  const dir = join(tmpdir(), `adjutant-memcrud-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("MemoryStore", () => {
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
  // Learnings CRUD
  // =========================================================================

  describe("insertLearning", () => {
    it("should insert a learning and return it with id", () => {
      const learning = store.insertLearning({
        category: "operational",
        topic: "bead-workflow",
        content: "Always assign yourself before starting work",
        sourceType: "user_correction",
      });
      expect(learning.id).toBe(1);
      expect(learning.category).toBe("operational");
      expect(learning.topic).toBe("bead-workflow");
      expect(learning.content).toBe("Always assign yourself before starting work");
      expect(learning.sourceType).toBe("user_correction");
      expect(learning.confidence).toBe(0.5);
      expect(learning.reinforcementCount).toBe(1);
      expect(learning.createdAt).toBeTruthy();
      expect(learning.updatedAt).toBeTruthy();
    });

    it("should accept optional fields", () => {
      const learning = store.insertLearning({
        category: "technical",
        topic: "typescript",
        content: "Use strict mode",
        sourceType: "observation",
        sourceRef: "adj-053",
        confidence: 0.8,
      });
      expect(learning.sourceRef).toBe("adj-053");
      expect(learning.confidence).toBe(0.8);
    });
  });

  describe("getLearning", () => {
    it("should return null for nonexistent learning", () => {
      expect(store.getLearning(999)).toBeNull();
    });

    it("should return a learning by id", () => {
      const inserted = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "test content",
        sourceType: "user_correction",
      });
      const fetched = store.getLearning(inserted.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(inserted.id);
      expect(fetched!.content).toBe("test content");
    });
  });

  describe("updateLearning", () => {
    it("should update specified fields", () => {
      const inserted = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "original",
        sourceType: "user_correction",
      });
      store.updateLearning(inserted.id, { content: "updated content", confidence: 0.9 });
      const fetched = store.getLearning(inserted.id);
      expect(fetched!.content).toBe("updated content");
      expect(fetched!.confidence).toBe(0.9);
      // Unchanged fields preserved
      expect(fetched!.category).toBe("operational");
    });
  });

  describe("queryLearnings", () => {
    it("should filter by category", () => {
      store.insertLearning({ category: "operational", topic: "t1", content: "c1", sourceType: "user_correction" });
      store.insertLearning({ category: "technical", topic: "t2", content: "c2", sourceType: "observation" });
      store.insertLearning({ category: "operational", topic: "t3", content: "c3", sourceType: "user_correction" });

      const results = store.queryLearnings({ category: "operational" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.category === "operational")).toBe(true);
    });

    it("should filter by topic", () => {
      store.insertLearning({ category: "operational", topic: "typescript", content: "c1", sourceType: "user_correction" });
      store.insertLearning({ category: "operational", topic: "python", content: "c2", sourceType: "user_correction" });

      const results = store.queryLearnings({ topic: "typescript" });
      expect(results).toHaveLength(1);
      expect(results[0].topic).toBe("typescript");
    });

    it("should filter by minConfidence", () => {
      store.insertLearning({ category: "operational", topic: "t1", content: "c1", sourceType: "user_correction", confidence: 0.3 });
      store.insertLearning({ category: "operational", topic: "t2", content: "c2", sourceType: "user_correction", confidence: 0.7 });
      store.insertLearning({ category: "operational", topic: "t3", content: "c3", sourceType: "user_correction", confidence: 0.9 });

      const results = store.queryLearnings({ minConfidence: 0.6 });
      expect(results).toHaveLength(2);
    });

    it("should exclude superseded learnings by default", () => {
      const l1 = store.insertLearning({ category: "operational", topic: "t1", content: "old", sourceType: "user_correction" });
      store.insertLearning({ category: "operational", topic: "t1", content: "new", sourceType: "user_correction" });
      store.supersedeLearning(l1.id, 2);

      const results = store.queryLearnings({ category: "operational" });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("new");
    });

    it("should include superseded when requested", () => {
      const l1 = store.insertLearning({ category: "operational", topic: "t1", content: "old", sourceType: "user_correction" });
      store.insertLearning({ category: "operational", topic: "t1", content: "new", sourceType: "user_correction" });
      store.supersedeLearning(l1.id, 2);

      const results = store.queryLearnings({ category: "operational", includeSuperseded: true });
      expect(results).toHaveLength(2);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        store.insertLearning({ category: "operational", topic: "t", content: `c${i}`, sourceType: "user_correction" });
      }
      const results = store.queryLearnings({ limit: 3 });
      expect(results).toHaveLength(3);
    });
  });

  describe("searchLearnings", () => {
    it("should find learnings by FTS5 match", () => {
      store.insertLearning({ category: "technical", topic: "typescript", content: "Always use strict mode in TypeScript projects", sourceType: "user_correction" });
      store.insertLearning({ category: "operational", topic: "workflow", content: "Assign beads before starting work", sourceType: "user_correction" });

      const results = store.searchLearnings("strict mode");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("strict mode");
    });

    it("should return empty array for no matches", () => {
      store.insertLearning({ category: "technical", topic: "typescript", content: "Use strict mode", sourceType: "user_correction" });

      const results = store.searchLearnings("python django");
      expect(results).toHaveLength(0);
    });
  });

  describe("reinforceLearning", () => {
    it("should increment reinforcement_count and boost confidence by 10%", () => {
      const learning = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "important rule",
        sourceType: "user_correction",
        confidence: 0.5,
      });

      store.reinforceLearning(learning.id);
      const updated = store.getLearning(learning.id);
      expect(updated!.reinforcementCount).toBe(2);
      // 0.5 + (1 - 0.5) * 0.1 = 0.55
      expect(updated!.confidence).toBeCloseTo(0.55, 2);
    });

    it("should cap confidence at 1.0", () => {
      const learning = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "rule",
        sourceType: "user_correction",
        confidence: 0.98,
      });

      store.reinforceLearning(learning.id);
      const updated = store.getLearning(learning.id);
      expect(updated!.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe("supersedeLearning", () => {
    it("should mark old learning as superseded and transfer reinforcement", () => {
      const old = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "old rule",
        sourceType: "user_correction",
      });
      // Reinforce the old one a few times
      store.reinforceLearning(old.id);
      store.reinforceLearning(old.id);
      const oldBefore = store.getLearning(old.id)!;
      expect(oldBefore.reinforcementCount).toBe(3);

      const newer = store.insertLearning({
        category: "operational",
        topic: "test",
        content: "new rule",
        sourceType: "user_correction",
      });

      store.supersedeLearning(old.id, newer.id);

      const oldAfter = store.getLearning(old.id)!;
      expect(oldAfter.supersededBy).toBe(newer.id);

      const newAfter = store.getLearning(newer.id)!;
      // Transfer: new.reinforcement += old.reinforcement
      expect(newAfter.reinforcementCount).toBe(4); // 1 (original) + 3 (from old)
    });
  });

  describe("pruneStale", () => {
    it("should apply confidence decay to stale learnings", () => {
      // Insert a learning with old updated_at via raw SQL
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence, reinforcement_count, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("operational", "stale-topic", "stale content", "user_correction", 0.8, 1, "2025-01-01T00:00:00", "2025-01-01T00:00:00");

      // Insert a recent learning
      store.insertLearning({
        category: "operational",
        topic: "recent-topic",
        content: "recent content",
        sourceType: "user_correction",
        confidence: 0.8,
      });

      const pruned = store.pruneStale(7); // 7 days threshold
      expect(pruned).toBeGreaterThan(0);

      // The stale one should have decayed confidence
      const stale = store.getLearning(1);
      expect(stale!.confidence).toBeLessThan(0.8);
    });
  });

  // =========================================================================
  // Retrospectives
  // =========================================================================

  describe("insertRetrospective", () => {
    it("should insert a retrospective and return it with id", () => {
      const retro = store.insertRetrospective({
        sessionDate: "2026-03-08",
        beadsClosed: 5,
        beadsFailed: 1,
        correctionsReceived: 2,
        agentsUsed: 3,
        wentWell: "Good collaboration",
        wentWrong: "Some agents stalled",
        actionItems: "Improve monitoring",
      });
      expect(retro.id).toBe(1);
      expect(retro.sessionDate).toBe("2026-03-08");
      expect(retro.beadsClosed).toBe(5);
      expect(retro.beadsFailed).toBe(1);
      expect(retro.correctionsReceived).toBe(2);
      expect(retro.agentsUsed).toBe(3);
    });
  });

  describe("getRecentRetrospectives", () => {
    it("should return retrospectives in reverse chronological order", () => {
      store.insertRetrospective({ sessionDate: "2026-03-06" });
      store.insertRetrospective({ sessionDate: "2026-03-07" });
      store.insertRetrospective({ sessionDate: "2026-03-08" });

      const retros = store.getRecentRetrospectives(2);
      expect(retros).toHaveLength(2);
      expect(retros[0].sessionDate).toBe("2026-03-08");
      expect(retros[1].sessionDate).toBe("2026-03-07");
    });
  });

  // =========================================================================
  // Corrections
  // =========================================================================

  describe("insertCorrection", () => {
    it("should insert a correction and return it", () => {
      const correction = store.insertCorrection({
        correctionType: "prohibition",
        pattern: "dont use any",
        description: "Stop using any types",
      });
      expect(correction.id).toBe(1);
      expect(correction.correctionType).toBe("prohibition");
      expect(correction.recurrenceCount).toBe(0);
      expect(correction.resolved).toBe(false);
    });

    it("should accept optional learning_id and message_id", () => {
      const learning = store.insertLearning({
        category: "technical",
        topic: "types",
        content: "No any types",
        sourceType: "user_correction",
      });
      const correction = store.insertCorrection({
        correctionType: "prohibition",
        pattern: "dont use any",
        description: "Stop using any types",
        learningId: learning.id,
        messageId: "msg-123",
      });
      expect(correction.learningId).toBe(learning.id);
      expect(correction.messageId).toBe("msg-123");
    });
  });

  describe("findSimilarCorrection", () => {
    it("should find an existing correction with same pattern", () => {
      store.insertCorrection({
        correctionType: "prohibition",
        pattern: "dont use any",
        description: "Stop using any types",
      });

      const similar = store.findSimilarCorrection("prohibition", "dont use any");
      expect(similar).not.toBeNull();
      expect(similar!.pattern).toBe("dont use any");
    });

    it("should return null when no match exists", () => {
      const similar = store.findSimilarCorrection("prohibition", "nonexistent pattern");
      expect(similar).toBeNull();
    });
  });

  describe("incrementRecurrence", () => {
    it("should increment recurrence count and set last_recurrence_at", () => {
      const correction = store.insertCorrection({
        correctionType: "prohibition",
        pattern: "dont use any",
        description: "Stop using any types",
      });

      store.incrementRecurrence(correction.id);
      const updated = store.findSimilarCorrection("prohibition", "dont use any");
      expect(updated!.recurrenceCount).toBe(1);
      expect(updated!.lastRecurrenceAt).toBeTruthy();
    });
  });

  describe("getUnresolvedCorrections", () => {
    it("should return only unresolved corrections", () => {
      store.insertCorrection({ correctionType: "prohibition", pattern: "p1", description: "d1" });
      store.insertCorrection({ correctionType: "mandate", pattern: "p2", description: "d2" });
      // Resolve one
      db.prepare("UPDATE adjutant_corrections SET resolved = 1 WHERE id = 1").run();

      const unresolved = store.getUnresolvedCorrections();
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].pattern).toBe("p2");
    });
  });

  // =========================================================================
  // Analytics
  // =========================================================================

  describe("getTopicFrequency", () => {
    it("should return topic counts sorted by frequency", () => {
      store.insertLearning({ category: "operational", topic: "workflow", content: "c1", sourceType: "user_correction" });
      store.insertLearning({ category: "operational", topic: "workflow", content: "c2", sourceType: "user_correction" });
      store.insertLearning({ category: "operational", topic: "workflow", content: "c3", sourceType: "user_correction" });
      store.insertLearning({ category: "technical", topic: "typescript", content: "c4", sourceType: "user_correction" });

      const freq = store.getTopicFrequency();
      expect(freq.length).toBeGreaterThanOrEqual(2);
      expect(freq[0].topic).toBe("workflow");
      expect(freq[0].count).toBe(3);
    });
  });

  describe("getCorrectionRecurrenceRate", () => {
    it("should return corrections with high recurrence", () => {
      const c1 = store.insertCorrection({ correctionType: "prohibition", pattern: "p1", description: "d1" });
      store.insertCorrection({ correctionType: "mandate", pattern: "p2", description: "d2" });
      // Increment recurrence multiple times
      store.incrementRecurrence(c1.id);
      store.incrementRecurrence(c1.id);
      store.incrementRecurrence(c1.id);

      const recurring = store.getCorrectionRecurrenceRate(2);
      expect(recurring).toHaveLength(1);
      expect(recurring[0].pattern).toBe("p1");
      expect(recurring[0].recurrenceCount).toBe(3);
    });
  });

  describe("getLearningEffectiveness", () => {
    it("should return learnings sorted by reinforcement and confidence", () => {
      const l1 = store.insertLearning({ category: "operational", topic: "t1", content: "c1", sourceType: "user_correction", confidence: 0.5 });
      const l2 = store.insertLearning({ category: "operational", topic: "t2", content: "c2", sourceType: "user_correction", confidence: 0.9 });
      store.reinforceLearning(l2.id);
      store.reinforceLearning(l2.id);

      const effective = store.getLearningEffectiveness(10);
      expect(effective).toHaveLength(2);
      // l2 should be first (higher confidence and reinforcement)
      expect(effective[0].id).toBe(l2.id);
    });
  });

  // =========================================================================
  // findSimilarLearnings (dedup helper)
  // =========================================================================

  describe("findSimilarLearnings", () => {
    it("should find learnings matching topic and FTS content", () => {
      store.insertLearning({
        category: "operational",
        topic: "bead-workflow",
        content: "Always assign yourself to a bead before starting work",
        sourceType: "user_correction",
      });

      // Use a phrase that appears contiguously in the content (FTS5 phrase match)
      const similar = store.findSimilarLearnings("bead-workflow", "assign yourself");
      expect(similar.length).toBeGreaterThan(0);
    });

    it("should return empty array when no similar learnings exist", () => {
      store.insertLearning({
        category: "operational",
        topic: "bead-workflow",
        content: "Always assign yourself to a bead before starting work",
        sourceType: "user_correction",
      });

      const similar = store.findSimilarLearnings("completely-different", "unrelated content about python");
      expect(similar).toHaveLength(0);
    });

    it("should sanitize FTS5 special characters in contentQuery (adj-adqi)", () => {
      store.insertLearning({
        category: "operational",
        topic: "bead-workflow",
        content: "Always assign yourself to a bead before starting work",
        sourceType: "user_correction",
      });

      // These FTS5 special characters should not cause errors
      const malicious = 'test OR DROP TABLE --';
      const result = store.findSimilarLearnings("bead-workflow", malicious);
      // Should not throw, just return results (possibly empty)
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle FTS5 operators in contentQuery without injection (adj-adqi)", () => {
      store.insertLearning({
        category: "operational",
        topic: "test-topic",
        content: "Important content about testing",
        sourceType: "user_correction",
      });

      // FTS5 operator characters that should be escaped
      const queries = [
        'test" OR "1"="1',
        "NOT something",
        "col1:value",
        "test*",
        "{near}",
        "test AND drop",
      ];

      for (const q of queries) {
        const result = store.findSimilarLearnings("test-topic", q);
        expect(Array.isArray(result)).toBe(true);
      }
    });
  });

  // =========================================================================
  // FTS5 Sanitization (adj-adqi)
  // =========================================================================

  describe("searchLearnings FTS5 sanitization", () => {
    it("should sanitize FTS5 special characters in search queries (adj-adqi)", () => {
      store.insertLearning({
        category: "technical",
        topic: "typescript",
        content: "Always use strict mode in TypeScript projects",
        sourceType: "user_correction",
      });

      // FTS5 special operators should not cause injection
      const malicious = 'strict" OR "1"="1';
      const result = store.searchLearnings(malicious);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle empty and whitespace-only queries gracefully (adj-adqi)", () => {
      store.insertLearning({
        category: "technical",
        topic: "test",
        content: "test content",
        sourceType: "user_correction",
      });

      const result1 = store.searchLearnings("");
      expect(Array.isArray(result1)).toBe(true);

      const result2 = store.searchLearnings("   ");
      expect(Array.isArray(result2)).toBe(true);
    });

    it("should find results with sanitized queries (adj-adqi)", () => {
      store.insertLearning({
        category: "technical",
        topic: "typescript",
        content: "Always use strict mode in TypeScript projects",
        sourceType: "user_correction",
      });

      // Normal query should still work after sanitization
      const result = store.searchLearnings("strict mode");
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].content).toContain("strict mode");
    });
  });

  // =========================================================================
  // queryLearnings LIMIT parameterization (adj-7i2s)
  // =========================================================================

  describe("queryLearnings LIMIT parameterization", () => {
    it("should use parameterized LIMIT instead of string interpolation (adj-7i2s)", () => {
      for (let i = 0; i < 5; i++) {
        store.insertLearning({ category: "operational", topic: "t", content: `content ${i}`, sourceType: "user_correction" });
      }

      // This should work safely with parameterized query
      const results = store.queryLearnings({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it("should handle limit of 0 (adj-7i2s)", () => {
      store.insertLearning({ category: "operational", topic: "t", content: "content", sourceType: "user_correction" });
      const results = store.queryLearnings({ limit: 0 });
      expect(results).toHaveLength(0);
    });
  });

  // =========================================================================
  // pruneStale deletion (adj-o8v6)
  // =========================================================================

  describe("pruneStale deletion", () => {
    it("should delete learnings with confidence below deletion threshold (adj-o8v6)", () => {
      // Insert a stale learning with very low confidence via raw SQL
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence, reinforcement_count, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("operational", "very-stale", "very stale content", "user_correction", 0.05, 1, "2024-01-01T00:00:00", "2024-01-01T00:00:00");

      const staleBeforePrune = store.getLearning(1);
      expect(staleBeforePrune).not.toBeNull();
      expect(staleBeforePrune!.confidence).toBe(0.05);

      store.pruneStale(7);

      // Very low confidence learning should be deleted
      const staleAfterPrune = store.getLearning(1);
      expect(staleAfterPrune).toBeNull();
    });

    it("should decay confidence of moderately stale learnings without deleting (adj-o8v6)", () => {
      // Insert a stale learning with moderate confidence
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence, reinforcement_count, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("operational", "moderate-stale", "moderate stale", "user_correction", 0.5, 1, "2024-01-01T00:00:00", "2024-01-01T00:00:00");

      store.pruneStale(7);

      // Should still exist but with decayed confidence
      const after = store.getLearning(1);
      expect(after).not.toBeNull();
      expect(after!.confidence).toBeLessThan(0.5);
    });
  });

  // =========================================================================
  // Circular supersede detection (adj-c7ao)
  // =========================================================================

  describe("supersedeLearning circular detection", () => {
    it("should throw when creating a circular supersede chain (adj-c7ao)", () => {
      const l1 = store.insertLearning({ category: "operational", topic: "t1", content: "old rule", sourceType: "user_correction" });
      const l2 = store.insertLearning({ category: "operational", topic: "t1", content: "new rule", sourceType: "user_correction" });

      // l1 superseded by l2
      store.supersedeLearning(l1.id, l2.id);

      // Trying to supersede l2 by l1 should throw (circular)
      expect(() => store.supersedeLearning(l2.id, l1.id)).toThrow(/circular/i);
    });

    it("should throw on longer circular supersede chains (adj-c7ao)", () => {
      const l1 = store.insertLearning({ category: "operational", topic: "t1", content: "v1", sourceType: "user_correction" });
      const l2 = store.insertLearning({ category: "operational", topic: "t1", content: "v2", sourceType: "user_correction" });
      const l3 = store.insertLearning({ category: "operational", topic: "t1", content: "v3", sourceType: "user_correction" });

      // l1 -> l2 -> l3
      store.supersedeLearning(l1.id, l2.id);
      store.supersedeLearning(l2.id, l3.id);

      // Trying to supersede l3 by l1 should throw (l1 -> l2 -> l3 -> l1)
      expect(() => store.supersedeLearning(l3.id, l1.id)).toThrow(/circular/i);
    });

    it("should allow valid non-circular supersede (adj-c7ao)", () => {
      const l1 = store.insertLearning({ category: "operational", topic: "t1", content: "v1", sourceType: "user_correction" });
      const l2 = store.insertLearning({ category: "operational", topic: "t1", content: "v2", sourceType: "user_correction" });
      const l3 = store.insertLearning({ category: "operational", topic: "t1", content: "v3", sourceType: "user_correction" });

      // l1 -> l2, then l2 -> l3 — no cycle
      store.supersedeLearning(l1.id, l2.id);
      expect(() => store.supersedeLearning(l2.id, l3.id)).not.toThrow();
    });
  });
});
