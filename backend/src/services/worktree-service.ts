/**
 * Worktree provisioning service (adj-182.5).
 *
 * Provisions an isolated git worktree for a spawned agent so its file edits NEVER
 * touch the canonical checkout. This is the durable Rule-7 fix for the backend
 * restart loop (adj-8mmyd): the dev backend runs `tsx watch` on the canonical tree,
 * so any agent editing a watched src file there hot-reloads the server and bounces
 * EVERY MCP session. An agent rooted in its own worktree can edit freely without
 * disturbing the watched canonical tree.
 *
 * Mechanism mirrors the swarm path (swarm-service.ts): `git worktree add` + symlink
 * node_modules via scripts/provision-worktree.sh. Extracted here so BOTH swarm and
 * single-agent spawns (spawn_worker / REST) share one implementation.
 *
 * ALL external effects are INJECTED seams (exec / exists / provisionDeps) so unit
 * tests never run git, touch the filesystem, or spawn a shell.
 */

import { execFile } from "child_process";
import { existsSync, lstatSync, readFileSync } from "fs";
import { join } from "path";

import { logInfo, logWarn } from "../utils/index.js";

/** Run a command, resolving stdout / rejecting with stderr (mirrors swarm-service). */
function realExec(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Best-effort node_modules symlink provisioning via scripts/provision-worktree.sh. */
async function realProvisionDeps(worktreePath: string, projectPath: string): Promise<void> {
  try {
    await realExec("bash", ["scripts/provision-worktree.sh", worktreePath, projectPath], projectPath);
  } catch (err) {
    // Non-fatal: the agent can fall back to `npm install`. Never block the spawn.
    logWarn("Worktree dep provisioning failed (agent may need npm install)", {
      worktreePath,
      error: String(err),
    });
  }
}

/** Injected seams for {@link provisionAgentWorktree}. Defaults use real git/fs/shell. */
export interface ProvisionWorktreeOptions {
  /** Run a command (default: execFile-based). */
  exec?: (cmd: string, args: string[], cwd?: string) => Promise<string>;
  /** Does a path exist? (default: fs.existsSync). */
  exists?: (path: string) => boolean;
  /** Provision deps into the worktree (default: provision-worktree.sh). */
  provisionDeps?: (worktreePath: string, projectPath: string) => Promise<void>;
  /** Branch-name prefix (default: "agent"). */
  branchPrefix?: string;
}

/**
 * Provision (or reuse) an isolated git worktree for `name` under `projectPath`.
 *
 * Returns the absolute worktree path on success, or `null` if provisioning failed
 * (the caller then falls back to the canonical checkout — NOT isolated — with a warn,
 * since failing the whole spawn would be worse than a non-isolated agent).
 *
 * Idempotent: if the worktree dir already exists (re-spawn of the same name), it is
 * reused with no `git worktree add`.
 */
export async function provisionAgentWorktree(
  projectPath: string,
  name: string,
  opts: ProvisionWorktreeOptions = {},
): Promise<string | null> {
  const exec = opts.exec ?? realExec;
  const exists = opts.exists ?? existsSync;
  const provisionDeps = opts.provisionDeps ?? realProvisionDeps;
  const branchPrefix = opts.branchPrefix ?? "agent";

  const relPath = `worktrees/${name}`;
  const worktreePath = join(projectPath, "worktrees", name);

  try {
    if (exists(worktreePath)) {
      // Re-spawn of the same callsign — reuse the existing worktree, don't recreate.
      logInfo("Reusing existing agent worktree", { name, worktreePath });
    } else {
      await exec("git", ["worktree", "add", "-b", `${branchPrefix}/${name}`, relPath], projectPath);
      logInfo("Created isolated agent worktree", { name, worktreePath });
    }
    await provisionDeps(worktreePath, projectPath);
    return worktreePath;
  } catch (err) {
    logWarn("Worktree provisioning failed — agent will run in the canonical checkout (NOT isolated)", {
      name,
      projectPath,
      error: String(err),
    });
    return null;
  }
}

/**
 * Remove an agent's worktree (best-effort cleanup on decommission). Never throws.
 */
export async function removeAgentWorktree(
  projectPath: string,
  name: string,
  opts: Pick<ProvisionWorktreeOptions, "exec"> = {},
): Promise<void> {
  const exec = opts.exec ?? realExec;
  try {
    await exec("git", ["worktree", "remove", `worktrees/${name}`, "--force"], projectPath);
    logInfo("Removed agent worktree", { name });
  } catch (err) {
    logWarn("Failed to remove agent worktree (may already be gone)", { name, error: String(err) });
  }
}

// ── Worktree Dolt env (adj-182.3.1) ──────────────────────────────────────────
//
// A worktree agent must reach the ONE supervised Dolt server on the pinned port —
// never spawn its own. Two requirements (spec §US3 / T014):
//   1. EXPORT the pinned BEADS_DOLT_SERVER_PORT so the agent's bd connects to the
//      supervised server (externally-managed mode), not an ephemeral local one.
//   2. ASSERT there is no STRAY worktree Dolt data-dir — a real `<wt>/.beads/dolt`
//      would make bd spawn a second server on a random port (the exact churn the
//      adj-182 line eliminates). A SYMLINKED .beads/dolt (shared from main) is fine.
//
// All effects are injected seams so the unit test never touches the FS.

/** Read the authoritative pinned port from `<mainRepoPath>/.beads/dolt-server.port`. */
function defaultReadPinnedPort(mainRepoPath: string): number | null {
  const portFile = join(mainRepoPath, ".beads", "dolt-server.port");
  if (!existsSync(portFile)) return null;
  const n = Number.parseInt(readFileSync(portFile, "utf-8").trim(), 10);
  return Number.isInteger(n) ? n : null;
}

/**
 * A STRAY local data-dir is a REAL `<worktreePath>/.beads/dolt`. A worktree whose
 * `.beads` (or `.beads/dolt`) is a SYMLINK shares the main repo's supervised server
 * and is NOT stray — that is exactly how provision-worktree.sh wires a worktree.
 */
function defaultWorktreeDataDirIsStray(worktreePath: string): boolean {
  const beadsDir = join(worktreePath, ".beads");
  if (!existsSync(beadsDir)) return false;
  try {
    // A symlinked .beads (shared from main) is NOT stray.
    if (lstatSync(beadsDir).isSymbolicLink()) return false;
  } catch {
    return false;
  }
  const dataDir = join(beadsDir, "dolt");
  if (!existsSync(dataDir)) return false;
  try {
    // A symlinked .beads/dolt is shared, not stray; a real dir IS stray.
    return !lstatSync(dataDir).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Injected seams for {@link resolveWorktreeDoltEnv}. */
export interface WorktreeDoltEnvSeams {
  /** Read the pinned port for the main repo (default: <main>/.beads/dolt-server.port). */
  readPinnedPort?: (mainRepoPath: string) => number | null;
  /** Does the worktree have a stray (non-symlink) dolt data-dir? (default: fs check). */
  worktreeDataDirIsStray?: (worktreePath: string) => boolean;
}

/**
 * Resolve the `BEADS_DOLT_SERVER_PORT` a worktree agent must use to reach the
 * supervised server, and assert the worktree has no stray local Dolt data-dir
 * (adj-182.3.1). Throws on a stray data-dir or a missing pinned port — both are
 * conditions under which a worktree agent would silently spin up a rogue server.
 *
 * @returns `{ port, exportLine }` where exportLine is `BEADS_DOLT_SERVER_PORT=<port>`.
 */
export function resolveWorktreeDoltEnv(
  mainRepoPath: string,
  worktreePath: string,
  seams: WorktreeDoltEnvSeams = {},
): { port: number; exportLine: string } {
  const readPinnedPort = seams.readPinnedPort ?? defaultReadPinnedPort;
  const isStray = seams.worktreeDataDirIsStray ?? defaultWorktreeDataDirIsStray;

  if (isStray(worktreePath)) {
    throw new Error(
      `Stray Dolt data-dir in worktree ${worktreePath}/.beads/dolt — worktree agents must use the supervised server, not a local dolt`,
    );
  }

  const port = readPinnedPort(mainRepoPath);
  if (port === null) {
    throw new Error(
      `No pinned Dolt port for ${mainRepoPath} (.beads/dolt-server.port missing) — cannot point the worktree at the supervised server`,
    );
  }

  return { port, exportLine: `BEADS_DOLT_SERVER_PORT=${port}` };
}
