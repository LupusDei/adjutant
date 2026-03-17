import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import Database from "better-sqlite3";

// Mock fs (but not all of it — we need real behavior for some things)
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
  randomUUID: vi.fn(() => "abcd1234-5678-9012-3456-789012345678"),
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
  listProjects,
  getProject,
  createProject,
  activateProject,
  deleteProject,
  discoverLocalProjects,
  checkProjectHealth,
} from "../../src/services/projects-service.js";
import type { Project } from "../../src/services/projects-service.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      git_remote TEXT,
      mode TEXT NOT NULL DEFAULT 'swarm',
      sessions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

function insertProject(db: Database.Database, project: Partial<Project> & { id: string; name: string; path: string }): void {
  db.prepare(`
    INSERT INTO projects (id, name, path, git_remote, mode, sessions, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    project.name,
    project.path,
    project.gitRemote ?? null,
    project.mode ?? "swarm",
    JSON.stringify(project.sessions ?? []),
    project.createdAt ?? "2026-01-01T00:00:00.000Z",
    project.active ? 1 : 0,
  );
}

function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "abcd1234",
    name: "test-project",
    path: "/Users/test/code/test-project",
    mode: "swarm",
    sessions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    active: false,
    ...overrides,
  };
}

describe("projects-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDb();
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  // ===========================================================================
  // listProjects
  // ===========================================================================

  describe("listProjects", () => {
    it("should return empty list when no projects exist", () => {
      // Mock existsSync to prevent auto-seed from finding real directories
      vi.mocked(existsSync).mockReturnValue(false);

      const result = listProjects();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("should return projects from SQLite", () => {
      const project = createMockProject();
      insertProject(testDb, project);

      // existsSync for hasBeadsDb check
      vi.mocked(existsSync).mockReturnValue(false);

      const result = listProjects();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].name).toBe("test-project");
      expect(result.data![0].id).toBe("abcd1234");
    });

    it("should auto-seed on empty store via discoverLocalProjects", () => {
      // Table is empty, so listProjects calls discoverLocalProjects
      // Mock: project root exists and has .git
      const projectRoot = resolve(process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd());
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === projectRoot) return true;
        if (ps === join(projectRoot, ".git")) return true;
        return false;
      });
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      const result = listProjects();
      expect(result.success).toBe(true);
      // Should have discovered at least the project root
      expect(result.data!.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // getProject
  // ===========================================================================

  describe("getProject", () => {
    it("should return project by ID", () => {
      const project = createMockProject({ id: "proj-1" });
      insertProject(testDb, project);

      vi.mocked(existsSync).mockReturnValue(false);

      const result = getProject("proj-1");
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("proj-1");
    });

    it("should return NOT_FOUND for missing project", () => {
      const result = getProject("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });
  });

  // ===========================================================================
  // createProject
  // ===========================================================================

  describe("createProject", () => {
    it("should create from existing path", () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (typeof p === "string" && p.includes("/code/myapp")) return true;
        return false;
      });

      const result = createProject({ path: "/Users/test/code/myapp" });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("myapp");
      expect(result.data!.path).toBe("/Users/test/code/myapp");

      // Verify it was inserted into SQLite
      const row = testDb.prepare("SELECT * FROM projects WHERE path = ?").get("/Users/test/code/myapp");
      expect(row).toBeTruthy();
    });

    it("should use provided name over path-derived name", () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (typeof p === "string" && p.includes("/code/myapp")) return true;
        return false;
      });

      const result = createProject({ path: "/Users/test/code/myapp", name: "My App" });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("My App");
    });

    it("should reject non-existent path", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = createProject({ path: "/does/not/exist" });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("does not exist");
    });

    it("should reject duplicate path", () => {
      const existing = createMockProject({ path: "/Users/test/code/myapp" });
      insertProject(testDb, existing);
      vi.mocked(existsSync).mockReturnValue(true);

      const result = createProject({ path: "/Users/test/code/myapp" });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CONFLICT");
    });

    it("should create empty project with git init", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = createProject({ name: "new-project", empty: true });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("new-project");
      expect(mkdirSync).toHaveBeenCalled();
      expect(execSync).toHaveBeenCalledWith("git init", expect.any(Object));

      // Verify it was inserted into SQLite
      const rows = testDb.prepare("SELECT * FROM projects").all();
      expect(rows).toHaveLength(1);
    });

    it("should require name for empty projects", () => {
      const result = createProject({ empty: true });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Name is required");
    });

    it("should create from clone URL", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({ cloneUrl: "git@github.com:user/myrepo.git" });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("myrepo");
      expect(result.data!.gitRemote).toBe("git@github.com:user/myrepo.git");
    });

    it("should reject clone when target directory exists", () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (typeof p === "string" && p.includes("myrepo")) return true;
        return false;
      });

      const result = createProject({ cloneUrl: "git@github.com:user/myrepo.git" });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CONFLICT");
    });

    it("should return error when no valid input provided", () => {
      const result = createProject({});
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
    });

    it("should clone into custom targetDir when provided", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
        targetDir: "/tmp/my-custom-dir/myrepo",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe("/tmp/my-custom-dir/myrepo");
      expect(result.data!.name).toBe("myrepo");
      expect(result.data!.gitRemote).toBe("git@github.com:user/myrepo.git");
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["clone", "git@github.com:user/myrepo.git", "/tmp/my-custom-dir/myrepo"],
        expect.any(Object),
      );
    });

    it("should use default targetDir when targetDir not provided (backward compat)", () => {
      const defaultTarget = join(homedir(), "projects", "myrepo");
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe(defaultTarget);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["clone", "git@github.com:user/myrepo.git", defaultTarget],
        expect.any(Object),
      );
    });

    it("should create parent directories for targetDir if they don't exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
        targetDir: "/tmp/deep/nested/myrepo",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe("/tmp/deep/nested/myrepo");
      expect(mkdirSync).toHaveBeenCalledWith("/tmp/deep/nested", { recursive: true });
    });

    it("should use custom name with targetDir", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
        name: "custom-name",
        targetDir: "/tmp/my-dir",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe("/tmp/my-dir");
      expect(result.data!.name).toBe("custom-name");
    });

    it("should expand ~ in targetDir to home directory", () => {
      const expandedPath = join(homedir(), "code/ai/C4");
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "~/code/ai/C4",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe(expandedPath);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["clone", "git@github.com:user/repo.git", expandedPath],
        expect.any(Object),
      );
    });

    it("should expand ~ in path to home directory", () => {
      const expandedPath = join(homedir(), "code/myapp");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === expandedPath) return true;
        return false;
      });

      const result = createProject({ path: "~/code/myapp" });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe(expandedPath);
    });

    it("should ignore targetDir when not using cloneUrl mode", () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (typeof ps === "string" && ps.includes("/code/myapp")) return true;
        return false;
      });

      const result = createProject({
        path: "/Users/test/code/myapp",
        targetDir: "/tmp/should-be-ignored",
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe("/Users/test/code/myapp");
    });
  });

  // ===========================================================================
  // activateProject
  // ===========================================================================

  describe("activateProject", () => {
    it("should activate project and deactivate others", () => {
      insertProject(testDb, createMockProject({ id: "p1", name: "proj-1", path: "/path/1", active: true }));
      insertProject(testDb, createMockProject({ id: "p2", name: "proj-2", path: "/path/2", active: false }));

      vi.mocked(existsSync).mockReturnValue(false);

      const result = activateProject("p2");
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("p2");
      expect(result.data!.active).toBe(true);

      // Check DB state
      const p1Row = testDb.prepare("SELECT active FROM projects WHERE id = ?").get("p1") as { active: number };
      const p2Row = testDb.prepare("SELECT active FROM projects WHERE id = ?").get("p2") as { active: number };
      expect(p1Row.active).toBe(0);
      expect(p2Row.active).toBe(1);
    });

    it("should return NOT_FOUND for missing project", () => {
      const result = activateProject("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });
  });

  // ===========================================================================
  // deleteProject
  // ===========================================================================

  describe("deleteProject", () => {
    it("should remove project from SQLite", () => {
      insertProject(testDb, createMockProject({ id: "del-1", name: "del-proj", path: "/path/del" }));

      const result = deleteProject("del-1");
      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(true);

      const rows = testDb.prepare("SELECT * FROM projects").all();
      expect(rows).toHaveLength(0);
    });

    it("should return NOT_FOUND for missing project", () => {
      const result = deleteProject("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });
  });

  // ===========================================================================
  // discoverLocalProjects
  // ===========================================================================

  describe("discoverLocalProjects", () => {
    const PROJECT_ROOT = resolve(process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd());

    function mockDiscoverFs(dirs: Record<string, { hasGit?: boolean; hasBeads?: boolean; children?: string[] }>) {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === PROJECT_ROOT) return true;
        // Check .git and .beads/beads.db
        for (const [dir, opts] of Object.entries(dirs)) {
          const absDir = join(PROJECT_ROOT, dir);
          if (ps === absDir) return true;
          if (ps === join(absDir, ".git") && opts.hasGit) return true;
          if (ps === join(absDir, ".beads", "beads.db") && opts.hasBeads) return true;
        }
        // Root git and beads
        if (ps === join(PROJECT_ROOT, ".git")) return true;
        if (ps === join(PROJECT_ROOT, ".beads", "beads.db")) return false;
        return false;
      });

      vi.mocked(readdirSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === PROJECT_ROOT) return Object.keys(dirs) as unknown as ReturnType<typeof readdirSync>;
        for (const [dir, opts] of Object.entries(dirs)) {
          if (ps === join(PROJECT_ROOT, dir) && opts.children) {
            return opts.children as unknown as ReturnType<typeof readdirSync>;
          }
        }
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      vi.mocked(statSync).mockImplementation((_p: unknown) => {
        return { isDirectory: () => true } as ReturnType<typeof statSync>;
      });
    }

    it("should discover directories with .git", () => {
      mockDiscoverFs({
        "project-a": { hasGit: true },
        "not-a-project": {},
      });

      const result = discoverLocalProjects();
      expect(result.success).toBe(true);
      const names = result.data!.map((p) => p.name);
      expect(names).toContain("project-a");
      expect(names).not.toContain("not-a-project");
    });

    it("should discover directories with .beads/beads.db", () => {
      mockDiscoverFs({
        "beads-only-project": { hasBeads: true },
      });

      const result = discoverLocalProjects();
      expect(result.success).toBe(true);
      const names = result.data!.map((p) => p.name);
      expect(names).toContain("beads-only-project");
    });

    it("should compute hasBeads on discovered projects", () => {
      mockDiscoverFs({
        "with-beads": { hasGit: true, hasBeads: true },
        "without-beads": { hasGit: true },
      });

      const result = discoverLocalProjects();
      expect(result.success).toBe(true);

      const withBeads = result.data!.find((p) => p.name === "with-beads");
      const withoutBeads = result.data!.find((p) => p.name === "without-beads");
      expect(withBeads?.hasBeads).toBe(true);
      expect(withoutBeads?.hasBeads).toBe(false);
    });

    it("should respect maxDepth option", () => {
      mockDiscoverFs({
        "child-project": { hasGit: true },
      });

      const result = discoverLocalProjects({ maxDepth: 0 });
      expect(result.success).toBe(true);
      const names = result.data!.map((p) => p.name);
      expect(names).not.toContain("child-project");
    });

    it("should activate CWD project when already registered but inactive", () => {
      // Pre-insert inactive CWD and active other project
      insertProject(testDb, {
        id: "cwd-proj",
        name: basename(PROJECT_ROOT),
        path: PROJECT_ROOT,
        active: false,
      });
      insertProject(testDb, {
        id: "other-proj",
        name: "other",
        path: "/Users/test/code/other-project",
        active: true,
      });

      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === PROJECT_ROOT) return true;
        if (ps === join(PROJECT_ROOT, ".git")) return true;
        if (ps === "/Users/test/code/other-project") return true;
        return false;
      });
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

      const result = discoverLocalProjects();
      expect(result.success).toBe(true);

      // Verify DB state: CWD active, other inactive
      const cwdRow = testDb.prepare("SELECT active FROM projects WHERE id = ?").get("cwd-proj") as { active: number };
      const otherRow = testDb.prepare("SELECT active FROM projects WHERE id = ?").get("other-proj") as { active: number };
      expect(cwdRow.active).toBe(1);
      expect(otherRow.active).toBe(0);
    });

    it("should persist activation even when no new projects are discovered", () => {
      insertProject(testDb, {
        id: "cwd-existing",
        name: basename(PROJECT_ROOT),
        path: PROJECT_ROOT,
        active: false,
      });

      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === PROJECT_ROOT) return true;
        if (ps === join(PROJECT_ROOT, ".git")) return true;
        return false;
      });
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

      discoverLocalProjects();

      const row = testDb.prepare("SELECT active FROM projects WHERE id = ?").get("cwd-existing") as { active: number };
      expect(row.active).toBe(1);
    });
  });

  // ===========================================================================
  // checkProjectHealth
  // ===========================================================================

  describe("checkProjectHealth", () => {
    it("should return healthy for project with path and git", () => {
      insertProject(testDb, createMockProject({ id: "h1", name: "healthy", path: "/Users/test/code/healthy" }));
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === "/Users/test/code/healthy") return true;
        if (ps === "/Users/test/code/healthy/.git") return true;
        return false;
      });

      const result = checkProjectHealth("h1");
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe("healthy");
      expect(result.data!.pathExists).toBe(true);
      expect(result.data!.hasGit).toBe(true);
      expect(result.data!.hasBeads).toBe(false);
    });

    it("should return stale for project with missing path", () => {
      insertProject(testDb, createMockProject({ id: "s1", name: "gone", path: "/Users/test/code/gone" }));
      vi.mocked(existsSync).mockReturnValue(false);

      const result = checkProjectHealth("s1");
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe("stale");
      expect(result.data!.pathExists).toBe(false);
    });

    it("should return degraded for project without git", () => {
      insertProject(testDb, createMockProject({ id: "d1", name: "no-git", path: "/Users/test/code/no-git" }));
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === "/Users/test/code/no-git") return true;
        if (ps === "/Users/test/code/no-git/.git") return false;
        if (ps === join("/Users/test/code/no-git", ".beads", "beads.db")) return true;
        return false;
      });

      const result = checkProjectHealth("d1");
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe("degraded");
      expect(result.data!.hasBeads).toBe(true);
    });

    it("should return NOT_FOUND for unknown project", () => {
      const result = checkProjectHealth("unknown");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });

    it("should compute hasBeads on read (not stored)", () => {
      insertProject(testDb, createMockProject({ id: "u1", name: "proj", path: "/Users/test/code/proj" }));
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === "/Users/test/code/proj") return true;
        if (ps === "/Users/test/code/proj/.git") return true;
        if (ps === join("/Users/test/code/proj", ".beads", "beads.db")) return true;
        return false;
      });

      const result = checkProjectHealth("u1");
      expect(result.success).toBe(true);
      expect(result.data!.hasBeads).toBe(true);
    });
  });
});
