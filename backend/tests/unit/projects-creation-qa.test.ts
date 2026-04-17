/**
 * QA tests for project creation flows (adj-050.4.1).
 *
 * Supplements the existing projects-service.test.ts and projects-routes.test.ts
 * with additional edge cases, security checks, and cross-mode validation.
 *
 * @module tests/unit/projects-creation-qa
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { join, resolve } from "path";
import { homedir } from "os";
import Database from "better-sqlite3";

// Mock fs, child_process, crypto
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "qa-test-uuid-1234-5678-9012345678ab"),
}));

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
}));

// Create in-memory database for each test
let testDb: Database.Database;

vi.mock("../../src/services/database.js", () => ({
  getDatabase: () => testDb,
  createDatabase: () => testDb,
  runMigrations: () => {},
}));

import {
  createProject,
} from "../../src/services/projects-service.js";
import type { Project } from "../../src/services/projects-service.js";

const DEFAULT_PROJECTS_BASE = join(homedir(), "projects");

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

function insertProject(db: Database.Database, project: Partial<Project> & { id: string; name: string; path: string }): void {
  db.prepare(`
    INSERT INTO projects (id, name, path, git_remote, mode, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    project.name,
    project.path,
    project.gitRemote ?? null,
    project.mode ?? "swarm",
    project.createdAt ?? "2026-01-01T00:00:00.000Z",
    project.active ? 1 : 0,
  );
}

describe("QA: Project creation edge cases (adj-050.4.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDb();
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  // ===========================================================================
  // Clone URL format variations
  // ===========================================================================

  describe("clone URL format variations", () => {
    it("should handle HTTPS clone URLs", () => {
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "https://github.com/user/repo.git",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("repo");
      expect(result.data!.gitRemote).toBe("https://github.com/user/repo.git");
    });

    it("should handle HTTPS clone URLs without .git suffix", () => {
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "https://github.com/user/repo",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("repo");
    });

    it("should handle SSH clone URLs (git@ format)", () => {
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "myrepo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("myrepo");
    });

    it("should handle clone URL with targetDir using HTTPS URL", () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === "/tmp/clone-target") return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "https://github.com/org/project.git",
        targetDir: "/tmp/clone-target",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe("/tmp/clone-target");
      expect(result.data!.gitRemote).toBe("https://github.com/org/project.git");
    });
  });

  // ===========================================================================
  // targetDir edge cases
  // ===========================================================================

  describe("targetDir edge cases", () => {
    it("should resolve relative targetDir to absolute path", () => {
      const resolvedPath = resolve("relative/path/repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === resolvedPath) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "relative/path/repo",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe(resolvedPath);
    });

    it("should handle targetDir with trailing slash", () => {
      const resolvedPath = resolve("/tmp/my-project/");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === resolvedPath) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/my-project/",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe(resolvedPath);
    });

    it("should detect conflict when targetDir matches an existing registered project path", () => {
      insertProject(testDb, {
        id: "existing-1",
        name: "existing-project",
        path: "/tmp/already-registered",
      });

      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === "/tmp/already-registered") return true;
        return false;
      });

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/already-registered",
      });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CONFLICT");
    });
  });

  // ===========================================================================
  // Clone failure handling
  // ===========================================================================

  describe("clone failure handling", () => {
    it("should return CLI_ERROR when git clone fails with custom targetDir", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const cloneError = new Error("fatal: repository not found") as Error & { stderr?: string };
      cloneError.stderr = "fatal: repository 'https://github.com/user/nonexistent.git' not found";
      vi.mocked(execFileSync).mockImplementation(() => {
        throw cloneError;
      });

      const result = createProject({
        cloneUrl: "https://github.com/user/nonexistent.git",
        targetDir: "/tmp/clone-target",
      });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CLI_ERROR");
      expect(result.error!.message).toContain("Git clone failed");
      expect(result.error!.message).toContain("not found");
    });

    it("should return CLI_ERROR when git clone fails without custom targetDir", () => {
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "bad-repo");
      vi.mocked(existsSync).mockReturnValue(false);
      const cloneError = new Error("Authentication failed") as Error & { stderr?: string };
      cloneError.stderr = "fatal: Authentication failed for 'https://github.com/private/bad-repo.git'";
      vi.mocked(execFileSync).mockImplementation(() => {
        throw cloneError;
      });

      const result = createProject({
        cloneUrl: "https://github.com/private/bad-repo.git",
      });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CLI_ERROR");
      expect(result.error!.message).toContain("Authentication failed");
    });

    it("should handle clone error with no stderr", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("Unknown clone failure");
      });

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/target",
      });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CLI_ERROR");
      expect(result.error!.message).toContain("Unknown clone failure");
    });
  });

  // ===========================================================================
  // Security: Command injection vectors
  // ===========================================================================

  describe("security: command injection prevention", () => {
    it("should use execFileSync with args array to prevent injection via cloneUrl", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const maliciousUrl = "https://github.com/user/repo.git; echo pwned";
      createProject({
        cloneUrl: maliciousUrl,
        targetDir: "/tmp/safe-dir",
      });

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["clone", maliciousUrl, "/tmp/safe-dir"],
        expect.any(Object),
      );
    });

    it("should use execFileSync with args array to prevent injection via targetDir", () => {
      const maliciousDir = "/tmp/safe; rm -rf /";
      const resolvedDir = resolve(maliciousDir);
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      createProject({
        cloneUrl: "https://github.com/user/repo.git",
        targetDir: maliciousDir,
      });

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["clone", "https://github.com/user/repo.git", resolvedDir],
        expect.any(Object),
      );
    });
  });

  // ===========================================================================
  // Mode precedence and mutual exclusivity
  // ===========================================================================

  describe("mode precedence", () => {
    it("should prefer cloneUrl mode over path mode when both provided", () => {
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "repo");
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        path: "/Users/test/code/existing-project",
      });
      expect(result.success).toBe(true);
      expect(result.data!.gitRemote).toBe("git@github.com:user/repo.git");
      expect(result.data!.path).toBe(defaultTarget);
    });

    it("should prefer cloneUrl over empty when both provided", () => {
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "repo");
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        name: "my-empty",
        empty: true,
      });
      expect(result.success).toBe(true);
      expect(result.data!.gitRemote).toBe("git@github.com:user/repo.git");
    });

    it("should prefer empty mode over path mode when both provided", () => {
      const emptyTarget = join(DEFAULT_PROJECTS_BASE, "my-empty");
      vi.mocked(existsSync).mockReturnValue(false);

      const result = createProject({
        name: "my-empty",
        empty: true,
        path: "/Users/test/code/existing",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("my-empty");
      expect(result.data!.path).toBe(emptyTarget);
    });
  });

  // ===========================================================================
  // Store persistence checks (now SQLite)
  // ===========================================================================

  describe("store persistence for clone with targetDir", () => {
    it("should persist project to SQLite after successful clone with targetDir", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/target-dir",
      });
      expect(result.success).toBe(true);

      // Verify it was inserted into SQLite
      const rows = testDb.prepare("SELECT * FROM projects").all() as { path: string; git_remote: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].path).toBe("/tmp/target-dir");
      expect(rows[0].git_remote).toBe("git@github.com:user/repo.git");
    });

    it("should NOT persist project when clone fails", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("clone failed");
      });

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/target-dir",
      });
      expect(result.success).toBe(false);

      // Verify nothing was inserted into SQLite
      const rows = testDb.prepare("SELECT * FROM projects").all();
      expect(rows).toHaveLength(0);
    });
  });

  // ===========================================================================
  // nameFromCloneUrl extraction
  // ===========================================================================

  describe("name extraction from clone URL", () => {
    it("should extract name from GitHub SSH URL", () => {
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "adjutant");
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:org/adjutant.git",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("adjutant");
    });

    it("should extract name from GitHub HTTPS URL with .git suffix", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "https://github.com/user/my-project.git",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("my-project");
    });

    it("should extract name from URL without .git suffix", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "https://github.com/user/bare-name",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("bare-name");
    });

    it("should use custom name over URL-derived name", () => {
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "custom");
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:org/original-name.git",
        name: "custom",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("custom");
      expect(result.data!.path).toBe(defaultTarget);
    });
  });

  // ===========================================================================
  // Project metadata correctness
  // ===========================================================================

  describe("project metadata correctness", () => {
    it("should set mode to 'swarm' for cloned projects", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      expect(result.data!.mode).toBe("swarm");
    });

    // adj-162: active field removed from Project — no activation concept
    it("should not include active field on cloned projects (adj-162)", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      // active field should not be present on the Project object
      expect("active" in result.data!).toBe(false);
    });

    it("should set empty sessions array for cloned projects", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      expect(result.data!.sessions).toEqual([]);
    });

    it("should set createdAt to a valid ISO date string", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      const parsed = new Date(result.data!.createdAt);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it("should generate a UUID-based ID", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      // ID should be first 8 chars of the mocked UUID
      expect(result.data!.id).toBe("qa-test-");
    });
  });
});
