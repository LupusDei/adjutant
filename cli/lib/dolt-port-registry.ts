/**
 * Dolt port registry/allocator (adj-182.1.1).
 *
 * Assigns a STABLE per-project Dolt SQL-server port from a reserved band
 * (17000–17999) and persists it as `doltPort` on the project record in the
 * central registry (`~/.adjutant/projects.json`).
 *
 * Why: since beads v0.60.0 an unpinned Dolt server grabs a random ephemeral port
 * (`net.Listen(":0")`) on every (re)start. macOS sleep/crash/idle churns that port;
 * the stale `.beads/dolt-server.port` + per-host circuit-breaker file then make `bd`
 * fail fast against a dead port. Pinning a port at the source eliminates the churn.
 *
 * This module is intentionally a pure, side-effect-bounded function over a registry
 * file whose path is injected (the DI seam). It never assumes the real
 * `~/.adjutant/projects.json` — callers/tests supply the path.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join, resolve } from "path";

/** Inclusive lower bound of the reserved Dolt SQL-server port band. */
export const DOLT_PORT_BAND_START = 17000;
/** Inclusive upper bound of the reserved Dolt SQL-server port band. */
export const DOLT_PORT_BAND_END = 17999;

/** A project record in the central registry. Only fields we touch are typed. */
export interface RegistryProject {
  id: string;
  doltPort?: number;
  // The registry carries many other fields (name, path, hasBeads, sessions, …).
  // They are preserved verbatim via the index signature on round-trip.
  [key: string]: unknown;
}

/** Shape of the central registry file (`~/.adjutant/projects.json`). */
export interface Registry {
  projects: RegistryProject[];
  [key: string]: unknown;
}

/** Options carrying the dependency-injection seam for the registry file path. */
export interface DoltPortRegistryOptions {
  /** Absolute path to the registry JSON file. Defaults to ~/.adjutant/projects.json. */
  registryPath?: string;
}

/** Resolve the registry path, defaulting to the central registry. */
function resolveRegistryPath(opts?: DoltPortRegistryOptions): string {
  return opts?.registryPath ?? join(homedir(), ".adjutant", "projects.json");
}

/** Read + parse the registry, throwing a clear error if missing/malformed. */
function readRegistry(registryPath: string): Registry {
  if (!existsSync(registryPath)) {
    throw new Error(`Dolt port registry not found at ${registryPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(registryPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Failed to parse Dolt port registry at ${registryPath}: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Registry).projects)
  ) {
    throw new Error(
      `Malformed Dolt port registry at ${registryPath}: expected { projects: [...] }`,
    );
  }
  return parsed as Registry;
}

/** Persist the registry, pretty-printed with a trailing newline (matches repo style). */
function writeRegistry(registryPath: string, registry: Registry): void {
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

/** Find a project record by id, or throw if absent. */
function requireProject(registry: Registry, projectId: string, registryPath: string): RegistryProject {
  const project = registry.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" not found in Dolt port registry at ${registryPath}`);
  }
  return project;
}

/** Collect every doltPort currently in use across all projects. */
function takenPorts(registry: Registry): Set<number> {
  const taken = new Set<number>();
  for (const p of registry.projects) {
    if (typeof p.doltPort === "number") {
      taken.add(p.doltPort);
    }
  }
  return taken;
}

/**
 * Find the lowest free port in the reserved band, skipping ports already
 * assigned to other projects. Throws on band exhaustion.
 */
function firstFreePort(taken: Set<number>): number {
  for (let port = DOLT_PORT_BAND_START; port <= DOLT_PORT_BAND_END; port++) {
    if (!taken.has(port)) {
      return port;
    }
  }
  throw new Error(
    `Dolt port band exhausted: all ports ${DOLT_PORT_BAND_START}-${DOLT_PORT_BAND_END} are allocated`,
  );
}

/**
 * Assign (or return the already-assigned) port for a single registry entry,
 * persisting the registry only when a new port is allocated.
 *
 * Idempotent: an entry that already carries a numeric `doltPort` is returned
 * unchanged with NO write. Collision-safe: the lowest free port in the band is
 * chosen, skipping ports already held by sibling entries.
 */
function assignPortToEntry(
  registry: Registry,
  entry: RegistryProject,
  registryPath: string,
): number {
  if (typeof entry.doltPort === "number") {
    return entry.doltPort;
  }
  const port = firstFreePort(takenPorts(registry));
  entry.doltPort = port;
  writeRegistry(registryPath, registry);
  return port;
}

/**
 * Allocate (or return the already-assigned) Dolt SQL-server port for a project
 * identified by its registry id.
 *
 * Idempotent: if the project already has a `doltPort`, it is returned unchanged
 * with no write. Otherwise the lowest free port in the band is assigned, persisted,
 * and returned. Collision-safe across projects (skips ports taken by siblings).
 *
 * NOTE: this id-keyed entrypoint requires the project to PRE-EXIST under exactly the
 * id supplied. The central registry (`~/.adjutant/projects.json`) keys entries by an
 * 8-char SHORT id, which is a DIFFERENT id-space from the beads `project_id` UUID in
 * `.beads/metadata.json`. Callers that only hold the beads UUID (install / doctor /
 * init) MUST resolve by repo path via {@link allocateDoltPortByPath} instead — passing
 * the UUID here throws "not found" (the adj-182.1.4.1 live-cutover failure).
 *
 * @throws if the project id is absent, the registry is missing/malformed, or the band is exhausted.
 */
export function allocateDoltPort(projectId: string, opts?: DoltPortRegistryOptions): number {
  const registryPath = resolveRegistryPath(opts);
  const registry = readRegistry(registryPath);
  const project = requireProject(registry, projectId, registryPath);
  return assignPortToEntry(registry, project, registryPath);
}

/**
 * Normalize a filesystem path for registry matching: resolve to an absolute path,
 * follow symlinks when the target exists (so a worktree/symlinked checkout and the
 * registry's canonical path compare equal), and strip a trailing separator.
 *
 * `realpathSync` is best-effort — a path that does not yet exist on disk falls back
 * to the lexically-resolved absolute form so a brand-new project can still be created.
 */
function normalizeRepoPath(p: string): string {
  const absolute = resolve(p);
  try {
    return realpathSync(absolute);
  } catch {
    // Path does not exist (e.g. a not-yet-created project dir) — use the resolved form.
    return absolute.replace(/[/\\]+$/, "");
  }
}

/**
 * Generate a short, stable-ish registry id for an auto-created entry. Mirrors the
 * 8-hex-char shape of existing registry ids (e.g. `0e578d15`) without colliding with
 * any current id. The id is display/lookup-only; the repo PATH remains the join key.
 */
function freshShortId(registry: Registry, repoPath: string): string {
  const taken = new Set(registry.projects.map((p) => p.id));
  // Seed from the path so re-creation of the same dir tends to reproduce the same id;
  // a counter guarantees uniqueness against the (rare) collision.
  let hash = 0;
  for (let i = 0; i < repoPath.length; i++) {
    hash = (hash * 31 + repoPath.charCodeAt(i)) >>> 0;
  }
  for (let salt = 0; salt < 1_000_000; salt++) {
    const candidate = ((hash + salt) >>> 0).toString(16).padStart(8, "0").slice(0, 8);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  // Practically unreachable; fall back to a path-derived unique-enough id.
  return `auto-${Date.now().toString(16)}`;
}

/**
 * Allocate (or return the already-assigned) Dolt SQL-server port for the project
 * whose checkout lives at `repoPath`.
 *
 * This is the RELIABLE entrypoint across id-spaces: the central registry has no beads
 * UUID, but every entry carries an absolute `path`. We match `repoPath` to an entry's
 * `path` (both normalized via {@link normalizeRepoPath}) and persist `doltPort` on THAT
 * entry. Only when no entry matches do we auto-create a new one (preserving the install's
 * ability to bootstrap a never-registered repo) and allocate for it.
 *
 * Idempotent + collision-safe identically to {@link allocateDoltPort}.
 *
 * @throws if the registry is missing/malformed, or the reserved band is exhausted.
 */
export function allocateDoltPortByPath(repoPath: string, opts?: DoltPortRegistryOptions): number {
  const registryPath = resolveRegistryPath(opts);
  const registry = readRegistry(registryPath);
  const target = normalizeRepoPath(repoPath);

  let entry = registry.projects.find(
    (p) => typeof p["path"] === "string" && normalizeRepoPath(p["path"] as string) === target,
  );

  if (!entry) {
    // No path match — auto-create a minimal entry keyed by a fresh short id. The
    // install/doctor/init flows are the only callers, and they always run inside a
    // real repo, so creating the entry here lets a never-registered repo bootstrap
    // its pinned port rather than aborting the cutover.
    entry = {
      id: freshShortId(registry, target),
      name: basename(target),
      path: target,
      hasBeads: true,
    };
    registry.projects.push(entry);
  }

  return assignPortToEntry(registry, entry, registryPath);
}

/**
 * Read the persisted Dolt port for a project.
 *
 * Returns null when the project is unknown or has no `doltPort` assigned yet.
 * Does NOT throw on a missing registry — a non-existent registry simply means
 * "no port assigned".
 */
export function getDoltPort(projectId: string, opts?: DoltPortRegistryOptions): number | null {
  const registryPath = resolveRegistryPath(opts);
  if (!existsSync(registryPath)) {
    return null;
  }
  let registry: Registry;
  try {
    registry = readRegistry(registryPath);
  } catch {
    return null;
  }
  const project = registry.projects.find((p) => p.id === projectId);
  if (!project || typeof project.doltPort !== "number") {
    return null;
  }
  return project.doltPort;
}
