/**
 * File browsing service for project directory access.
 *
 * Provides directory listing and file reading within registered project
 * directories. All paths are validated to prevent path traversal attacks.
 *
 * @module services/files-service
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve, relative, extname } from "path";

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
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate that a path is safely within a registered project directory.
 * Prevents path traversal attacks.
 */
function validateProjectPath(
  projectId: string,
  relativePath: string,
): { projectPath: string; fullPath: string } | { error: string } {
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
 * Skips hidden files (starting with .) and directories in SKIP_DIRS.
 */
export function listDirectory(
  projectId: string,
  relativePath: string = "",
): ProjectsServiceResult<DirectoryEntry[]> {
  const validation = validateProjectPath(projectId, relativePath);
  if ("error" in validation) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: validation.error },
    };
  }

  const { projectPath, fullPath } = validation;

  if (!existsSync(fullPath)) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Directory not found: ${relativePath || "/"}`,
      },
    };
  }

  try {
    const entries = readdirSync(fullPath);
    const results: DirectoryEntry[] = [];

    for (const name of entries) {
      // Skip hidden files and directories in SKIP_DIRS
      if (name.startsWith(".")) continue;
      if (SKIP_DIRS.has(name)) continue;

      const entryFullPath = join(fullPath, name);

      try {
        const stat = statSync(entryFullPath);
        const entryRelPath = relative(projectPath, entryFullPath);

        results.push({
          name,
          path: entryRelPath,
          type: stat.isDirectory() ? "directory" : "file",
          size: stat.isDirectory() ? 0 : stat.size,
          lastModified: stat.mtime.toISOString(),
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
 * - Exists and is a regular file
 * - Is within the size limit (1MB)
 * - Has a supported text extension
 */
export function readFile(
  projectId: string,
  relativePath: string,
): ProjectsServiceResult<FileContent> {
  const validation = validateProjectPath(projectId, relativePath);
  if ("error" in validation) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: validation.error },
    };
  }

  const { fullPath } = validation;

  if (!existsSync(fullPath)) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `File not found: ${relativePath}`,
      },
    };
  }

  try {
    const stat = statSync(fullPath);

    if (!stat.isFile()) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Path is not a file: ${relativePath}`,
        },
      };
    }

    if (stat.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `File too large: ${relativePath} (${stat.size} bytes, max ${MAX_FILE_SIZE})`,
        },
      };
    }

    const ext = extname(relativePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `File type not supported: ${ext || "(no extension)"}`,
        },
      };
    }

    const content = readFileSync(fullPath, "utf8");

    return {
      success: true,
      data: {
        path: relativePath,
        content,
        size: stat.size,
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
