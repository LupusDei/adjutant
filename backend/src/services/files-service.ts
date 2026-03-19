/**
 * File browsing service for project directory access.
 *
 * Provides directory listing and file reading within registered project
 * directories. All paths are validated to prevent path traversal attacks.
 *
 * @module services/files-service
 */

import { readdir, readFile as fsReadFile, stat, lstat } from "fs/promises";
import { join, resolve, relative, extname, basename } from "path";

import { getProject } from "./projects-service.js";
import type { ProjectsServiceResult } from "./projects-service.js";

// ============================================================================
// Types
// ============================================================================

export interface DirectoryEntry {
  name: string;
  /** Relative to project root */
  path: string;
  type: "file" | "directory";
  /** Bytes (0 for directories) */
  size: number;
  /** ISO 8601 */
  lastModified: string;
}

export interface FileContent {
  /** Relative to project root */
  path: string;
  content: string;
  size: number;
  /** e.g. "text/markdown", "text/plain" */
  mimeType: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Max file size to read (1MB) */
const MAX_FILE_SIZE = 1024 * 1024;

/** Directories to skip when listing */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".beads",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".claude",
]);

/** Text file extensions we serve */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".html",
  ".swift",
  ".py",
  ".sh",
  // Additional common extensions (adj-fnhh)
  ".rs",
  ".go",
  ".rb",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".xml",
  ".svg",
  ".sql",
  ".graphql",
  ".proto",
  ".env",
  ".cfg",
  ".ini",
  ".conf",
  ".r",
  ".lua",
  ".zig",
  ".dockerfile",
  ".gitignore",
  ".editorconfig",
  ".vue",
  ".svelte",
]);

/** Known extensionless text files (adj-fnhh) */
const TEXT_FILENAMES = new Set([
  "Makefile",
  "Dockerfile",
  "LICENSE",
  "README",
  "CHANGELOG",
  "Gemfile",
  "Rakefile",
  "Procfile",
  ".gitignore",
  ".env.example",
  ".editorconfig",
]);

/** Map of file extension to MIME type */
const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".json": "application/json",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/toml",
  ".css": "text/css",
  ".html": "text/html",
  ".swift": "text/x-swift",
  ".py": "text/x-python",
  ".sh": "text/x-shellscript",
  // Additional MIME types (adj-fnhh)
  ".rs": "text/x-rust",
  ".go": "text/x-go",
  ".rb": "text/x-ruby",
  ".java": "text/x-java",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c",
  ".hpp": "text/x-c++",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".sql": "text/x-sql",
  ".graphql": "text/x-graphql",
  ".proto": "text/x-protobuf",
  ".env": "text/plain",
  ".cfg": "text/plain",
  ".ini": "text/plain",
  ".conf": "text/plain",
  ".r": "text/x-r",
  ".lua": "text/x-lua",
  ".zig": "text/x-zig",
  ".dockerfile": "text/x-dockerfile",
  ".gitignore": "text/plain",
  ".editorconfig": "text/plain",
  ".vue": "text/x-vue",
  ".svelte": "text/x-svelte",
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if any component in the path from projectPath to fullPath is a symlink.
 * Prevents symlink-based path traversal attacks (adj-yil2).
 */
async function containsSymlink(projectPath: string, fullPath: string): Promise<boolean> {
  const rel = relative(projectPath, fullPath);
  if (!rel) return false;
  const parts = rel.split("/");
  let current = projectPath;
  for (const part of parts) {
    current = join(current, part);
    try {
      const st = await lstat(current);
      if (st.isSymbolicLink()) return true;
    } catch {
      break;
    }
  }
  return false;
}

/**
 * Validate that a path is safely within a registered project directory.
 * Prevents path traversal attacks.
 */
function validateProjectPath(
  projectId: string,
  relativePath: string,
): { projectPath: string; fullPath: string } | { error: string } {
  // adj-eual: reject null bytes
  if (relativePath.includes("\0")) {
    return { error: "Invalid path: null bytes not allowed" };
  }

  const projectResult = getProject(projectId);
  if (!projectResult.success || !projectResult.data) {
    return { error: `Project '${projectId}' not found` };
  }

  const projectPath = projectResult.data.path;
  const fullPath = resolve(projectPath, relativePath || ".");

  // Security: ensure resolved path is within project directory
  if (!fullPath.startsWith(projectPath)) {
    return { error: "Path traversal not allowed" };
  }

  return { projectPath, fullPath };
}

/**
 * Get MIME type for a file extension.
 */
function getMimeType(ext: string): string {
  return MIME_TYPES[ext] ?? "text/plain";
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * List directory contents within a project.
 *
 * Returns entries sorted: directories first, then files, each group alphabetical.
 * Skips directories in SKIP_DIRS (node_modules, .git, .beads, etc.).
 */
export async function listDirectory(
  projectId: string,
  relativePath: string = "",
): Promise<ProjectsServiceResult<DirectoryEntry[]>> {
  const validation = validateProjectPath(projectId, relativePath);
  if ("error" in validation) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: validation.error },
    };
  }

  const { projectPath, fullPath } = validation;

  // adj-yil2: reject symlinks in the path
  if (await containsSymlink(projectPath, fullPath)) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Symlinks are not allowed in path" },
    };
  }

  try {
    // Check existence via stat (adj-kxgu: async)
    let pathStat;
    try {
      pathStat = await stat(fullPath);
    } catch {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Directory not found: ${relativePath || "/"}`,
        },
      };
    }

    // adj-byj9: verify the path is a directory
    if (!pathStat.isDirectory()) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Path is not a directory: ${relativePath || "/"}`,
        },
      };
    }

    const entries = await readdir(fullPath);
    const results: DirectoryEntry[] = [];

    for (const name of entries) {
      // Skip directories in SKIP_DIRS (e.g. .git, node_modules)
      // adj-116: dotfiles are now shown — config files like .env, .gitignore, .mcp.json
      // are important and were previously invisible in the project file browser
      if (SKIP_DIRS.has(name)) continue;

      const entryFullPath = join(fullPath, name);

      try {
        const entryStat = await stat(entryFullPath);
        const entryRelPath = relative(projectPath, entryFullPath);

        results.push({
          name,
          path: entryRelPath,
          type: entryStat.isDirectory() ? "directory" : "file",
          size: entryStat.isDirectory() ? 0 : entryStat.size,
          lastModified: entryStat.mtime.toISOString(),
        });
      } catch {
        // Skip entries we can't stat (permission issues, etc.)
        continue;
      }
    }

    // Sort: directories first, then alphabetically within each group
    results.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return { success: true, data: results };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to list directory";
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message },
    };
  }
}

/**
 * Read a file's content within a project.
 *
 * Validates that the file:
 * - Is within the project directory (no path traversal)
 * - Does not traverse through symlinks
 * - Exists and is a regular file
 * - Is within the size limit (1MB)
 * - Has a supported text extension or known text filename
 */
export async function readFile(
  projectId: string,
  relativePath: string,
): Promise<ProjectsServiceResult<FileContent>> {
  const validation = validateProjectPath(projectId, relativePath);
  if ("error" in validation) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: validation.error },
    };
  }

  const { projectPath, fullPath } = validation;

  // adj-yil2: reject symlinks in the path
  if (await containsSymlink(projectPath, fullPath)) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Symlinks are not allowed in path" },
    };
  }

  try {
    // Check existence via stat (adj-kxgu: async)
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `File not found: ${relativePath}`,
        },
      };
    }

    if (!fileStat.isFile()) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Path is not a file: ${relativePath}`,
        },
      };
    }

    if (fileStat.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `File too large: ${relativePath} (${fileStat.size} bytes, max ${MAX_FILE_SIZE})`,
        },
      };
    }

    // adj-fnhh: check both extension and known extensionless filenames
    const ext = extname(relativePath).toLowerCase();
    const fileName = basename(relativePath);
    if (!TEXT_EXTENSIONS.has(ext) && !TEXT_FILENAMES.has(fileName)) {
      return {
        success: false,
        error: {
          // adj-wyvo: use UNSUPPORTED_TYPE instead of VALIDATION_ERROR
          code: "UNSUPPORTED_TYPE",
          message: `File type not supported: ${ext || "(no extension)"}`,
        },
      };
    }

    const content = await fsReadFile(fullPath, "utf8");

    return {
      success: true,
      data: {
        path: relativePath,
        content,
        size: fileStat.size,
        mimeType: getMimeType(ext),
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read file";
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message },
    };
  }
}
