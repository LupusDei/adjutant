import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { MemoryStore } from "../../../src/services/adjutant/memory-store.js";

let testDir: string;
let memoryDir: string;
let memoryMdPath: string;
let db: Database.Database;
let store: MemoryStore;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-filesync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

/**
 * Insert a learning with specific confidence and reinforcement count.
 * Reinforcement count is set by calling reinforceLearning N-1 times
 * (insertLearning starts with reinforcement_count = 1).
 */
function insertHighConfidenceLearning(
  topic: string,
  content: string,
  confidence: number,
  reinforcementCount: number,
): void {
  const l = store.insertLearning({
    category: "operational",
    topic,
    content,
    sourceType: "user_correction",
    confidence,
  });
  // insertLearning starts with reinforcement_count=1, we want `reinforcementCount` total
  // But reinforceLearning also changes confidence, so we set confidence directly after
  for (let i = 1; i < reinforcementCount; i++) {
    store.reinforceLearning(l.id);
  }
  // Override confidence to exact value for test predictability
  store.updateLearning(l.id, { confidence });
}

describe("Memory File Sync (adj-053.5.2)", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    memoryDir = join(testDir, "memory");
    memoryMdPath = join(memoryDir, "MEMORY.md");
    mkdirSync(memoryDir, { recursive: true });
    db = await setupDb();
    const { createMemoryStore } = await import("../../../src/services/adjutant/memory-store.js");
    store = createMemoryStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("syncMemoryFiles", () => {
    it("should export high-confidence learnings to topic files", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      insertHighConfidenceLearning("bead-workflow", "Always assign yourself to a bead before starting", 0.8, 3);
      insertHighConfidenceLearning("bead-workflow", "Run bd vc commit before shutting down", 0.75, 4);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(1);
      expect(result.learningsExported).toBe(2);

      const topicFile = join(memoryDir, "bead-workflow.md");
      expect(existsSync(topicFile)).toBe(true);

      const content = readFileSync(topicFile, "utf-8");
      expect(content).toContain("Always assign yourself");
      expect(content).toContain("Run bd vc commit before shutting down");
    });

    it("should NOT export learnings below confidence threshold", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      // Low confidence, high reinforcement
      insertHighConfidenceLearning("weak-topic", "Low confidence learning", 0.5, 5);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(0);
      expect(result.learningsExported).toBe(0);
    });

    it("should NOT export learnings below reinforcement threshold", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      // High confidence, low reinforcement (only 1 — below 2 threshold)
      insertHighConfidenceLearning("unreinforced-topic", "Unreinforced learning", 0.9, 1);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(0);
      expect(result.learningsExported).toBe(0);
    });

    it("should group learnings by topic into separate files", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      insertHighConfidenceLearning("bead-workflow", "Learning about beads", 0.8, 3);
      insertHighConfidenceLearning("code-review", "Learning about code review", 0.85, 4);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(2);
      expect(existsSync(join(memoryDir, "bead-workflow.md"))).toBe(true);
      expect(existsSync(join(memoryDir, "code-review.md"))).toBe(true);
    });

    it("should update MEMORY.md with auto-generated learnings section", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      // Write initial MEMORY.md with manual content
      const { writeFileSync } = await import("node:fs");
      writeFileSync(memoryMdPath, "# Project Memory\n\n## Manual Section\n- Important rule\n");

      insertHighConfidenceLearning("bead-workflow", "Learning about beads", 0.8, 3);

      await syncMemoryFiles(store, memoryDir, memoryMdPath);

      const content = readFileSync(memoryMdPath, "utf-8");
      // Should preserve manual content
      expect(content).toContain("## Manual Section");
      expect(content).toContain("- Important rule");
      // Should add auto-generated section
      expect(content).toContain("## Auto-Generated Learnings");
      expect(content).toContain("bead-workflow");
    });

    it("should replace existing auto-generated section on re-sync", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        memoryMdPath,
        [
          "# Project Memory",
          "",
          "## Manual Section",
          "- Keep this",
          "",
          "## Auto-Generated Learnings",
          "- old-topic: old learning",
          "",
        ].join("\n"),
      );

      insertHighConfidenceLearning("new-topic", "New learning content", 0.9, 5);

      await syncMemoryFiles(store, memoryDir, memoryMdPath);

      const content = readFileSync(memoryMdPath, "utf-8");
      expect(content).toContain("## Manual Section");
      expect(content).toContain("- Keep this");
      // Old auto-generated content should be replaced
      expect(content).not.toContain("old-topic: old learning");
      // New content should be present
      expect(content).toContain("new-topic");
    });

    it("should keep MEMORY.md under 180 lines total", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      const { writeFileSync } = await import("node:fs");
      // Write 100 lines of manual content
      const manualLines = Array.from({ length: 100 }, (_, i) => `- Manual rule ${i + 1}`);
      writeFileSync(
        memoryMdPath,
        ["# Project Memory", "", ...manualLines, ""].join("\n"),
      );

      // Insert many high-confidence learnings across many topics
      for (let i = 0; i < 50; i++) {
        insertHighConfidenceLearning(`topic-${i}`, `Learning content for topic ${i}`, 0.9, 5);
      }

      await syncMemoryFiles(store, memoryDir, memoryMdPath);

      const content = readFileSync(memoryMdPath, "utf-8");
      const lineCount = content.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(180);
    });

    it("should prune topic files for learnings below confidence 0.3", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");
      const { writeFileSync } = await import("node:fs");

      // Manually create a stale topic file
      const staleTopicPath = join(memoryDir, "stale-topic.md");
      writeFileSync(staleTopicPath, "# stale-topic\n\n- Old learning that should be pruned\n");

      // Insert a learning for this topic with very low confidence
      const l = store.insertLearning({
        category: "operational",
        topic: "stale-topic",
        content: "Old learning that should be pruned",
        sourceType: "user_correction",
        confidence: 0.2,
      });
      // Reinforce a few times to get above reinforcement threshold
      for (let i = 0; i < 3; i++) {
        store.reinforceLearning(l.id);
      }
      // Force confidence back down below 0.3
      store.updateLearning(l.id, { confidence: 0.2 });

      await syncMemoryFiles(store, memoryDir, memoryMdPath);

      // The stale topic file should be removed because all learnings are below 0.3
      expect(existsSync(staleTopicPath)).toBe(false);
    });

    it("should NOT prune topic files that still have high-confidence learnings", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      insertHighConfidenceLearning("active-topic", "Active learning", 0.8, 3);

      await syncMemoryFiles(store, memoryDir, memoryMdPath);

      const topicFile = join(memoryDir, "active-topic.md");
      expect(existsSync(topicFile)).toBe(true);
    });

    it("should create memory directory if it does not exist", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      // Remove the directory
      rmSync(memoryDir, { recursive: true, force: true });

      insertHighConfidenceLearning("new-topic", "A new learning", 0.8, 3);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(1);
      expect(existsSync(memoryDir)).toBe(true);
    });

    it("should create MEMORY.md if it does not exist", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      insertHighConfidenceLearning("fresh-topic", "Fresh learning", 0.8, 3);

      await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(existsSync(memoryMdPath)).toBe(true);
      const content = readFileSync(memoryMdPath, "utf-8");
      expect(content).toContain("## Auto-Generated Learnings");
    });

    it("should sort learnings by confidence descending within each topic file", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      insertHighConfidenceLearning("ordered-topic", "Low confidence item", 0.75, 3);
      insertHighConfidenceLearning("ordered-topic", "High confidence item", 0.95, 5);

      await syncMemoryFiles(store, memoryDir, memoryMdPath);

      const content = readFileSync(join(memoryDir, "ordered-topic.md"), "utf-8");
      const highIdx = content.indexOf("High confidence item");
      const lowIdx = content.indexOf("Low confidence item");
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it("should not export superseded learnings", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      const old = store.insertLearning({
        category: "operational",
        topic: "superseded-topic",
        content: "Old rule that was replaced",
        sourceType: "user_correction",
        confidence: 0.8,
      });
      // Reinforce to get above threshold
      for (let i = 0; i < 3; i++) store.reinforceLearning(old.id);
      store.updateLearning(old.id, { confidence: 0.8 });

      const newer = store.insertLearning({
        category: "operational",
        topic: "superseded-topic",
        content: "New improved rule",
        sourceType: "user_correction",
        confidence: 0.9,
      });
      for (let i = 0; i < 3; i++) store.reinforceLearning(newer.id);
      store.updateLearning(newer.id, { confidence: 0.9 });

      store.supersedeLearning(old.id, newer.id);

      await syncMemoryFiles(store, memoryDir, memoryMdPath);

      const topicFile = join(memoryDir, "superseded-topic.md");
      if (existsSync(topicFile)) {
        const content = readFileSync(topicFile, "utf-8");
        expect(content).not.toContain("Old rule that was replaced");
        expect(content).toContain("New improved rule");
      }
    });

    it("should sanitize topic names containing path traversal characters (adj-lau5)", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      // Insert a learning with a malicious topic that tries path traversal
      insertHighConfidenceLearning("../../etc/passwd", "Malicious content", 0.9, 5);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(1);
      // The file should be created INSIDE memoryDir, not outside
      expect(existsSync(join(memoryDir, "etcpasswd.md"))).toBe(true);
      // Should NOT have written outside the directory
      const parentDir = join(memoryDir, "..");
      expect(existsSync(join(parentDir, "passwd.md"))).toBe(false);
    });

    it("should sanitize topic names with slashes and special characters (adj-lau5)", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      insertHighConfidenceLearning("foo/bar\\baz", "Content with slashes", 0.9, 5);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(1);
      // Should sanitize to safe filename
      const files = readdirSync(memoryDir).filter(f => f !== "MEMORY.md");
      expect(files.length).toBe(1);
      // Filename should not contain slashes or backslashes
      expect(files[0]).not.toContain("/");
      expect(files[0]).not.toContain("\\");
    });

    it("should truncate excessively long topic names (adj-lau5)", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      const longTopic = "a".repeat(300);
      insertHighConfidenceLearning(longTopic, "Content with long topic", 0.9, 5);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(1);
      const files = readdirSync(memoryDir).filter(f => f !== "MEMORY.md");
      expect(files.length).toBe(1);
      // Filename (without .md) should be at most 100 chars
      const nameWithoutExt = files[0].replace(".md", "");
      expect(nameWithoutExt.length).toBeLessThanOrEqual(100);
    });

    it("should return correct sync result stats", async () => {
      const { syncMemoryFiles } = await import("../../../src/services/adjutant/memory-file-sync.js");

      insertHighConfidenceLearning("topic-a", "Learning A1", 0.8, 3);
      insertHighConfidenceLearning("topic-a", "Learning A2", 0.9, 4);
      insertHighConfidenceLearning("topic-b", "Learning B1", 0.75, 3);

      const result = await syncMemoryFiles(store, memoryDir, memoryMdPath);

      expect(result.topicsWritten).toBe(2);
      expect(result.learningsExported).toBe(3);
      expect(result.topicsPruned).toBe(0);
    });
  });
});
