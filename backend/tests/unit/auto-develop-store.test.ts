import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { AutoDevelopStore } from "../../src/services/auto-develop-store.js";

let testDir: string;
let db: Database.Database;
let store: AutoDevelopStore;

/** Project ID used in tests — must exist in the projects table for FK constraint. */
const TEST_PROJECT_ID = "test-proj-001";

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-autodev-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

function insertTestProject(projectDb: Database.Database, id: string): void {
  const projPath = join(testDir, `proj-${id}`);
  mkdirSync(projPath, { recursive: true });
  projectDb.prepare(`
    INSERT INTO projects (id, name, path, mode, created_at, active)
    VALUES (?, ?, ?, 'swarm', datetime('now'), 0)
  `).run(id, `project-${id}`, projPath);
}

describe("AutoDevelopStore", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    insertTestProject(db, TEST_PROJECT_ID);
    const { createAutoDevelopStore } = await import("../../src/services/auto-develop-store.js");
    store = createAutoDevelopStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("startCycle", () => {
    it("should create a new cycle with generated UUID and default counters", () => {
      const cycle = store.startCycle(TEST_PROJECT_ID, "ideation");

      expect(cycle.id).toBeTruthy();
      expect(cycle.projectId).toBe(TEST_PROJECT_ID);
      expect(cycle.phase).toBe("ideation");
      expect(cycle.startedAt).toBeTruthy();
      expect(cycle.completedAt).toBeNull();
      expect(cycle.proposalsGenerated).toBe(0);
      expect(cycle.proposalsAccepted).toBe(0);
      expect(cycle.proposalsEscalated).toBe(0);
      expect(cycle.proposalsDismissed).toBe(0);
    });

    it("should create cycles with unique IDs", () => {
      const c1 = store.startCycle(TEST_PROJECT_ID, "ideation");
      const c2 = store.startCycle(TEST_PROJECT_ID, "review");

      expect(c1.id).not.toBe(c2.id);
    });

    it("should allow multiple active cycles for different phases", () => {
      store.startCycle(TEST_PROJECT_ID, "ideation");
      store.startCycle(TEST_PROJECT_ID, "review");

      const history = store.getCycleHistory(TEST_PROJECT_ID);
      expect(history.length).toBe(2);
    });
  });

  describe("updateCycle", () => {
    it("should update specified fields on an existing cycle", () => {
      const cycle = store.startCycle(TEST_PROJECT_ID, "ideation");

      const updated = store.updateCycle(cycle.id, {
        proposalsGenerated: 5,
        proposalsAccepted: 3,
      });

      expect(updated).not.toBeNull();
      expect(updated!.proposalsGenerated).toBe(5);
      expect(updated!.proposalsAccepted).toBe(3);
      expect(updated!.proposalsEscalated).toBe(0); // unchanged
    });

    it("should return null for non-existent cycle", () => {
      const result = store.updateCycle("nonexistent-id", { phase: "review" });

      expect(result).toBeNull();
    });

    it("should handle empty updates gracefully (return existing cycle)", () => {
      const cycle = store.startCycle(TEST_PROJECT_ID, "ideation");

      const result = store.updateCycle(cycle.id, {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe(cycle.id);
      expect(result!.phase).toBe("ideation");
    });

    it("should update phase independently", () => {
      const cycle = store.startCycle(TEST_PROJECT_ID, "ideation");

      const updated = store.updateCycle(cycle.id, { phase: "execution" });

      expect(updated!.phase).toBe("execution");
    });
  });

  describe("completeCycle", () => {
    it("should set completed_at timestamp on an active cycle", () => {
      const cycle = store.startCycle(TEST_PROJECT_ID, "ideation");

      const completed = store.completeCycle(cycle.id);

      expect(completed).not.toBeNull();
      expect(completed!.completedAt).toBeTruthy();
    });

    it("should return null for non-existent cycle", () => {
      const result = store.completeCycle("nonexistent-id");

      expect(result).toBeNull();
    });

    it("should allow completing an already-completed cycle (overwrites timestamp)", () => {
      const cycle = store.startCycle(TEST_PROJECT_ID, "ideation");

      store.completeCycle(cycle.id);
      const result = store.completeCycle(cycle.id);

      expect(result).not.toBeNull();
      expect(result!.completedAt).toBeTruthy();
    });
  });

  describe("getActiveCycle", () => {
    it("should return the most recent active (non-completed) cycle for a project", () => {
      store.startCycle(TEST_PROJECT_ID, "ideation");
      const latest = store.startCycle(TEST_PROJECT_ID, "review");

      const active = store.getActiveCycle(TEST_PROJECT_ID);

      expect(active).not.toBeNull();
      expect(active!.id).toBe(latest.id);
      expect(active!.phase).toBe("review");
    });

    it("should return null when no active cycles exist", () => {
      const cycle = store.startCycle(TEST_PROJECT_ID, "ideation");
      store.completeCycle(cycle.id);

      const active = store.getActiveCycle(TEST_PROJECT_ID);

      expect(active).toBeNull();
    });

    it("should return null for a project with no cycles at all", () => {
      const otherId = "other-proj";
      insertTestProject(db, otherId);

      const active = store.getActiveCycle(otherId);

      expect(active).toBeNull();
    });
  });

  describe("getCycleHistory", () => {
    it("should return cycles ordered by started_at descending", () => {
      const c1 = store.startCycle(TEST_PROJECT_ID, "ideation");
      const c2 = store.startCycle(TEST_PROJECT_ID, "review");
      const c3 = store.startCycle(TEST_PROJECT_ID, "execution");

      const history = store.getCycleHistory(TEST_PROJECT_ID);

      expect(history.length).toBe(3);
      // Most recent first
      expect(history[0].id).toBe(c3.id);
    });

    it("should respect the limit parameter", () => {
      store.startCycle(TEST_PROJECT_ID, "a");
      store.startCycle(TEST_PROJECT_ID, "b");
      store.startCycle(TEST_PROJECT_ID, "c");

      const history = store.getCycleHistory(TEST_PROJECT_ID, 2);

      expect(history.length).toBe(2);
    });

    it("should return empty array for project with no cycles", () => {
      const otherId = "empty-proj";
      insertTestProject(db, otherId);

      const history = store.getCycleHistory(otherId);

      expect(history).toEqual([]);
    });

    it("should include both completed and active cycles", () => {
      const c1 = store.startCycle(TEST_PROJECT_ID, "ideation");
      store.completeCycle(c1.id);
      store.startCycle(TEST_PROJECT_ID, "review");

      const history = store.getCycleHistory(TEST_PROJECT_ID);

      expect(history.length).toBe(2);
      const completedCount = history.filter((c) => c.completedAt !== null).length;
      const activeCount = history.filter((c) => c.completedAt === null).length;
      expect(completedCount).toBe(1);
      expect(activeCount).toBe(1);
    });
  });
});
