import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { join, resolve } from "path";
import { homedir } from "os";

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

import {
  listProjects,
  getProject,
  createProject,
  activateProject,
  deleteProject,
  discoverLocalProjects,
  checkProjectHealth,
} from "../../src/services/projects-service.js";
import type { Project, ProjectsStore } from "../../src/services/projects-service.js";

const ADJUTANT_DIR = join(homedir(), ".adjutant");
const PROJECTS_FILE = join(ADJUTANT_DIR, "projects.json");

function mockStoreExists(store: ProjectsStore): void {
  vi.mocked(existsSync).mockImplementation((p: unknown) => {
    if (p === ADJUTANT_DIR) return true;
    if (p === PROJECTS_FILE) return true;
    return false;
  });
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(store));
}

function mockNoStore(): void {
  vi.mocked(existsSync).mockImplementation((p: unknown) => {
    if (p === ADJUTANT_DIR) return true;
    if (p === PROJECTS_FILE) return false;
    return false;
  });
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
  });

  // ===========================================================================
  // listProjects
  // ===========================================================================

  describe("listProjects", () => {
    it("should return empty list when no store file exists", () => {
      mockNoStore();
      const result = listProjects();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("should return projects from store", () => {
      const project = createMockProject();
      mockStoreExists({ projects: [project] });

      const result = listProjects();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].name).toBe("test-project");
    });

    it("should handle corrupted store file", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("not json");

      const result = listProjects();
      // Falls back to empty store on parse error
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ===========================================================================
  // getProject
  // ===========================================================================

  describe("getProject", () => {
    it("should return project by ID", () => {
      const project = createMockProject({ id: "proj-1" });
      mockStoreExists({ projects: [project] });

      const result = getProject("proj-1");
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("proj-1");
    });

    it("should return NOT_FOUND for missing project", () => {
      mockStoreExists({ projects: [] });

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
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        if (p === PROJECTS_FILE) return false;
        if (typeof p === "string" && p.includes("/code/myapp")) return true;
        if (typeof p === "string" && p.includes(".git")) return false;
        return false;
      });

      const result = createProject({ path: "/Users/test/code/myapp" });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("myapp");
      expect(result.data!.path).toBe("/Users/test/code/myapp");
      expect(writeFileSync).toHaveBeenCalled();
    });

    it("should use provided name over path-derived name", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === PROJECTS_FILE) return false;
        if (typeof p === "string" && p.includes("/code/myapp")) return true;
        return true;
      });

      const result = createProject({ path: "/Users/test/code/myapp", name: "My App" });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("My App");
    });

    it("should reject non-existent path", () => {
      mockNoStore();
      // existsSync returns false for everything except adjutant dir
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        return false;
      });

      const result = createProject({ path: "/does/not/exist" });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("does not exist");
    });

    it("should reject duplicate path", () => {
      const existing = createMockProject({ path: "/Users/test/code/myapp" });
      mockStoreExists({ projects: [existing] });
      vi.mocked(existsSync).mockReturnValue(true);

      const result = createProject({ path: "/Users/test/code/myapp" });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CONFLICT");
    });

    it("should create empty project with git init", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        return false;
      });

      const result = createProject({ name: "new-project", empty: true });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("new-project");
      expect(mkdirSync).toHaveBeenCalled();
      expect(execSync).toHaveBeenCalledWith("git init", expect.any(Object));
    });

    it("should require name for empty projects", () => {
      mockNoStore();

      const result = createProject({ empty: true });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Name is required");
    });

    it("should create from clone URL", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        return false;
      });
      vi.mocked(execSync).mockReturnValue("");

      const result = createProject({ cloneUrl: "git@github.com:user/myrepo.git" });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("myrepo");
      expect(result.data!.gitRemote).toBe("git@github.com:user/myrepo.git");
    });

    it("should reject clone when target directory exists", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (typeof p === "string" && p.includes("myrepo")) return true;
        if (p === ADJUTANT_DIR) return true;
        return false;
      });

      const result = createProject({ cloneUrl: "git@github.com:user/myrepo.git" });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CONFLICT");
    });

    it("should return error when no valid input provided", () => {
      mockNoStore();

      const result = createProject({});
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
    });
  });

  // ===========================================================================
  // activateProject
  // ===========================================================================

  describe("activateProject", () => {
    it("should activate project and deactivate others", () => {
      const p1 = createMockProject({ id: "p1", active: true });
      const p2 = createMockProject({ id: "p2", active: false });
      mockStoreExists({ projects: [p1, p2] });

      const result = activateProject("p2");
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("p2");

      // Check that writeFileSync was called with correct data
      const writeCall = vi.mocked(writeFileSync).mock.calls[0];
      const savedStore = JSON.parse(writeCall[1] as string) as ProjectsStore;
      expect(savedStore.projects[0].active).toBe(false);
      expect(savedStore.projects[1].active).toBe(true);
    });

    it("should return NOT_FOUND for missing project", () => {
      mockStoreExists({ projects: [] });

      const result = activateProject("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });
  });

  // ===========================================================================
  // deleteProject
  // ===========================================================================

  describe("deleteProject", () => {
    it("should remove project from store", () => {
      const project = createMockProject({ id: "del-1" });
      mockStoreExists({ projects: [project] });

      const result = deleteProject("del-1");
      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(true);

      const writeCall = vi.mocked(writeFileSync).mock.calls[0];
      const savedStore = JSON.parse(writeCall[1] as string) as ProjectsStore;
      expect(savedStore.projects).toHaveLength(0);
    });

    it("should return NOT_FOUND for missing project", () => {
      mockStoreExists({ projects: [] });

      const result = deleteProject("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });
  });

  // ===========================================================================
  // discoverLocalProjects
  // ===========================================================================

  describe("discoverLocalProjects", () => {
    // Must match the service's resolve(ADJUTANT_PROJECT_ROOT || cwd())
    const PROJECT_ROOT = resolve(process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd());

    function mockDiscoverFs(dirs: Record<string, { hasGit?: boolean; hasBeads?: boolean; children?: string[] }>) {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR || ps === PROJECT_ROOT) return true;
        if (ps === PROJECTS_FILE) return false;
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
        // Check if any dir has children
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
      // Root + project-a discovered (not-a-project skipped)
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

    it("should set hasBeads on projects with .beads/beads.db", () => {
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
      // With maxDepth 0, should only register root, not scan children
      mockDiscoverFs({
        "child-project": { hasGit: true },
      });

      const result = discoverLocalProjects({ maxDepth: 0 });
      expect(result.success).toBe(true);
      // Only root should be discovered, not child-project
      const names = result.data!.map((p) => p.name);
      expect(names).not.toContain("child-project");
    });

    it("should clamp maxDepth to MAX_SCAN_DEPTH (3)", () => {
      mockDiscoverFs({
        "child": { hasGit: true },
      });

      // maxDepth 100 should be clamped to 3 (but still work)
      const result = discoverLocalProjects({ maxDepth: 100 });
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // checkProjectHealth
  // ===========================================================================

  describe("checkProjectHealth", () => {
    it("should return healthy for project with path and git", () => {
      const project = createMockProject({ id: "h1", path: "/Users/test/code/healthy" });
      mockStoreExists({ projects: [project] });
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR || ps === PROJECTS_FILE) return true;
        if (ps === "/Users/test/code/healthy") return true;
        if (ps === "/Users/test/code/healthy/.git") return true;
        if (ps === join("/Users/test/code/healthy", ".beads", "beads.db")) return false;
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
      const project = createMockProject({ id: "s1", path: "/Users/test/code/gone" });
      mockStoreExists({ projects: [project] });
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR || ps === PROJECTS_FILE) return true;
        if (ps === "/Users/test/code/gone") return false;
        return false;
      });

      const result = checkProjectHealth("s1");
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe("stale");
      expect(result.data!.pathExists).toBe(false);
    });

    it("should return degraded for project without git", () => {
      const project = createMockProject({ id: "d1", path: "/Users/test/code/no-git" });
      mockStoreExists({ projects: [project] });
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR || ps === PROJECTS_FILE) return true;
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
      mockStoreExists({ projects: [] });

      const result = checkProjectHealth("unknown");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });

    it("should update hasBeads in store when it changes", () => {
      const project = createMockProject({ id: "u1", path: "/Users/test/code/proj", hasBeads: false });
      mockStoreExists({ projects: [project] });
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR || ps === PROJECTS_FILE) return true;
        if (ps === "/Users/test/code/proj") return true;
        if (ps === "/Users/test/code/proj/.git") return true;
        if (ps === join("/Users/test/code/proj", ".beads", "beads.db")) return true;
        return false;
      });

      const result = checkProjectHealth("u1");
      expect(result.success).toBe(true);
      expect(result.data!.hasBeads).toBe(true);

      // Verify store was saved (hasBeads changed from false to true)
      expect(writeFileSync).toHaveBeenCalled();
    });
  });
});
