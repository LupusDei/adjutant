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
import { existsSync, lstatSync, readFileSync, writeFileSync, appendFileSync } from "fs";
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

// ── Worktree MCP identity (adj-vevei) ────────────────────────────────────────
//
// Agents bind their dashboard identity via the `X-Agent-Id` header in the
// `.mcp.json` that Claude Code loads from the agent's working directory. Claude
// Code expands `${VAR}` in that file ONCE at process startup and never on
// reconnect. Worktree agents run in OTHER projects' trees (e.g. OttoDom), whose
// `.mcp.json` may lack the header entirely or use the fragile `${ADJUTANT_AGENT_ID}`
// env form — so they connect identity-less and the server mints `unknown-agent-*`.
//
// Fix: at worktree creation (the one component that knows BOTH callsign and path),
// write a self-contained worktree-local `.mcp.json` whose `X-Agent-Id` is the
// LITERAL callsign — zero env / timing / startup-cache dependency. Idempotent:
// never clobber an existing (possibly hand-tuned) worktree file.

const DEFAULT_MCP_URL = "http://localhost:4201/mcp";

/**
 * Build a self-contained `.mcp.json` for a worktree agent. Mirrors the project's
 * existing `adjutant` MCP server entry (so we don't hardcode the endpoint/type)
 * but pins `X-Agent-Id` and `X-Project-Root` to LITERAL values — no `${...}`.
 *
 * @param sourceMcpJson Raw contents of the project root `.mcp.json`, or null.
 */
export function buildWorktreeMcpConfig(
  callsign: string,
  worktreePath: string,
  sourceMcpJson: string | null,
): string {
  let url = DEFAULT_MCP_URL;
  let type = "http";
  if (sourceMcpJson) {
    try {
      const parsed = JSON.parse(sourceMcpJson) as {
        mcpServers?: { adjutant?: { url?: unknown; type?: unknown } };
      };
      const adj = parsed.mcpServers?.adjutant;
      if (adj && typeof adj.url === "string" && adj.url.length > 0) url = adj.url;
      if (adj && typeof adj.type === "string" && adj.type.length > 0) type = adj.type;
    } catch {
      // Malformed source — fall back to defaults rather than failing the spawn.
    }
  }
  const config = {
    mcpServers: {
      adjutant: {
        type,
        url,
        headers: {
          "X-Agent-Id": callsign,
          "X-Project-Root": worktreePath,
        },
      },
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Injected seams for {@link writeWorktreeMcpIdentity}. */
export interface WorktreeMcpIdentitySeams {
  exists?: (path: string) => boolean;
  /** Read a file, returning null if it does not exist / can't be read. */
  readFile?: (path: string) => string | null;
  writeFile?: (path: string, content: string) => void;
  /** Best-effort: exclude `pattern` from git in this worktree (default: info/exclude). */
  ensureExcluded?: (worktreePath: string, pattern: string) => void;
}

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Best-effort: add `pattern` to the worktree's git exclude so the per-agent
 * identity file never shows up as a change to commit. A linked worktree's `.git`
 * is a FILE (`gitdir: <path>`); its exclude lives at `<gitdir>/info/exclude`.
 * Never throws — gitignore is a nicety, not the fix.
 */
function defaultEnsureExcluded(worktreePath: string, pattern: string): void {
  try {
    const dotGit = join(worktreePath, ".git");
    if (!existsSync(dotGit)) return;
    let gitDir: string;
    if (lstatSync(dotGit).isDirectory()) {
      gitDir = dotGit;
    } else {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf-8").trim());
      if (!m?.[1]) return;
      gitDir = m[1].trim();
    }
    const excludeFile = join(gitDir, "info", "exclude");
    const existing = (() => {
      try { return readFileSync(excludeFile, "utf-8"); } catch { return ""; }
    })();
    if (existing.split("\n").some((l) => l.trim() === pattern)) return;
    appendFileSync(excludeFile, `${existing.length && !existing.endsWith("\n") ? "\n" : ""}${pattern}\n`);
  } catch {
    // Non-fatal.
  }
}

/**
 * Ensure a worktree carries a durable, literal MCP identity file so the agent
 * binds as `callsign` on the dashboard regardless of the host project's config.
 * Idempotent — skips if `<worktree>/.mcp.json` already exists. adj-vevei.
 */
export function writeWorktreeMcpIdentity(
  worktreePath: string,
  callsign: string,
  projectPath: string,
  seams: WorktreeMcpIdentitySeams = {},
): void {
  const exists = seams.exists ?? existsSync;
  const readFile = seams.readFile ?? defaultReadFile;
  const writeFile = seams.writeFile ?? ((p: string, c: string) => { writeFileSync(p, c); });
  const ensureExcluded = seams.ensureExcluded ?? defaultEnsureExcluded;

  const target = join(worktreePath, ".mcp.json");
  if (exists(target)) {
    // Never stomp an existing (possibly hand-tuned) worktree identity file.
    return;
  }
  const source = readFile(join(projectPath, ".mcp.json"));
  writeFile(target, buildWorktreeMcpConfig(callsign, worktreePath, source));
  ensureExcluded(worktreePath, ".mcp.json");
  logInfo("Wrote worktree MCP identity", { callsign, worktreePath });
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
  /** Write the worktree-local MCP identity file (default: real fs). adj-vevei. */
  writeMcpIdentity?: (worktreePath: string, callsign: string, projectPath: string) => void;
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
  const writeMcpIdentity = opts.writeMcpIdentity ?? writeWorktreeMcpIdentity;

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
    // adj-vevei: pin a durable, literal X-Agent-Id into the worktree so the agent
    // binds as `name` on the dashboard (not unknown-agent-*). Idempotent. Best-effort
    // — an identity-write failure must NEVER fail the spawn (fail-open, like deps).
    try {
      writeMcpIdentity(worktreePath, name, projectPath);
    } catch (err) {
      logWarn("Worktree MCP identity write failed (agent may bind as unknown-agent-*)", {
        name,
        error: String(err),
      });
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
