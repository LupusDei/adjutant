/**
 * QA tests for project creation flows (adj-050.4.1).
 *
 * Supplements the existing projects-service.test.ts and projects-routes.test.ts
 * with additional edge cases, security checks, and cross-mode validation.
 *
 * @module tests/unit/projects-creation-qa
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { execSync, execFileSync } from "child_process";
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

import {
  createProject,
} from "../../src/services/projects-service.js";
import type { ProjectsStore } from "../../src/services/projects-service.js";

const ADJUTANT_DIR = join(homedir(), ".adjutant");
const PROJECTS_FILE = join(ADJUTANT_DIR, "projects.json");
const DEFAULT_PROJECTS_BASE = join(homedir(), "projects");

function mockNoStore(): void {
  vi.mocked(existsSync).mockImplementation((p: unknown) => {
    if (p === ADJUTANT_DIR) return true;
    if (p === PROJECTS_FILE) return false;
    return false;
  });
}

function mockStoreWith(store: ProjectsStore): void {
  vi.mocked(existsSync).mockImplementation((p: unknown) => {
    if (p === ADJUTANT_DIR) return true;
    if (p === PROJECTS_FILE) return true;
    return false;
  });
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(store));
}

describe("QA: Project creation edge cases (adj-050.4.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Clone URL format variations
  // ===========================================================================

  describe("clone URL format variations", () => {
    it("should handle HTTPS clone URLs", () => {
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
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
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
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
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "myrepo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
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
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
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
      mockNoStore();
      const resolvedPath = resolve("relative/path/repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === resolvedPath) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "relative/path/repo",
      });
      expect(result.success).toBe(true);
      // The path should be resolved to an absolute path
      expect(result.data!.path).toBe(resolvedPath);
    });

    it("should handle targetDir with trailing slash", () => {
      mockNoStore();
      // resolve() strips trailing slashes
      const resolvedPath = resolve("/tmp/my-project/");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
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
      // Store has an existing project at the same path we want to clone into.
      // Note: createFromClone checks existsSync(targetDir) for directory conflict,
      // but does NOT check the store for path deduplication (unlike createFromPath).
      // This test documents that behavior — the check is for directory existence only.
      const existing = {
        id: "existing-1",
        name: "existing-project",
        path: "/tmp/already-registered",
        mode: "swarm" as const,
        sessions: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        active: false,
      };
      mockStoreWith({ projects: [existing] });

      // The directory exists on disk
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR || ps === PROJECTS_FILE) return true;
        if (ps === "/tmp/already-registered") return true;
        return false;
      });

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/already-registered",
      });
      // Should fail because directory exists
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("CONFLICT");
    });
  });

  // ===========================================================================
  // Clone failure handling
  // ===========================================================================

  describe("clone failure handling", () => {
    it("should return CLI_ERROR when git clone fails with custom targetDir", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === "/tmp/clone-target") return false;
        return false;
      });
      // Simulate git clone failure
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
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "bad-repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === defaultTarget) return false;
        return false;
      });
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
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        return false;
      });
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
    // execFileSync is used instead of execSync to prevent shell injection.
    // Arguments are passed as an array, never interpolated into a command string.

    it("should use execFileSync with args array to prevent injection via cloneUrl", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const maliciousUrl = "https://github.com/user/repo.git; echo pwned";
      createProject({
        cloneUrl: maliciousUrl,
        targetDir: "/tmp/safe-dir",
      });

      // Verify execFileSync was called with args array (safe from shell injection)
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["clone", maliciousUrl, "/tmp/safe-dir"],
        expect.any(Object),
      );
    });

    it("should use execFileSync with args array to prevent injection via targetDir", () => {
      mockNoStore();
      const maliciousDir = "/tmp/safe; rm -rf /";
      const resolvedDir = resolve(maliciousDir);
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === resolvedDir) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      createProject({
        cloneUrl: "https://github.com/user/repo.git",
        targetDir: maliciousDir,
      });

      // Verify execFileSync with args array — shell metacharacters are harmless
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
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        path: "/Users/test/code/existing-project",
      });
      // cloneUrl is checked first in the createProject function
      expect(result.success).toBe(true);
      expect(result.data!.gitRemote).toBe("git@github.com:user/repo.git");
      expect(result.data!.path).toBe(defaultTarget);
    });

    it("should prefer cloneUrl over empty when both provided", () => {
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "repo");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        name: "my-empty",
        empty: true,
      });
      // cloneUrl takes precedence
      expect(result.success).toBe(true);
      expect(result.data!.gitRemote).toBe("git@github.com:user/repo.git");
    });

    it("should prefer empty mode over path mode when both provided", () => {
      mockNoStore();
      const emptyTarget = join(DEFAULT_PROJECTS_BASE, "my-empty");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === emptyTarget) return false;
        return false;
      });

      const result = createProject({
        name: "my-empty",
        empty: true,
        path: "/Users/test/code/existing",
      });
      // empty is checked before path in the function
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("my-empty");
      expect(result.data!.path).toBe(emptyTarget);
    });
  });

  // ===========================================================================
  // Store persistence checks
  // ===========================================================================

  describe("store persistence for clone with targetDir", () => {
    it("should persist project to store after successful clone with targetDir", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === "/tmp/target-dir") return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/target-dir",
      });
      expect(result.success).toBe(true);

      // Verify writeFileSync was called to persist
      expect(writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(writeFileSync).mock.calls[0];
      const savedStore = JSON.parse(writeCall[1] as string) as ProjectsStore;
      expect(savedStore.projects).toHaveLength(1);
      expect(savedStore.projects[0].path).toBe("/tmp/target-dir");
      expect(savedStore.projects[0].gitRemote).toBe("git@github.com:user/repo.git");
    });

    it("should NOT persist project when clone fails", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        return false;
      });
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("clone failed");
      });

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/target-dir",
      });
      expect(result.success).toBe(false);

      // writeFileSync should NOT have been called (no store save on failure)
      expect(writeFileSync).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // nameFromCloneUrl extraction
  // ===========================================================================

  describe("name extraction from clone URL", () => {
    it("should extract name from GitHub SSH URL", () => {
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "adjutant");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:org/adjutant.git",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("adjutant");
    });

    it("should extract name from GitHub HTTPS URL with .git suffix", () => {
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "my-project");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "https://github.com/user/my-project.git",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("my-project");
    });

    it("should extract name from URL without .git suffix", () => {
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "bare-name");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "https://github.com/user/bare-name",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("bare-name");
    });

    it("should use custom name over URL-derived name", () => {
      mockNoStore();
      const defaultTarget = join(DEFAULT_PROJECTS_BASE, "custom");
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        if (ps === defaultTarget) return false;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:org/original-name.git",
        name: "custom",
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe("custom");
      // Default path uses the custom name, not the URL-derived name
      expect(result.data!.path).toBe(defaultTarget);
    });
  });

  // ===========================================================================
  // Project metadata correctness
  // ===========================================================================

  describe("project metadata correctness", () => {
    it("should set mode to 'swarm' for cloned projects", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      expect(result.data!.mode).toBe("swarm");
    });

    it("should set active to false for cloned projects", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      expect(result.data!.active).toBe(false);
    });

    it("should set empty sessions array for cloned projects", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      expect(result.data!.sessions).toEqual([]);
    });

    it("should set createdAt to a valid ISO date string", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        return false;
      });
      vi.mocked(execFileSync).mockReturnValue("");

      const result = createProject({
        cloneUrl: "git@github.com:user/repo.git",
        targetDir: "/tmp/test",
      });
      expect(result.success).toBe(true);
      // createdAt should be a valid ISO date
      const parsed = new Date(result.data!.createdAt);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it("should generate a UUID-based ID", () => {
      mockNoStore();
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps === ADJUTANT_DIR) return true;
        return false;
      });
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
