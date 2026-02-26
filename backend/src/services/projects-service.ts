/**
 * Projects service for managing project registrations.
 *
 * Persists projects to ~/.adjutant/projects.json.
 * Supports create (from path, clone URL, or empty), list, activate, and delete.
 *
 * @module services/projects-service
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { join, resolve, basename } from "path";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { logInfo, logError, logDebug } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export interface Project {
  id: string;
  name: string;
  path: string;
  gitRemote?: string | undefined;
  mode: "swarm" | "gastown";
  sessions: string[];
  createdAt: string;
  active: boolean;
  /** Whether this project has a .beads/ directory */
  hasBeads?: boolean | undefined;
}

export interface ProjectsStore {
  projects: Project[];
}

export interface ProjectsServiceResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface CreateProjectInput {
  path?: string | undefined;
  cloneUrl?: string | undefined;
  name?: string | undefined;
  empty?: boolean | undefined;
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
// Constants
// ============================================================================

const ADJUTANT_DIR = join(homedir(), ".adjutant");
const PROJECTS_FILE = join(ADJUTANT_DIR, "projects.json");
const DEFAULT_PROJECTS_BASE = join(homedir(), "projects");
const DEFAULT_SCAN_DEPTH = 1;
const MAX_SCAN_DEPTH = 3;
const SKIP_DIRS = new Set(["node_modules", ".git", ".beads", "dist", "build", ".next", "__pycache__"]);

// ============================================================================
// Persistence
// ============================================================================

function ensureAdjutantDir(): void {
  if (!existsSync(ADJUTANT_DIR)) {
    mkdirSync(ADJUTANT_DIR, { recursive: true });
  }
}

function loadStore(): ProjectsStore {
  ensureAdjutantDir();
  if (!existsSync(PROJECTS_FILE)) {
    return { projects: [] };
  }
  try {
    const raw = readFileSync(PROJECTS_FILE, "utf8");
    const store = JSON.parse(raw) as ProjectsStore;
    // Normalize legacy "standalone" mode to "swarm" at the API boundary.
    // The gt CLI and older projects.json files may still contain "standalone".
    for (const project of store.projects) {
      if ((project.mode as string) === "standalone") {
        project.mode = "swarm";
      }
    }
    return store;
  } catch {
    return { projects: [] };
  }
}

function saveStore(store: ProjectsStore): void {
  ensureAdjutantDir();
  writeFileSync(PROJECTS_FILE, JSON.stringify(store, null, 2), "utf8");
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

function nameFromCloneUrl(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? "project";
}

// ============================================================================
// Project Detection Helpers
// ============================================================================

/**
 * Check if a directory contains a beads database (.beads/beads.db).
 */
function hasBeadsDb(dirPath: string): boolean {
  return existsSync(join(dirPath, ".beads", "beads.db"));
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
  currentDepth: number = 0,
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
 * The `hasBeads` field is set on all discovered projects.
 *
 * Skips: node_modules, .git, .beads, dist, build, hidden dirs (`.` prefix), non-directories.
 * De-duplicates against already-registered paths.
 *
 * @param options.maxDepth - How deep to scan (default 1, max 3). Depth 0 = root only.
 */
export function discoverLocalProjects(options?: DiscoverOptions): ProjectsServiceResult<Project[]> {
  try {
    const projectRoot = resolve(process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd());
    const requestedDepth = options?.maxDepth ?? DEFAULT_SCAN_DEPTH;
    const maxDepth = Math.min(Math.max(0, requestedDepth), MAX_SCAN_DEPTH);

    const store = loadStore();
    const existingPaths = new Set(store.projects.map((p) => p.path));
    const discovered: Project[] = [];

    // Update hasBeads on existing projects (may have changed since last scan)
    let existingUpdated = false;
    for (const project of store.projects) {
      if (existsSync(project.path)) {
        const beads = hasBeadsDb(project.path);
        if (project.hasBeads !== beads) {
          project.hasBeads = beads;
          existingUpdated = true;
        }
      }
    }

    // Register the project root itself if not already registered
    if (!existingPaths.has(projectRoot) && existsSync(projectRoot)) {
      const rootProject: Project = {
        id: generateId(),
        name: nameFromPath(projectRoot),
        path: projectRoot,
        gitRemote: detectGitRemote(projectRoot),
        mode: "swarm",
        sessions: [],
        createdAt: new Date().toISOString(),
        active: true,
        hasBeads: hasBeadsDb(projectRoot),
      };
      store.projects.push(rootProject);
      existingPaths.add(projectRoot);
      discovered.push(rootProject);
      logInfo("discovered project root", { id: rootProject.id, name: rootProject.name, path: projectRoot, hasBeads: rootProject.hasBeads });
    } else {
      // Mark the existing root project as active
      const existing = store.projects.find((p) => p.path === projectRoot);
      if (existing && !existing.active) {
        for (const p of store.projects) {
          p.active = p.path === projectRoot;
        }
      }
    }

    // Scan child directories for projects (git repos or beads repos)
    // maxDepth 0 = root only, no child scan
    if (maxDepth > 0 && existsSync(projectRoot)) {
      const projectPaths = scanForProjects(projectRoot, maxDepth - 1);
      logDebug("project scan complete", { root: projectRoot, maxDepth, found: projectPaths.length });

      for (const childPath of projectPaths) {
        if (existingPaths.has(childPath)) continue;

        const project: Project = {
          id: generateId(),
          name: nameFromPath(childPath),
          path: childPath,
          gitRemote: detectGitRemote(childPath),
          mode: "swarm",
          sessions: [],
          createdAt: new Date().toISOString(),
          active: false,
          hasBeads: hasBeadsDb(childPath),
        };

        store.projects.push(project);
        existingPaths.add(childPath);
        discovered.push(project);
        logInfo("discovered child project", { id: project.id, name: project.name, path: childPath, hasBeads: project.hasBeads });
      }
    }

    if (discovered.length > 0 || existingUpdated) {
      saveStore(store);
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
    let store = loadStore();

    // Auto-seed on first access if no projects registered
    if (store.projects.length === 0) {
      discoverLocalProjects();
      store = loadStore();
    }

    return { success: true, data: store.projects };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list projects";
    logError("listProjects failed", { error: message });
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Get a single project by ID.
 */
export function getProject(id: string): ProjectsServiceResult<Project> {
  try {
    const store = loadStore();
    const project = store.projects.find((p) => p.id === id);
    if (!project) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }
    return { success: true, data: project };
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
    const store = loadStore();

    if (input.cloneUrl) {
      return createFromClone(store, input.cloneUrl, input.name);
    }

    if (input.empty) {
      if (!input.name) {
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Name is required for empty projects" } };
      }
      return createEmpty(store, input.name);
    }

    if (input.path) {
      return createFromPath(store, input.path, input.name);
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

function createFromPath(store: ProjectsStore, dirPath: string, name?: string): ProjectsServiceResult<Project> {
  const absPath = resolve(dirPath);

  if (!existsSync(absPath)) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `Path does not exist: ${absPath}` } };
  }

  // Check for duplicate path
  const existing = store.projects.find((p) => p.path === absPath);
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
  };

  store.projects.push(project);
  saveStore(store);

  logInfo("project created from path", { id: project.id, name: project.name, path: project.path });
  return { success: true, data: project };
}

function createFromClone(store: ProjectsStore, cloneUrl: string, name?: string): ProjectsServiceResult<Project> {
  const projectName = name ?? nameFromCloneUrl(cloneUrl);
  const targetDir = join(DEFAULT_PROJECTS_BASE, projectName);

  if (existsSync(targetDir)) {
    return { success: false, error: { code: "CONFLICT", message: `Directory already exists: ${targetDir}` } };
  }

  // Ensure parent directory exists
  mkdirSync(DEFAULT_PROJECTS_BASE, { recursive: true });

  try {
    execSync(`git clone ${cloneUrl} ${targetDir}`, {
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
  };

  store.projects.push(project);
  saveStore(store);

  logInfo("project created from clone", { id: project.id, name: project.name, cloneUrl });
  return { success: true, data: project };
}

function createEmpty(store: ProjectsStore, name: string): ProjectsServiceResult<Project> {
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
  };

  store.projects.push(project);
  saveStore(store);

  logInfo("empty project created", { id: project.id, name: project.name, path: targetDir });
  return { success: true, data: project };
}

/**
 * Activate a project (mark it as the current active project).
 * Deactivates any previously active project.
 */
export function activateProject(id: string): ProjectsServiceResult<Project> {
  try {
    const store = loadStore();
    const project = store.projects.find((p) => p.id === id);

    if (!project) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    // Deactivate all, activate target
    for (const p of store.projects) {
      p.active = p.id === id;
    }

    saveStore(store);

    logInfo("project activated", { id: project.id, name: project.name });
    return { success: true, data: project };
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
    const store = loadStore();
    const index = store.projects.findIndex((p) => p.id === id);

    if (index === -1) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    store.projects.splice(index, 1);
    saveStore(store);

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
 *
 * Also updates the stored project's hasBeads field if it changed.
 */
export function checkProjectHealth(id: string): ProjectsServiceResult<ProjectHealth> {
  try {
    const store = loadStore();
    const project = store.projects.find((p) => p.id === id);
    if (!project) {
      return { success: false, error: { code: "NOT_FOUND", message: `Project '${id}' not found` } };
    }

    const pathExists = existsSync(project.path);
    const hasGit = pathExists && existsSync(join(project.path, ".git"));
    const beads = pathExists && hasBeadsDb(project.path);

    // Update hasBeads in store if changed
    if (project.hasBeads !== beads) {
      project.hasBeads = beads;
      saveStore(store);
    }

    let status: ProjectHealth["status"];
    if (!pathExists) {
      status = "stale";
    } else if (!hasGit) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    const gitRemote = hasGit ? detectGitRemote(project.path) : undefined;

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
