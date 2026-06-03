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

import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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
 * Allocate (or return the already-assigned) Dolt SQL-server port for a project.
 *
 * Idempotent: if the project already has a `doltPort`, it is returned unchanged
 * with no write. Otherwise the lowest free port in the band is assigned, persisted,
 * and returned. Collision-safe across projects (skips ports taken by siblings).
 *
 * @throws if the project id is absent, the registry is missing/malformed, or the band is exhausted.
 */
export function allocateDoltPort(projectId: string, opts?: DoltPortRegistryOptions): number {
  const registryPath = resolveRegistryPath(opts);
  const registry = readRegistry(registryPath);
  const project = requireProject(registry, projectId, registryPath);

  if (typeof project.doltPort === "number") {
    return project.doltPort;
  }

  const port = firstFreePort(takenPorts(registry));
  project.doltPort = port;
  writeRegistry(registryPath, registry);
  return port;
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
