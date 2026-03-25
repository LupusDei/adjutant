import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-proj-autodev-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

/**
 * Insert a test project directly into the database and return its ID.
 * Creates a temporary directory so hasBeads/path checks don't break.
 */
function insertTestProject(projectDb: Database.Database, overrides?: { name?: string; active?: number }): string {
  const id = `test-${Math.random().toString(36).slice(2, 8)}`;
  const projPath = join(testDir, `proj-${id}`);
  mkdirSync(projPath, { recursive: true });
  projectDb.prepare(`
    INSERT INTO projects (id, name, path, mode, created_at, active)
    VALUES (?, ?, ?, 'swarm', datetime('now'), ?)
  `).run(id, overrides?.name ?? "test-project", projPath, overrides?.active ?? 0);
  return id;
}

describe("ProjectsService Auto-Develop", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const dbModule = await import("../../src/services/database.js");
    vi.spyOn(dbModule, "getDatabase").mockReturnValue(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("enableAutoDevelop", () => {
    it("should enable auto-develop for an existing project", async () => {
      const id = insertTestProject(db);
      const { enableAutoDevelop } = await import("../../src/services/projects-service.js");

      const result = enableAutoDevelop(id);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.autoDevelop).toBe(true);
      expect(result.data!.id).toBe(id);
    });

    it("should return NOT_FOUND for non-existent project", async () => {
      const { enableAutoDevelop } = await import("../../src/services/projects-service.js");

      const result = enableAutoDevelop("nonexistent-id");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("should be idempotent — enabling twice returns same state", async () => {
      const id = insertTestProject(db);
      const { enableAutoDevelop } = await import("../../src/services/projects-service.js");

      enableAutoDevelop(id);
      const result = enableAutoDevelop(id);

      expect(result.success).toBe(true);
      expect(result.data!.autoDevelop).toBe(true);
    });
  });

  describe("disableAutoDevelop", () => {
    it("should disable auto-develop and clear paused_at", async () => {
      const id = insertTestProject(db);
      const { enableAutoDevelop, disableAutoDevelop, pauseAutoDevelop } = await import("../../src/services/projects-service.js");

      enableAutoDevelop(id);
      pauseAutoDevelop(id);
      const result = disableAutoDevelop(id);

      expect(result.success).toBe(true);
      expect(result.data!.autoDevelop).toBe(false);
      expect(result.data!.autoDevelopPausedAt).toBeUndefined();
    });

    it("should return NOT_FOUND for non-existent project", async () => {
      const { disableAutoDevelop } = await import("../../src/services/projects-service.js");

      const result = disableAutoDevelop("nonexistent-id");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("should be idempotent — disabling already-disabled project succeeds", async () => {
      const id = insertTestProject(db);
      const { disableAutoDevelop } = await import("../../src/services/projects-service.js");

      const result = disableAutoDevelop(id);

      expect(result.success).toBe(true);
      expect(result.data!.autoDevelop).toBe(false);
    });
  });

  describe("setVisionContext", () => {
    it("should store vision context text on a project", async () => {
      const id = insertTestProject(db);
      const { setVisionContext } = await import("../../src/services/projects-service.js");

      const result = setVisionContext(id, "Build a retro terminal dashboard");

      expect(result.success).toBe(true);
      expect(result.data!.visionContext).toBe("Build a retro terminal dashboard");
    });

    it("should return NOT_FOUND for non-existent project", async () => {
      const { setVisionContext } = await import("../../src/services/projects-service.js");

      const result = setVisionContext("nonexistent-id", "anything");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("should overwrite previous vision context", async () => {
      const id = insertTestProject(db);
      const { setVisionContext } = await import("../../src/services/projects-service.js");

      setVisionContext(id, "Old vision");
      const result = setVisionContext(id, "New vision");

      expect(result.success).toBe(true);
      expect(result.data!.visionContext).toBe("New vision");
    });
  });

  describe("pauseAutoDevelop", () => {
    it("should set auto_develop_paused_at timestamp", async () => {
      const id = insertTestProject(db);
      const { enableAutoDevelop, pauseAutoDevelop } = await import("../../src/services/projects-service.js");

      enableAutoDevelop(id);
      const result = pauseAutoDevelop(id);

      expect(result.success).toBe(true);
      expect(result.data!.autoDevelopPausedAt).toBeDefined();
      expect(result.data!.autoDevelopPausedAt).toBeTruthy();
    });

    it("should return NOT_FOUND for non-existent project", async () => {
      const { pauseAutoDevelop } = await import("../../src/services/projects-service.js");

      const result = pauseAutoDevelop("nonexistent-id");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("should update paused_at on repeated pauses", async () => {
      const id = insertTestProject(db);
      const { pauseAutoDevelop } = await import("../../src/services/projects-service.js");

      const first = pauseAutoDevelop(id);
      const second = pauseAutoDevelop(id);

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(second.data!.autoDevelopPausedAt).toBeDefined();
    });
  });

  describe("clearAutoDevelopPause", () => {
    it("should clear the paused_at timestamp", async () => {
      const id = insertTestProject(db);
      const { pauseAutoDevelop, clearAutoDevelopPause } = await import("../../src/services/projects-service.js");

      pauseAutoDevelop(id);
      const result = clearAutoDevelopPause(id);

      expect(result.success).toBe(true);
      expect(result.data!.autoDevelopPausedAt).toBeUndefined();
    });

    it("should return NOT_FOUND for non-existent project", async () => {
      const { clearAutoDevelopPause } = await import("../../src/services/projects-service.js");

      const result = clearAutoDevelopPause("nonexistent-id");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("should succeed even when not paused", async () => {
      const id = insertTestProject(db);
      const { clearAutoDevelopPause } = await import("../../src/services/projects-service.js");

      const result = clearAutoDevelopPause(id);

      expect(result.success).toBe(true);
      expect(result.data!.autoDevelopPausedAt).toBeUndefined();
    });
  });

  describe("getAutoDevelopProjects", () => {
    it("should return only projects with auto_develop enabled", async () => {
      const id1 = insertTestProject(db, { name: "enabled-project" });
      insertTestProject(db, { name: "disabled-project" });
      const { enableAutoDevelop, getAutoDevelopProjects } = await import("../../src/services/projects-service.js");

      enableAutoDevelop(id1);

      const result = getAutoDevelopProjects();

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe(id1);
      expect(result.data![0].autoDevelop).toBe(true);
    });

    it("should return empty array when no projects have auto-develop enabled", async () => {
      insertTestProject(db);
      const { getAutoDevelopProjects } = await import("../../src/services/projects-service.js");

      const result = getAutoDevelopProjects();

      expect(result.success).toBe(true);
      expect(result.data!).toEqual([]);
    });

    it("should return multiple enabled projects", async () => {
      const id1 = insertTestProject(db, { name: "proj-a" });
      const id2 = insertTestProject(db, { name: "proj-b" });
      const { enableAutoDevelop, getAutoDevelopProjects } = await import("../../src/services/projects-service.js");

      enableAutoDevelop(id1);
      enableAutoDevelop(id2);

      const result = getAutoDevelopProjects();

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(2);
    });
  });
});
