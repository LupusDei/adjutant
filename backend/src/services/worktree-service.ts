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
import { existsSync } from "fs";
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
