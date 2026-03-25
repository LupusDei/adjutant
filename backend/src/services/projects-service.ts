/**
 * Projects service for managing project registrations.
 *
 * Persists projects to SQLite (projects table).
 * Supports create (from path, clone URL, or empty), list, activate, and delete.
 *
 * @module services/projects-service
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { join, resolve, basename } from "path";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { logInfo, logError, logDebug } from "../utils/index.js";
import { getDatabase } from "./database.js";

// ============================================================================
// Types
// ============================================================================

export interface Project {
  id: string;
  name: string;
  path: string;
  gitRemote?: string | undefined;
  mode: "swarm";
  sessions: string[];
  createdAt: string;
  active: boolean;
  /** Whether this project has a .beads/ directory */
  hasBeads?: boolean | undefined;
  /** Whether auto-develop mode is enabled for this project */
  autoDevelop: boolean;
  /** ISO timestamp when auto-develop was paused, if paused */
  autoDevelopPausedAt?: string | undefined;
  /** Vision context text for auto-develop AI generation */
  visionContext?: string | undefined;
}

export interface ProjectsStore {
  projects: Project[];
}

/** @deprecated Use ServiceResult<T> from types/service-result.js */
import type { ServiceResult } from "../types/service-result.js";
export type ProjectsServiceResult<T> = ServiceResult<T>;

export interface CreateProjectInput {
  path?: string | undefined;
  cloneUrl?: string | undefined;
  name?: string | undefined;
  empty?: boolean | undefined;
  /** Target directory for clone operations. Overrides default ~/projects/<name>. */
  targetDir?: string | undefined;
}

export interface DiscoverOptions {
  /** Max directory depth to scan (default 1, max 3). Depth 0 = root only. */
  maxDepth?: number | undefined;
}

export interface ProjectHealth {
  projectId: string;
  pathExists: boolean;
  hasGit: boolean;
  hasBeads: boolean;
  /** Git remote URL, if available */
  gitRemote?: string | undefined;
  /** Overall health: "healthy" if path + git exist, "stale" if path missing, "degraded" if path exists but git missing */
  status: "healthy" | "degraded" | "stale";
}

// ============================================================================
// SQL Row Type
// ============================================================================

/** Shape of a row from the projects table. */
interface ProjectRow {
  id: string;
  name: string;
  path: string;
  git_remote: string | null;
  mode: string;
  created_at: string;
  active: number;
  auto_develop: number;
  auto_develop_paused_at: string | null;
  vision_context: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PROJECTS_BASE = join(homedir(), "projects");
const DEFAULT_SCAN_DEPTH = 1;
const MAX_SCAN_DEPTH = 3;
const SKIP_DIRS = new Set(["node_modules", ".git", ".beads", "dist", "build", ".next", "__pycache__"]);

// ============================================================================
// hasBeads Cache (adj-110.2.6)
// ============================================================================

/** TTL cache for hasBeadsDb() to avoid O(3N) blocking existsSync per listProjects call. */
const hasBeadsCache = new Map<string, { value: boolean; expires: number }>();
const HAS_BEADS_TTL_MS = 10_000; // 10 seconds

function hasBeadsCached(dirPath: string): boolean {
  const now = Date.now();
  const cached = hasBeadsCache.get(dirPath);
  if (cached && cached.expires > now) return cached.value;

  const value = hasBeadsDb(dirPath);
  hasBeadsCache.set(dirPath, { value, expires: now + HAS_BEADS_TTL_MS });
  return value;
}

// ============================================================================
// Row Mapping
// ============================================================================

/**
 * Map a SQLite row to the Project interface.
 * hasBeads is computed on read (with TTL cache), not stored.
 * sessions is always [] — the column was removed in migration 023.
 */
function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    gitRemote: row.git_remote ?? undefined,
    mode: "swarm",
    sessions: [],
    createdAt: row.created_at,
    active: row.active === 1,
    hasBeads: hasBeadsCached(row.path),
    autoDevelop: row.auto_develop === 1,
    autoDevelopPausedAt: row.auto_develop_paused_at ?? undefined,
    visionContext: row.vision_context ?? undefined,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function detectGitRemote(dirPath: string): string | undefined {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: dirPath,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return remote || undefined;
  } catch {
    return undefined;
  }
}

function generateId(): string {
  return randomUUID().slice(0, 8);
}

function nameFromPath(dirPath: string): string {
  return basename(resolve(dirPath));
}

/**
 * Expand leading ~ to the user's home directory.
 * Node's path.resolve() does NOT expand ~, unlike shell expansion.
 */
function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function nameFromCloneUrl(url: string): string {
  const match = /\/([^/]+?)(?:\.git)?$/.exec(url);
  return match?.[1] ?? "project";
}

// ============================================================================
// Project Detection Helpers
// ============================================================================

/**
 * Check if a directory contains a beads database.
 * Accepts: beads.db (SQLite), dolt/ (Dolt backend), or config.yaml (minimal signal).
 */
function hasBeadsDb(dirPath: string): boolean {
  const beadsDir = join(dirPath, ".beads");
  return (
    existsSync(join(beadsDir, "beads.db")) ||
    existsSync(join(beadsDir, "dolt")) ||
    existsSync(join(beadsDir, "config.yaml"))
  );
}

/**
 * Check if a directory qualifies as a project.
 * A directory is a project if it has a `.git/` directory OR a `.beads/beads.db`.
 */
function isProjectDir(dirPath: string): boolean {
  return existsSync(join(dirPath, ".git")) || hasBeadsDb(dirPath);
}

/**
 * Recursively scan directories for projects up to maxDepth.
 * Returns absolute paths of discovered project directories.
 */
function scanForProjects(
  rootPath: string,
  maxDepth: number,
  currentDepth = 0,
): string[] {
  if (currentDepth > maxDepth) return [];

  let entries: string[];
  try {
    entries = readdirSync(rootPath);
  } catch {
    return [];
  }

  const found: string[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;

    const childPath = join(rootPath, entry);
    try {
      const stat = statSync(childPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    if (isProjectDir(childPath)) {
      found.push(childPath);
      // Don't recurse into discovered projects — their children are their own concern
    } else if (currentDepth < maxDepth) {
      // Not a project, but may contain projects at deeper levels
      found.push(...scanForProjects(childPath, maxDepth, currentDepth + 1));
    }
  }

  return found;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Discover local projects from the project root directory.
 *
 * Auto-registers:
 * 1. The project root itself (marked as active)
 * 2. Child directories that contain a `.git/` directory or `.beads/beads.db`
 *
 * Detection criteria: A directory is a project if it has `.git/` OR `.beads/beads.db`.
 * The `hasBeads` field is computed on read via `hasBeadsDb(path)`.
 *
 * Skips: node_modules, .git, .beads, dist, build, hidden dirs (`.` prefix), non-directories.
 * De-duplicates against already-registered paths.
 *
 * @param options.maxDepth - How deep to scan (default 1, max 3). Depth 0 = root only.
 */
export function discoverLocalProjects(options?: DiscoverOptions): ProjectsServiceResult<Project[]> {
  try {
    const db = getDatabase();
    const projectRoot = resolve(process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd());
    const requestedDepth = options?.maxDepth ?? DEFAULT_SCAN_DEPTH;
    const maxDepth = Math.min(Math.max(0, requestedDepth), MAX_SCAN_DEPTH);

    const existingRows = db.prepare("SELECT path FROM projects").all() as { path: string }[];
    const existingPaths = new Set(existingRows.map((r) => r.path));
    const discovered: Project[] = [];

    const insertProject = db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, path, git_remote, mode, created_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Register the project root itself if not already registered
    if (!existingPaths.has(projectRoot) && existsSync(projectRoot)) {
      const id = generateId();
      const name = nameFromPath(projectRoot);
      const gitRemote = detectGitRemote(projectRoot);
      const createdAt = new Date().toISOString();

      insertProject.run(id, name, projectRoot, gitRemote ?? null, "swarm", createdAt, 1);
      existingPaths.add(projectRoot);

      const rootProject: Project = {
        id, name, path: projectRoot, gitRemote, mode: "swarm",
        sessions: [], createdAt, active: true, hasBeads: hasBeadsDb(projectRoot),
        autoDevelop: false,
      };
      discovered.push(rootProject);
      logInfo("discovered project root", { id, name, path: projectRoot, hasBeads: rootProject.hasBeads });
    } else {
      // Mark the existing root project as active (and deactivate others)
      const existing = db.prepare("SELECT id, active FROM projects WHERE path = ?").get(projectRoot) as { id: string; active: number } | undefined;
      if (existing?.active === 0) {
        db.transaction(() => {
          db.prepare("UPDATE projects SET active = 0").run();
          db.prepare("UPDATE projects SET active = 1 WHERE path = ?").run(projectRoot);
        })();
      }
    }

    // Scan child directories for projects (git repos or beads repos)
    // maxDepth 0 = root only, no child scan
    if (maxDepth > 0 && existsSync(projectRoot)) {
      const projectPaths = scanForProjects(projectRoot, maxDepth - 1);
      logDebug("project scan complete", { root: projectRoot, maxDepth, found: projectPaths.length });

      const insertBatch = db.transaction(() => {
        for (const childPath of projectPaths) {
          if (existingPaths.has(childPath)) continue;

          const id = generateId();
          const name = nameFromPath(childPath);
          const gitRemote = detectGitRemote(childPath);
          const createdAt = new Date().toISOString();

          insertProject.run(id, name, childPath, gitRemote ?? null, "swarm", createdAt, 0);
          existingPaths.add(childPath);

          const project: Project = {
            id, name, path: childPath, gitRemote, mode: "swarm",
            sessions: [], createdAt, active: false, hasBeads: hasBeadsDb(childPath),
            autoDevelop: false,
          };
          discovered.push(project);
          logInfo("discovered child project", { id, name, path: childPath, hasBeads: project.hasBeads });
        }
      });
      insertBatch();
    }

    return { success: true, data: discovered };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to discover projects";
    logError("discoverLocalProjects failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * List all registered projects.
 * Auto-discovers local projects if the store is empty.
 */
export function listProjects(): ProjectsServiceResult<Project[]> {
  try {
    const db = getDatabase();
    let rows = db.prepare("SELECT * FROM projects").all() as ProjectRow[];

    // Auto-seed on first access if no projects registered
    if (rows.length === 0) {
      discoverLocalProjects();
      rows = db.prepare("SELECT * FROM projects").all() as ProjectRow[];
    }

    return { success: true, data: rows.map(rowToProject) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list projects";
    logError("listProjects failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Get a single project by ID or name.
 *
 * Looks up by UUID first, then falls back to name match. This handles
 * legacy code that stored project names instead of UUIDs (adj-090, adj-138).
 */
export function getProject(idOrName: string): ProjectsServiceResult<Project> {
  try {
    const db = getDatabase();
    // Try UUID first (primary key)
    let row = db.prepare("SELECT * FROM projects WHERE id = ?").get(idOrName) as ProjectRow | undefined;
    // Fall back to name match (handles legacy proposals that stored project name)
    if (!row) {
      row = db.prepare("SELECT * FROM projects WHERE name = ?").get(idOrName) as ProjectRow | undefined;
    }
    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${idOrName}' not found` } };
    }
    return { success: true, data: rowToProject(row) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get project";
    logError("getProject failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Create a new project. Supports three modes:
 * - From existing path: { path: "/abs/path" }
 * - From clone URL: { cloneUrl: "git@...", name?: "myapp" }
 * - Empty project: { name: "new-project", empty: true }
 */
export function createProject(input: CreateProjectInput): ProjectsServiceResult<Project> {
  try {
    if (input.cloneUrl) {
      return createFromClone(input.cloneUrl, input.name, input.targetDir);
    }

    if (input.empty) {
      if (!input.name) {
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Name is required for empty projects" } };
      }
      return createEmpty(input.name);
    }

    if (input.path) {
      return createFromPath(input.path, input.name);
    }

    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Must provide path, cloneUrl, or empty with name" },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create project";
    logError("createProject failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

function createFromPath(dirPath: string, name?: string): ProjectsServiceResult<Project> {
  const db = getDatabase();
  const absPath = resolve(expandTilde(dirPath));

  if (!existsSync(absPath)) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `Path does not exist: ${absPath}` } };
  }

  // Check for duplicate path
  const existing = db.prepare("SELECT id FROM projects WHERE path = ?").get(absPath);
  if (existing) {
    return { success: false, error: { code: "CONFLICT", message: `Project already registered at path: ${absPath}` } };
  }

  const project: Project = {
    id: generateId(),
    name: name ?? nameFromPath(absPath),
    path: absPath,
    gitRemote: detectGitRemote(absPath),
    mode: "swarm",
    sessions: [],
    createdAt: new Date().toISOString(),
    active: false,
    autoDevelop: false,
  };

  db.prepare(`
    INSERT INTO projects (id, name, path, git_remote, mode, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(project.id, project.name, project.path, project.gitRemote ?? null, "swarm", project.createdAt, 0);

  logInfo("project created from path", { id: project.id, name: project.name, path: project.path });
  return { success: true, data: project };
}

function createFromClone(cloneUrl: string, name?: string, inputTargetDir?: string): ProjectsServiceResult<Project> {
  const db = getDatabase();
  const projectName = name ?? nameFromCloneUrl(cloneUrl);
  const targetDir = inputTargetDir
    ? resolve(expandTilde(inputTargetDir))
    : join(DEFAULT_PROJECTS_BASE, projectName);

  if (existsSync(targetDir)) {
    return { success: false, error: { code: "CONFLICT", message: `Directory already exists: ${targetDir}` } };
  }

  // Ensure parent directory exists
  const parentDir = inputTargetDir ? resolve(targetDir, "..") : DEFAULT_PROJECTS_BASE;
  mkdirSync(parentDir, { recursive: true });

  try {
    execFileSync("git", ["clone", cloneUrl, targetDir], {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err instanceof Error ? (err as { stderr?: string }).stderr ?? err.message : "Clone failed";
    return { success: false, error: { code: "CLI_ERROR", message: `Git clone failed: ${stderr}` } };
  }

  const project: Project = {
    id: generateId(),
    name: projectName,
    path: targetDir,
    gitRemote: cloneUrl,
    mode: "swarm",
    sessions: [],
    createdAt: new Date().toISOString(),
    active: false,
    autoDevelop: false,
  };

  db.prepare(`
    INSERT INTO projects (id, name, path, git_remote, mode, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(project.id, project.name, project.path, project.gitRemote ?? null, "swarm", project.createdAt, 0);

  logInfo("project created from clone", { id: project.id, name: project.name, cloneUrl });
  return { success: true, data: project };
}

function createEmpty(name: string): ProjectsServiceResult<Project> {
  const db = getDatabase();
  const targetDir = join(DEFAULT_PROJECTS_BASE, name);

  if (existsSync(targetDir)) {
    return { success: false, error: { code: "CONFLICT", message: `Directory already exists: ${targetDir}` } };
  }

  mkdirSync(targetDir, { recursive: true });

  try {
    execSync("git init", {
      cwd: targetDir,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Non-fatal: directory created but git init failed
  }

  const project: Project = {
    id: generateId(),
    name,
    path: targetDir,
    mode: "swarm",
    sessions: [],
    createdAt: new Date().toISOString(),
    active: false,
    autoDevelop: false,
  };

  db.prepare(`
    INSERT INTO projects (id, name, path, git_remote, mode, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(project.id, project.name, project.path, null, "swarm", project.createdAt, 0);

  logInfo("empty project created", { id: project.id, name: project.name, path: targetDir });
  return { success: true, data: project };
}

/**
 * Get the name of the currently active project.
 * Returns "town" if no project is active (safe default for bead queries).
 */
export function getActiveProjectName(): string {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT name FROM projects WHERE active = 1 LIMIT 1").get() as { name: string } | undefined;
    return row?.name ?? "town";
  } catch {
    return "town";
  }
}

/**
 * Activate a project (mark it as the current active project).
 * Deactivates any previously active project.
 */
export function activateProject(id: string): ProjectsServiceResult<Project> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;

    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    // Deactivate all, activate target (transaction)
    db.transaction(() => {
      db.prepare("UPDATE projects SET active = 0").run();
      db.prepare("UPDATE projects SET active = 1 WHERE id = ?").run(id);
    })();

    logInfo("project activated", { id: row.id, name: row.name });
    return { success: true, data: rowToProject({ ...row, active: 1 }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to activate project";
    logError("activateProject failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Delete a project registration. Does NOT delete files on disk.
 */
export function deleteProject(id: string): ProjectsServiceResult<{ id: string; deleted: boolean }> {
  try {
    const db = getDatabase();
    const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);

    if (result.changes === 0) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    logInfo("project deleted", { id });
    return { success: true, data: { id, deleted: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete project";
    logError("deleteProject failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Check the health of a registered project.
 *
 * Verifies: path exists, .git/ valid, .beads/ present.
 * Returns a health status: "healthy", "degraded", or "stale".
 */
export function checkProjectHealth(id: string): ProjectsServiceResult<ProjectHealth> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    const pathExists = existsSync(row.path);
    const hasGit = pathExists && existsSync(join(row.path, ".git"));
    const beads = pathExists && hasBeadsDb(row.path);

    let status: ProjectHealth["status"];
    if (!pathExists) {
      status = "stale";
    } else if (!hasGit) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    const gitRemote = hasGit ? detectGitRemote(row.path) : undefined;

    return {
      success: true,
      data: { projectId: id, pathExists, hasGit, hasBeads: beads, gitRemote, status },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check project health";
    logError("checkProjectHealth failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

// ============================================================================
// Auto-Develop Functions
// ============================================================================

/**
 * Enable auto-develop mode for a project.
 */
export function enableAutoDevelop(id: string): ProjectsServiceResult<Project> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    db.prepare("UPDATE projects SET auto_develop = 1 WHERE id = ?").run(id);
    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
    logInfo("auto-develop enabled", { id, name: row.name });
    return { success: true, data: rowToProject(updated) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enable auto-develop";
    logError("enableAutoDevelop failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Disable auto-develop mode for a project.
 * Also clears auto_develop_paused_at.
 */
export function disableAutoDevelop(id: string): ProjectsServiceResult<Project> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    db.prepare("UPDATE projects SET auto_develop = 0, auto_develop_paused_at = NULL WHERE id = ?").run(id);
    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
    logInfo("auto-develop disabled", { id, name: row.name });
    return { success: true, data: rowToProject(updated) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to disable auto-develop";
    logError("disableAutoDevelop failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Set the vision context text for auto-develop AI generation.
 */
export function setVisionContext(id: string, context: string): ProjectsServiceResult<Project> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    db.prepare("UPDATE projects SET vision_context = ? WHERE id = ?").run(context, id);
    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
    logInfo("vision context set", { id, name: row.name });
    return { success: true, data: rowToProject(updated) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to set vision context";
    logError("setVisionContext failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Clear the auto-develop pause timestamp.
 */
export function clearAutoDevelopPause(id: string): ProjectsServiceResult<Project> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    db.prepare("UPDATE projects SET auto_develop_paused_at = NULL WHERE id = ?").run(id);
    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
    logInfo("auto-develop pause cleared", { id, name: row.name });
    return { success: true, data: rowToProject(updated) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to clear auto-develop pause";
    logError("clearAutoDevelopPause failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Pause auto-develop mode for a project (sets auto_develop_paused_at to now).
 */
export function pauseAutoDevelop(id: string): ProjectsServiceResult<Project> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    db.prepare("UPDATE projects SET auto_develop_paused_at = datetime('now') WHERE id = ?").run(id);
    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
    logInfo("auto-develop paused", { id, name: row.name });
    return { success: true, data: rowToProject(updated) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to pause auto-develop";
    logError("pauseAutoDevelop failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Get all projects with auto-develop mode enabled.
 */
export function getAutoDevelopProjects(): ProjectsServiceResult<Project[]> {
  try {
    const db = getDatabase();
    const rows = db.prepare("SELECT * FROM projects WHERE auto_develop = 1").all() as ProjectRow[];
    return { success: true, data: rows.map(rowToProject) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get auto-develop projects";
    logError("getAutoDevelopProjects failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}
