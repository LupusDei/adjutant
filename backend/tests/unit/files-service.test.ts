import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdir, readFile as fsReadFile, stat, lstat } from "fs/promises";
import { join, resolve } from "path";

// Mock fs/promises (adj-kxgu: async fs)
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
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

/** Helper: mock lstat to report no symlinks */
function mockNoSymlinks(): void {
  vi.mocked(lstat).mockResolvedValue({
    isSymbolicLink: () => false,
  } as unknown as Awaited<ReturnType<typeof lstat>>);
}

describe("files-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no symlinks in path
    mockNoSymlinks();
  });

  // ===========================================================================
  // listDirectory
  // ===========================================================================

  describe("listDirectory", () => {
    it("should list directory contents for a valid project and path", async () => {
      mockProjectExists();

      vi.mocked(stat).mockImplementation(async (p: unknown) => {
        const ps = String(p);
        // First call is for the directory check
        if (ps === resolve(PROJECT_PATH, "")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        if (ps.endsWith("/src")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 1024,
          mtime: new Date("2026-01-15T10:00:00.000Z"),
        } as unknown as Awaited<ReturnType<typeof stat>>;
      });

      vi.mocked(readdir).mockResolvedValue([
        "README.md",
        "src",
        "package.json",
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await listDirectory("proj-1", "");
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

    it("should skip directories in SKIP_DIRS (node_modules, .git, etc)", async () => {
      mockProjectExists();

      vi.mocked(stat).mockImplementation(async (p: unknown) => {
        const ps = String(p);
        if (ps === PROJECT_PATH) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        if (ps.endsWith("/src") || ps.endsWith("/node_modules") || ps.endsWith("/.git") || ps.endsWith("/dist")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 100,
          mtime: new Date("2026-01-15T10:00:00.000Z"),
        } as unknown as Awaited<ReturnType<typeof stat>>;
      });

      vi.mocked(readdir).mockResolvedValue([
        "src",
        "node_modules",
        ".git",
        "dist",
        "README.md",
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await listDirectory("proj-1", "");
      expect(result.success).toBe(true);
      const names = result.data!.map((e) => e.name);
      expect(names).toContain("src");
      expect(names).toContain("README.md");
      expect(names).not.toContain("node_modules");
      expect(names).not.toContain(".git");
      expect(names).not.toContain("dist");
    });

    it("should skip hidden files (starting with .)", async () => {
      mockProjectExists();

      vi.mocked(stat).mockImplementation(async (p: unknown) => {
        const ps = String(p);
        if (ps === PROJECT_PATH) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        if (ps.endsWith("/src")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-15T10:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 100,
          mtime: new Date("2026-01-15T10:00:00.000Z"),
        } as unknown as Awaited<ReturnType<typeof stat>>;
      });

      vi.mocked(readdir).mockResolvedValue([
        "README.md",
        ".env",
        ".gitignore",
        "src",
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await listDirectory("proj-1", "");
      expect(result.success).toBe(true);
      const names = result.data!.map((e) => e.name);
      expect(names).toContain("README.md");
      expect(names).toContain("src");
      expect(names).not.toContain(".env");
      expect(names).not.toContain(".gitignore");
    });

    it("should reject path traversal attempts", async () => {
      mockProjectExists();

      const result = await listDirectory("proj-1", "../../etc");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Path traversal");
    });

    it("should return NOT_FOUND for non-existent directory", async () => {
      mockProjectExists();

      vi.mocked(stat).mockRejectedValue(new Error("ENOENT: no such file or directory"));

      const result = await listDirectory("proj-1", "nonexistent/path");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });

    it("should return error for non-existent project", async () => {
      mockProjectNotFound();

      const result = await listDirectory("nonexistent", "");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("not found");
    });

    it("should return entries with correct type, size, and path", async () => {
      mockProjectExists();

      vi.mocked(stat).mockImplementation(async (p: unknown) => {
        const ps = String(p);
        if (ps === resolve(PROJECT_PATH, "specs")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-03-01T12:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 2048,
          mtime: new Date("2026-03-01T12:00:00.000Z"),
        } as unknown as Awaited<ReturnType<typeof stat>>;
      });

      vi.mocked(readdir).mockResolvedValue([
        "spec.md",
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await listDirectory("proj-1", "specs");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);

      const entry = result.data![0]!;
      expect(entry.name).toBe("spec.md");
      expect(entry.type).toBe("file");
      expect(entry.size).toBe(2048);
      expect(entry.path).toBe("specs/spec.md");
      expect(entry.lastModified).toBe("2026-03-01T12:00:00.000Z");
    });

    it("should sort entries: directories first, then alphabetically", async () => {
      mockProjectExists();

      vi.mocked(stat).mockImplementation(async (p: unknown) => {
        const ps = String(p);
        if (ps === PROJECT_PATH) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-01T00:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        if (ps.endsWith("/alpha") || ps.endsWith("/charlie")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date("2026-01-01T00:00:00.000Z"),
          } as unknown as Awaited<ReturnType<typeof stat>>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 100,
          mtime: new Date("2026-01-01T00:00:00.000Z"),
        } as unknown as Awaited<ReturnType<typeof stat>>;
      });

      vi.mocked(readdir).mockResolvedValue([
        "zebra.txt",
        "alpha",
        "banana.md",
        "charlie",
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await listDirectory("proj-1", "");
      expect(result.success).toBe(true);
      const names = result.data!.map((e) => e.name);
      // Dirs first (alpha, charlie), then files (banana.md, zebra.txt)
      expect(names).toEqual(["alpha", "charlie", "banana.md", "zebra.txt"]);
    });

    // adj-eual: null byte injection
    it("should reject paths containing null bytes", async () => {
      mockProjectExists();

      const result = await listDirectory("proj-1", "foo\0bar");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("null bytes");
    });

    // adj-byj9: non-directory path
    it("should reject listing a file path (not a directory)", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 1024,
        mtime: new Date("2026-01-01T00:00:00.000Z"),
      } as unknown as Awaited<ReturnType<typeof stat>>);

      const result = await listDirectory("proj-1", "README.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("not a directory");
    });

    // adj-yil2: symlink traversal
    it("should reject paths containing symlinks", async () => {
      mockProjectExists();

      // Override the default no-symlinks mock
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as unknown as Awaited<ReturnType<typeof lstat>>);

      const result = await listDirectory("proj-1", "evil-link");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Symlinks");
    });
  });

  // ===========================================================================
  // readFile
  // ===========================================================================

  describe("readFile", () => {
    it("should read a valid text file", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 256,
      } as unknown as Awaited<ReturnType<typeof stat>>);
      vi.mocked(fsReadFile).mockResolvedValue("# Hello World\n\nThis is a readme.");

      const result = await readFile("proj-1", "README.md");
      expect(result.success).toBe(true);
      expect(result.data!.path).toBe("README.md");
      expect(result.data!.content).toBe("# Hello World\n\nThis is a readme.");
      expect(result.data!.size).toBe(256);
      expect(result.data!.mimeType).toBe("text/markdown");
    });

    it("should reject path traversal attempts", async () => {
      mockProjectExists();

      const result = await readFile("proj-1", "../../../etc/passwd");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Path traversal");
    });

    it("should return NOT_FOUND for non-existent file", async () => {
      mockProjectExists();

      vi.mocked(stat).mockRejectedValue(new Error("ENOENT: no such file or directory"));

      const result = await readFile("proj-1", "does-not-exist.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("NOT_FOUND");
    });

    it("should reject files that are too large", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 2 * 1024 * 1024, // 2MB, exceeds 1MB limit
      } as unknown as Awaited<ReturnType<typeof stat>>);

      const result = await readFile("proj-1", "huge-file.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("too large");
    });

    it("should reject unsupported file extensions with UNSUPPORTED_TYPE code", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
      } as unknown as Awaited<ReturnType<typeof stat>>);

      const result = await readFile("proj-1", "image.png");
      expect(result.success).toBe(false);
      // adj-wyvo: should use UNSUPPORTED_TYPE, not VALIDATION_ERROR
      expect(result.error!.code).toBe("UNSUPPORTED_TYPE");
      expect(result.error!.message).toContain("not supported");
    });

    it("should return error for non-existent project", async () => {
      mockProjectNotFound();

      const result = await readFile("nonexistent", "README.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("not found");
    });

    it("should return correct mimeType for different extensions", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as unknown as Awaited<ReturnType<typeof stat>>);
      vi.mocked(fsReadFile).mockResolvedValue("content");

      // Test .ts
      const tsResult = await readFile("proj-1", "index.ts");
      expect(tsResult.success).toBe(true);
      expect(tsResult.data!.mimeType).toBe("text/typescript");

      // Test .json
      const jsonResult = await readFile("proj-1", "package.json");
      expect(jsonResult.success).toBe(true);
      expect(jsonResult.data!.mimeType).toBe("application/json");

      // Test .txt
      const txtResult = await readFile("proj-1", "notes.txt");
      expect(txtResult.success).toBe(true);
      expect(txtResult.data!.mimeType).toBe("text/plain");

      // Test .yaml
      const yamlResult = await readFile("proj-1", "config.yaml");
      expect(yamlResult.success).toBe(true);
      expect(yamlResult.data!.mimeType).toBe("text/yaml");
    });

    it("should reject reading a directory path", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true,
        size: 0,
      } as unknown as Awaited<ReturnType<typeof stat>>);

      const result = await readFile("proj-1", "src");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("not a file");
    });

    it("should handle resolved path that escapes via symlink-like traversal", async () => {
      // Even if the relative path looks safe, the resolved path must be within project
      mockProjectExists();

      // This tests that resolve() catches traversal even with odd path segments
      const result = await readFile("proj-1", "foo/../../../../../../etc/passwd");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Path traversal");
    });

    // adj-eual: null byte injection
    it("should reject paths containing null bytes", async () => {
      mockProjectExists();

      const result = await readFile("proj-1", "foo\0bar.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("null bytes");
    });

    // adj-yil2: symlink traversal
    it("should reject paths containing symlinks", async () => {
      mockProjectExists();

      // Override the default no-symlinks mock
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as unknown as Awaited<ReturnType<typeof lstat>>);

      const result = await readFile("proj-1", "evil-link/secret.md");
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("VALIDATION_ERROR");
      expect(result.error!.message).toContain("Symlinks");
    });

    // adj-fnhh: known extensionless text filenames
    it("should allow reading known extensionless text files (Makefile, Dockerfile, etc)", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as unknown as Awaited<ReturnType<typeof stat>>);
      vi.mocked(fsReadFile).mockResolvedValue("all: build\n\nbuild:\n\tgcc -o main main.c");

      const makefileResult = await readFile("proj-1", "Makefile");
      expect(makefileResult.success).toBe(true);
      expect(makefileResult.data!.path).toBe("Makefile");
      expect(makefileResult.data!.mimeType).toBe("text/plain");

      const dockerfileResult = await readFile("proj-1", "Dockerfile");
      expect(dockerfileResult.success).toBe(true);

      const licenseResult = await readFile("proj-1", "LICENSE");
      expect(licenseResult.success).toBe(true);
    });

    // adj-fnhh: new extensions
    it("should allow reading files with newly added extensions (.rs, .go, .java, etc)", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
      } as unknown as Awaited<ReturnType<typeof stat>>);
      vi.mocked(fsReadFile).mockResolvedValue("fn main() {}");

      const rsResult = await readFile("proj-1", "main.rs");
      expect(rsResult.success).toBe(true);
      expect(rsResult.data!.mimeType).toBe("text/x-rust");

      const goResult = await readFile("proj-1", "main.go");
      expect(goResult.success).toBe(true);
      expect(goResult.data!.mimeType).toBe("text/x-go");

      const javaResult = await readFile("proj-1", "Main.java");
      expect(javaResult.success).toBe(true);
      expect(javaResult.data!.mimeType).toBe("text/x-java");

      const sqlResult = await readFile("proj-1", "schema.sql");
      expect(sqlResult.success).toBe(true);
      expect(sqlResult.data!.mimeType).toBe("text/x-sql");

      const xmlResult = await readFile("proj-1", "config.xml");
      expect(xmlResult.success).toBe(true);
      expect(xmlResult.data!.mimeType).toBe("application/xml");

      const cResult = await readFile("proj-1", "main.c");
      expect(cResult.success).toBe(true);
      expect(cResult.data!.mimeType).toBe("text/x-c");

      const luaResult = await readFile("proj-1", "init.lua");
      expect(luaResult.success).toBe(true);
      expect(luaResult.data!.mimeType).toBe("text/x-lua");
    });

    // adj-fnhh: .env extension
    it("should allow reading .env and .cfg config files", async () => {
      mockProjectExists();

      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 50,
      } as unknown as Awaited<ReturnType<typeof stat>>);
      vi.mocked(fsReadFile).mockResolvedValue("KEY=value");

      const envResult = await readFile("proj-1", "settings.env");
      expect(envResult.success).toBe(true);

      const cfgResult = await readFile("proj-1", "settings.cfg");
      expect(cfgResult.success).toBe(true);

      const iniResult = await readFile("proj-1", "settings.ini");
      expect(iniResult.success).toBe(true);

      const confResult = await readFile("proj-1", "nginx.conf");
      expect(confResult.success).toBe(true);
    });
  });
});
