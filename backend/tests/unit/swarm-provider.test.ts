import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";

// Create in-memory database for each test
let testDb: Database.Database;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      git_remote TEXT,
      mode TEXT NOT NULL DEFAULT 'swarm',
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

// Mock database.js to return our test DB
vi.mock("../../src/services/database.js", () => ({
  getDatabase: () => testDb,
  createDatabase: () => testDb,
  runMigrations: () => {},
}));

import { SwarmProvider } from "../../src/services/workspace/swarm-provider.js";

const TEST_DIR = join(tmpdir(), `swarm-provider-test-${Date.now()}`);

describe("SwarmProvider", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    testDb = createTestDb();
  });

  afterEach(() => {
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
    if (testDb) testDb.close();
  });

  // ===========================================================================
  // listBeadsDirs
  // ===========================================================================

  describe("listBeadsDirs", () => {
    it("returns root .beads/ when no sub-projects exist", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(1);
      expect(dirs[0].project).toBeNull();
      expect(dirs[0].workDir).toBe(TEST_DIR);
      expect(dirs[0].path).toBe(join(TEST_DIR, ".beads"));
    });

    it("returns empty array when no .beads/ exists anywhere", async () => {
      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(0);
    });

    it("discovers sub-projects with .beads/beads.db", async () => {
      // Root .beads/
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // Sub-project with .beads/beads.db
      mkdirSync(join(TEST_DIR, "frontend", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "frontend", ".beads", "beads.db"), "");

      mkdirSync(join(TEST_DIR, "backend", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "backend", ".beads", "beads.db"), "");

      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(3);

      const root = dirs.find((d) => d.project === null);
      expect(root).toBeDefined();
      expect(root!.workDir).toBe(TEST_DIR);

      const frontend = dirs.find((d) => d.project === "frontend");
      expect(frontend).toBeDefined();
      expect(frontend!.workDir).toBe(join(TEST_DIR, "frontend"));
      expect(frontend!.path).toBe(join(TEST_DIR, "frontend", ".beads"));

      const backend = dirs.find((d) => d.project === "backend");
      expect(backend).toBeDefined();
      expect(backend!.workDir).toBe(join(TEST_DIR, "backend"));
    });

    it("skips sub-dirs without .beads/beads.db", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // Has .beads/ but no beads.db
      mkdirSync(join(TEST_DIR, "incomplete", ".beads"), { recursive: true });

      // No .beads/ at all
      mkdirSync(join(TEST_DIR, "plain"), { recursive: true });

      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(1);
      expect(dirs[0].project).toBeNull();
    });

    it("skips node_modules, .git, and dotfile directories", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // These should all be skipped even if they have beads.db
      for (const skip of ["node_modules", ".git", ".hidden"]) {
        mkdirSync(join(TEST_DIR, skip, ".beads"), { recursive: true });
        writeFileSync(join(TEST_DIR, skip, ".beads", "beads.db"), "");
      }

      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(1);
      expect(dirs[0].project).toBeNull();
    });

    it("discovers Dolt-backed sub-projects (.beads/dolt/)", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // Sub-project with Dolt backend (no beads.db)
      mkdirSync(join(TEST_DIR, "doltproj", ".beads", "dolt"), { recursive: true });

      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(2);
      const doltProj = dirs.find((d) => d.project === "doltproj");
      expect(doltProj).toBeDefined();
      expect(doltProj!.workDir).toBe(join(TEST_DIR, "doltproj"));
    });

    it("discovers sub-projects with only config.yaml", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      mkdirSync(join(TEST_DIR, "configonly", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "configonly", ".beads", "config.yaml"), "prefix: co");

      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      expect(dirs).toHaveLength(2);
      const configProj = dirs.find((d) => d.project === "configonly");
      expect(configProj).toBeDefined();
    });

    it("does NOT include externally registered projects in bulk listing (adj-109)", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // Create an external project directory outside TEST_DIR
      const externalDir = join(tmpdir(), `swarm-external-${Date.now()}`);
      mkdirSync(join(externalDir, ".beads"), { recursive: true });
      writeFileSync(join(externalDir, ".beads", "beads.db"), "");

      // Insert external project into SQLite (replaces writing projects.json)
      testDb.prepare(`
        INSERT INTO projects (id, name, path, mode, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("ext-1", "external-proj", externalDir, "swarm", "2026-01-01T00:00:00.000Z", 0);

      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      // External registered projects ARE included (adj-117.2 restored this).
      // Safe because adj-117.1 changed default queries to active project, not "all".
      expect(dirs).toHaveLength(2);
      expect(dirs[0].project).toBeNull(); // project root
      expect(dirs[1].project).toBe("external-proj"); // registered project

      // Cleanup
      rmSync(externalDir, { recursive: true, force: true });
    });

    it("follows .beads/redirect for sub-projects", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      // Sub-project with redirect
      const subDir = join(TEST_DIR, "myrig");
      const redirectTarget = join(TEST_DIR, "shared-beads");
      mkdirSync(join(subDir, ".beads"), { recursive: true });
      writeFileSync(join(subDir, ".beads", "beads.db"), "");
      writeFileSync(join(subDir, ".beads", "redirect"), redirectTarget);
      mkdirSync(redirectTarget, { recursive: true });

      const provider = new SwarmProvider(TEST_DIR);
      const dirs = await provider.listBeadsDirs();

      const proj = dirs.find((d) => d.project === "myrig");
      expect(proj).toBeDefined();
      expect(proj!.path).toBe(redirectTarget);
      expect(proj!.workDir).toBe(subDir);
    });
  });

  // ===========================================================================
  // listProjectNames
  // ===========================================================================

  describe("listProjectNames", () => {
    it("returns empty array when no sub-projects exist", async () => {
      mkdirSync(join(TEST_DIR, ".beads"), { recursive: true });

      const provider = new SwarmProvider(TEST_DIR);
      const names = await provider.listProjectNames();

      expect(names).toEqual([]);
    });

    it("returns names of discovered sub-projects", async () => {
      mkdirSync(join(TEST_DIR, "alpha", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "alpha", ".beads", "beads.db"), "");

      mkdirSync(join(TEST_DIR, "beta", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, "beta", ".beads", "beads.db"), "");

      // This one has no beads.db, should not appear
      mkdirSync(join(TEST_DIR, "gamma", ".beads"), { recursive: true });

      const provider = new SwarmProvider(TEST_DIR);
      const names = await provider.listProjectNames();

      expect(names).toHaveLength(2);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
      expect(names).not.toContain("gamma");
    });

    it("skips dotfile directories", async () => {
      mkdirSync(join(TEST_DIR, ".secret", ".beads"), { recursive: true });
      writeFileSync(join(TEST_DIR, ".secret", ".beads", "beads.db"), "");

      const provider = new SwarmProvider(TEST_DIR);
      const names = await provider.listProjectNames();

      expect(names).toEqual([]);
    });

    it("does NOT include externally registered projects in bulk listing (adj-109)", async () => {
      // Create external project
      const externalDir = join(tmpdir(), `swarm-external-names-${Date.now()}`);
      mkdirSync(join(externalDir, ".beads"), { recursive: true });
      writeFileSync(join(externalDir, ".beads", "beads.db"), "");

      // Insert external project into SQLite (replaces writing projects.json)
      testDb.prepare(`
        INSERT INTO projects (id, name, path, mode, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("ext-2", "ext-proj", externalDir, "swarm", "2026-01-01T00:00:00.000Z", 0);

      const provider = new SwarmProvider(TEST_DIR);
      const names = await provider.listProjectNames();

      // External projects not in bulk listing (adj-109 fix)
      expect(names).not.toContain("ext-proj");

      rmSync(externalDir, { recursive: true, force: true });
    });
  });

  // ===========================================================================
  // resolveProjectPath
  // ===========================================================================

  describe("resolveProjectPath", () => {
    it("returns path for valid sub-project with .beads/", () => {
      mkdirSync(join(TEST_DIR, "myrig", ".beads"), { recursive: true });

      const provider = new SwarmProvider(TEST_DIR);
      const result = provider.resolveProjectPath("myrig");

      expect(result).toBe(join(TEST_DIR, "myrig"));
    });

    it("returns null for directory without .beads/", () => {
      mkdirSync(join(TEST_DIR, "plain"), { recursive: true });

      const provider = new SwarmProvider(TEST_DIR);
      const result = provider.resolveProjectPath("plain");

      expect(result).toBeNull();
    });

    it("returns null for non-existent directory", () => {
      const provider = new SwarmProvider(TEST_DIR);
      const result = provider.resolveProjectPath("nonexistent");

      expect(result).toBeNull();
    });

    it("resolves externally registered project path from SQLite", () => {
      const externalDir = join(tmpdir(), `swarm-external-resolve-${Date.now()}`);
      mkdirSync(join(externalDir, ".beads"), { recursive: true });
      writeFileSync(join(externalDir, ".beads", "beads.db"), "");

      // Insert external project into SQLite (replaces writing projects.json)
      testDb.prepare(`
        INSERT INTO projects (id, name, path, mode, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("ext-3", "ext-resolve", externalDir, "swarm", "2026-01-01T00:00:00.000Z", 0);

      const provider = new SwarmProvider(TEST_DIR);
      const result = provider.resolveProjectPath("ext-resolve");

      expect(result).toBe(externalDir);

      rmSync(externalDir, { recursive: true, force: true });
    });
  });
});
