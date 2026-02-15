import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";

// Mock fs, child_process, crypto
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
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
    mode: "standalone",
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
});
