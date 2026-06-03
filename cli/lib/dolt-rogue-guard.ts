/**
 * Shared first-install rogue guard (adj-182.2.2.1).
 *
 * Both `adjutant doctor --fix` (fixDolt) and `adjutant init` (initDoltSupervisor) must
 * avoid the two-servers-on-one-data-dir DOUBLE-OPEN: before bootstrapping the supervised
 * Dolt server they have to reason about any dolt already running under THIS project's
 * data-dir. This module is the single, pure decision both callers share so the policy
 * cannot drift between them.
 *
 * Classification (adj-182.2.7 + adj-182.2.2.1):
 *   - supervised PID KNOWN (launchd loaded) — the launchd-reported PID is the ONE
 *     legitimate server. Every other dolt under our data-dir is a rogue to kill.
 *   - supervised PID UNKNOWN (first install) — we have no launchd anchor, so we classify
 *     by PORT OWNERSHIP, which is unambiguous (only one process can LISTEN on a port):
 *       • a data-dir dolt bound to our PINNED PORT is the squatter we would collide with
 *         → kill it (safe + necessary before bootstrap);
 *       • any OTHER data-dir dolt is unclassifiable — killing the wrong process is worse
 *         than leaving it — so we DON'T kill it and we signal `refuseInstall` so the
 *         caller aborts rather than bootstrap a SECOND server onto a shared data-dir.
 *
 * Pure: no I/O, no process side effects. The caller owns the actual kill + install.
 */

/** A discovered `dolt sql-server` process (from the ps/lsof scan seam). */
export interface DoltProcess {
  /** Process id. */
  pid: number;
  /** Listening port, when discoverable. */
  port: number | null;
  /** Working directory — a proxy for which project's data-dir the server owns. */
  cwd: string | null;
}

/**
 * Does `cwd` point at this project's data-dir (exactly, or a child)?
 *
 * Path-BOUNDARY match (adj-182.1.5.1): a bare prefix would also match sibling dirs that
 * merely share the prefix (`.beads-backup`, `.beads2`) — those belong to OTHER projects.
 * Anchor on the separator so only true children match.
 */
export function cwdUnderDataDir(cwd: string | null, beadsDir: string): boolean {
  if (!cwd) return false;
  return cwd === beadsDir || cwd.startsWith(`${beadsDir}/`);
}

/** Inputs for {@link classifyDataDirRogues}. */
export interface RogueGuardContext {
  /** Absolute path to the project's `.beads` directory. */
  beadsDir: string;
  /** The pinned Dolt port for this project. */
  pinnedPort: number;
  /**
   * The launchd-supervised PID (the source of truth), or null when the agent is not yet
   * loaded (first install). NEVER the stale pidfile (adj-182.2.7).
   */
  supervisedPid: number | null;
}

/** The guard's decision for the caller to act on. */
export interface RogueGuardDecision {
  /** PIDs the caller should kill BEFORE installing (safe to terminate). */
  killPids: number[];
  /**
   * True when an unclassifiable dolt co-owns the data-dir and could not be killed — the
   * caller MUST refuse to install (bootstrapping would double-open the data-dir).
   */
  refuseInstall: boolean;
}

/**
 * Classify the dolt processes running under this project's data-dir into "kill before
 * install" and "refuse install" outcomes. See the module doc for the policy.
 */
export function classifyDataDirRogues(
  processes: DoltProcess[],
  ctx: RogueGuardContext,
): RogueGuardDecision {
  const onOurDataDir = processes.filter((p) => cwdUnderDataDir(p.cwd, ctx.beadsDir));
  const killPids: number[] = [];
  let refuseInstall = false;

  if (ctx.supervisedPid === null) {
    // First install: classify by port ownership.
    for (const p of onOurDataDir) {
      if (p.port === ctx.pinnedPort) {
        killPids.push(p.pid); // unambiguous pinned-port squatter
      } else {
        refuseInstall = true; // unclassifiable — cannot prove safe to kill
      }
    }
  } else {
    // Agent loaded: the supervised PID is legit; everything else on the data-dir is rogue.
    for (const p of onOurDataDir) {
      if (p.pid !== ctx.supervisedPid) killPids.push(p.pid);
    }
  }

  return { killPids, refuseInstall };
}
