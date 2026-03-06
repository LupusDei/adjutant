import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { join, resolve, basename } from "path";
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

    // =========================================================================
    // createProject with targetDir (clone mode)
    // =========================================================================

    it("should clone into custom targetDir when provided", () => {
      mockNoStore();
      const customDir = "/Users/test/custom/location/myrepo";
      const parentDir = "/Users/test/custom/location";
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        // targetDir does NOT exist yet (so clone can proceed)
        if (p === customDir) return false;
        // parent directory exists
        if (p === parentDir) return true;
        return false;
      });
      vi.mocked(execSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
        targetDir: customDir,
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe(customDir);
      expect(result.data!.name).toBe("myrepo");
      expect(result.data!.gitRemote).toBe("git@github.com:user/myrepo.git");
      // Verify git clone used the custom directory
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining(customDir),
        expect.any(Object),
      );
    });

    it("should clone into default ~/projects/<name> when targetDir is not provided", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        return false;
      });
      vi.mocked(execSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
      });
      expect(result.success).toBe(true);
      const expectedDefault = join(homedir(), "projects", "myrepo");
      expect(result.data!.path).toBe(expectedDefault);
    });

    it("should reject clone with targetDir when targetDir already exists", () => {
      mockNoStore();
      const customDir = "/Users/test/custom/existing-dir";
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        if (p === customDir) return true; // already exists
        return false;
      });

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
        targetDir: customDir,
      });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CONFLICT");
      expect(result.error!.message).toContain(customDir);
    });

    it("should resolve relative targetDir to absolute path", () => {
      mockNoStore();
      const relativeDir = "relative/path/myrepo";
      const resolvedDir = resolve(relativeDir);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        if (p === resolvedDir) return false;
        // Parent must exist for the resolved path
        const parentOfResolved = join(resolvedDir, "..");
        if (p === resolve(parentOfResolved)) return true;
        return false;
      });
      vi.mocked(execSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
        targetDir: relativeDir,
      });
      expect(result.success).toBe(true);
      // Path should be absolute (resolved)
      expect(result.data!.path).toBe(resolvedDir);
    });

    it("should use custom name with targetDir", () => {
      mockNoStore();
      const customDir = "/Users/test/custom/location/my-custom-name";
      const parentDir = "/Users/test/custom/location";
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        if (p === ADJUTANT_DIR) return true;
        if (p === customDir) return false;
        if (p === parentDir) return true;
        return false;
      });
      vi.mocked(execSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/myrepo.git",
        name: "custom-project-name",
        targetDir: customDir,
      });
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe(customDir);
      expect(result.data!.name).toBe("custom-project-name");
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

    it("should activate CWD project when already registered but inactive", () => {
      // Simulate: projects.json has the CWD registered but inactive,
      // plus another project that IS active (from a previous session).
      const cwdProject = createMockProject({
        id: "cwd-proj",
        name: basename(PROJECT_ROOT),
        path: PROJECT_ROOT,
        active: false,
      });
      const otherProject = createMockProject({
        id: "other-proj",
        name: "other",
        path: "/Users/test/code/other-project",
        active: true,
      });

      // Store already has entries, so the listProjects() auto-seed won't fire
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR || ps === PROJECTS_FILE || ps === PROJECT_ROOT) return true;
        // Root has .git
        if (ps === join(PROJECT_ROOT, ".git")) return true;
        if (ps === join(PROJECT_ROOT, ".beads", "beads.db")) return false;
        if (ps === "/Users/test/code/other-project") return true;
        if (ps === join("/Users/test/code/other-project", ".beads", "beads.db")) return false;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ projects: [cwdProject, otherProject] }));
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

      const result = discoverLocalProjects();
      expect(result.success).toBe(true);

      // Verify the store was saved with CWD active and other inactive
      expect(writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(writeFileSync).mock.calls[0];
      const savedStore = JSON.parse(writeCall[1] as string) as ProjectsStore;
      const savedCwd = savedStore.projects.find((p) => p.id === "cwd-proj");
      const savedOther = savedStore.projects.find((p) => p.id === "other-proj");
      expect(savedCwd?.active).toBe(true);
      expect(savedOther?.active).toBe(false);
    });

    it("should persist activation even when no new projects are discovered", () => {
      // The CWD is already registered but inactive; no hasBeads changes, no new discoveries.
      // The store should still be saved because activation changed.
      const cwdProject = createMockProject({
        id: "cwd-existing",
        name: basename(PROJECT_ROOT),
        path: PROJECT_ROOT,
        active: false,
        hasBeads: false,
      });

      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR || ps === PROJECTS_FILE || ps === PROJECT_ROOT) return true;
        if (ps === join(PROJECT_ROOT, ".git")) return true;
        if (ps === join(PROJECT_ROOT, ".beads", "beads.db")) return false;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ projects: [cwdProject] }));
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

      discoverLocalProjects();

      // writeFileSync MUST be called since active flag changed
      expect(writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(writeFileSync).mock.calls[0];
      const savedStore = JSON.parse(writeCall[1] as string) as ProjectsStore;
      expect(savedStore.projects[0].active).toBe(true);
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
