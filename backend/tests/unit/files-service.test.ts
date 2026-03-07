import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

// Mock projects-service
vi.mock("../../src/services/projects-service.js", () => ({
  getProject: vi.fn(),
}));

// Mock logger utils
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
}));

import { listDirectory, readFile } from "../../src/services/files-service.js";
import { getProject } from "../../src/services/projects-service.js";
import type { ProjectsServiceResult, Project } from "../../src/services/projects-service.js";

const PROJECT_PATH = "/Users/test/code/my-project";
const MOCK_PROJECT: Project = {
  id: "proj-1",
  name: "my-project",
  path: PROJECT_PATH,
  mode: "swarm",
  sessions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  active: true,
};

function mockProjectExists(): void {
  vi.mocked(getProject).mockReturnValue({
    success: true,
    data: MOCK_PROJECT,
  } as ProjectsServiceResult<Project>);
}

function mockProjectNotFound(): void {
  vi.mocked(getProject).mockReturnValue({
    success: false,
    error: { code: "NOT_FOUND", message: "Project 'nonexistent' not found" },
  } as ProjectsServiceResult<Project>);
}

describe("files-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // listDirectory
  // ===========================================================================

  describe("listDirectory", () => {
    it("should list directory contents for a valid project and path", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        "README.md",
        "src",
        "package.json",
      ] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps.endsWith("/src")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as ReturnType<typeof statSync>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 1024,
          mtime: new Date("2026-01-15T10:00:00.000Z"),
        } as unknown as ReturnType<typeof statSync>;
      });

      const result = listDirectory("proj-1", "");
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Directories should come first
      const names = result.data!.map((e) => e.name);
      expect(names[0]).toBe("src");

      // Should contain expected entries
      expect(names).toContain("README.md");
      expect(names).toContain("package.json");
      expect(names).toContain("src");
    });

    it("should skip directories in SKIP_DIRS (node_modules, .git, etc)", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        "src",
        "node_modules",
        ".git",
        "dist",
        "README.md",
      ] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps.endsWith("/src") || ps.endsWith("/node_modules") || ps.endsWith("/.git") || ps.endsWith("/dist")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as ReturnType<typeof statSync>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 100,
          mtime: new Date("2026-01-15T10:00:00.000Z"),
        } as unknown as ReturnType<typeof statSync>;
      });

      const result = listDirectory("proj-1", "");
      expect(result.success).toBe(true);
      const names = result.data!.map((e) => e.name);
      expect(names).toContain("src");
      expect(names).toContain("README.md");
      expect(names).not.toContain("node_modules");
      expect(names).not.toContain(".git");
      expect(names).not.toContain("dist");
    });

    it("should skip hidden files (starting with .)", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        "README.md",
        ".env",
        ".gitignore",
        "src",
      ] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps.endsWith("/src")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as ReturnType<typeof statSync>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 100,
          mtime: new Date("2026-01-15T10:00:00.000Z"),
        } as unknown as ReturnType<typeof statSync>;
      });

      const result = listDirectory("proj-1", "");
      expect(result.success).toBe(true);
      const names = result.data!.map((e) => e.name);
      expect(names).toContain("README.md");
      expect(names).toContain("src");
      expect(names).not.toContain(".env");
      expect(names).not.toContain(".gitignore");
    });

    it("should reject path traversal attempts", () => {
      mockProjectExists();

      const result = listDirectory("proj-1", "../../etc");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Path traversal");
    });

    it("should return NOT_FOUND for non-existent directory", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(false);

      const result = listDirectory("proj-1", "nonexistent/path");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });

    it("should return error for non-existent project", () => {
      mockProjectNotFound();

      const result = listDirectory("nonexistent", "");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("not found");
    });

    it("should return entries with correct type, size, and path", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        "spec.md",
      ] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 2048,
        mtime: new Date("2026-03-01T12:00:00.000Z"),
      } as unknown as ReturnType<typeof statSync>);

      const result = listDirectory("proj-1", "specs");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);

      const entry = result.data![0]!;
      expect(entry.name).toBe("spec.md");
      expect(entry.type).toBe("file");
      expect(entry.size).toBe(2048);
      expect(entry.path).toBe("specs/spec.md");
      expect(entry.lastModified).toBe("2026-03-01T12:00:00.000Z");
    });

    it("should sort entries: directories first, then alphabetically", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        "zebra.txt",
        "alpha",
        "banana.md",
        "charlie",
      ] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((p: unknown) => {
        const ps = String(p);
        if (ps.endsWith("/alpha") || ps.endsWith("/charlie")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-01T00:00:00.000Z"),
          } as unknown as ReturnType<typeof statSync>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 100,
          mtime: new Date("2026-01-01T00:00:00.000Z"),
        } as unknown as ReturnType<typeof statSync>;
      });

      const result = listDirectory("proj-1", "");
      expect(result.success).toBe(true);
      const names = result.data!.map((e) => e.name);
      // Dirs first (alpha, charlie), then files (banana.md, zebra.txt)
      expect(names).toEqual(["alpha", "charlie", "banana.md", "zebra.txt"]);
    });
  });

  // ===========================================================================
  // readFile
  // ===========================================================================

  describe("readFile", () => {
    it("should read a valid text file", () => {
      mockProjectExists();

      const filePath = join(PROJECT_PATH, "README.md");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 256,
      } as unknown as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue("# Hello World\n\nThis is a readme.");

      const result = readFile("proj-1", "README.md");
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe("README.md");
      expect(result.data!.content).toBe("# Hello World\n\nThis is a readme.");
      expect(result.data!.size).toBe(256);
      expect(result.data!.mimeType).toBe("text/markdown");
    });

    it("should reject path traversal attempts", () => {
      mockProjectExists();

      const result = readFile("proj-1", "../../../etc/passwd");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Path traversal");
    });

    it("should return NOT_FOUND for non-existent file", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(false);

      const result = readFile("proj-1", "does-not-exist.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });

    it("should reject files that are too large", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 2 * 1024 * 1024, // 2MB, exceeds 1MB limit
      } as unknown as ReturnType<typeof statSync>);

      const result = readFile("proj-1", "huge-file.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("too large");
    });

    it("should reject unsupported file extensions", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
      } as unknown as ReturnType<typeof statSync>);

      const result = readFile("proj-1", "image.png");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("not supported");
    });

    it("should return error for non-existent project", () => {
      mockProjectNotFound();

      const result = readFile("nonexistent", "README.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("not found");
    });

    it("should return correct mimeType for different extensions", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as unknown as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue("content");

      // Test .ts
      const tsResult = readFile("proj-1", "index.ts");
      expect(tsResult.success).toBe(true);
      expect(tsResult.data!.mimeType).toBe("text/typescript");

      // Test .json
      const jsonResult = readFile("proj-1", "package.json");
      expect(jsonResult.success).toBe(true);
      expect(jsonResult.data!.mimeType).toBe("application/json");

      // Test .txt
      const txtResult = readFile("proj-1", "notes.txt");
      expect(txtResult.success).toBe(true);
      expect(txtResult.data!.mimeType).toBe("text/plain");

      // Test .yaml
      const yamlResult = readFile("proj-1", "config.yaml");
      expect(yamlResult.success).toBe(true);
      expect(yamlResult.data!.mimeType).toBe("text/yaml");
    });

    it("should reject reading a directory path", () => {
      mockProjectExists();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
        size: 0,
      } as unknown as ReturnType<typeof statSync>);

      const result = readFile("proj-1", "src");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("not a file");
    });

    it("should handle resolved path that escapes via symlink-like traversal", () => {
      // Even if the relative path looks safe, the resolved path must be within project
      mockProjectExists();

      // This tests that resolve() catches traversal even with odd path segments
      const result = readFile("proj-1", "foo/../../../../../../etc/passwd");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Path traversal");
    });
  });
});
