/**
 * Real ps/lsof/launchctl scrapers for Dolt process discovery (adj-182.2.1.r1).
 *
 * Extracted from doctor.ts into a shared, UNIT-TESTABLE module. These parsers turn raw
 * `ps`, `lsof`, and `launchctl print` output into structured {@link DoltProcess} records
 * and the launchd-supervised PID. Rule 1: they are tested against REAL captured CLI
 * output (see dolt-process-scan.test.ts), not hand-crafted shapes — this is exactly the
 * real-CLI-output parsing that ships bugs when only the production wiring exercises it.
 *
 * The exec call is an INJECTED seam ({@link ScanExecFn}) so tests feed captured strings
 * and no real process is ever spawned. The default seam wraps `child_process.execFile`.
 *
 * SAFETY: read-only discovery. Nothing here starts/stops/kills a process.
 */

import { execFile } from "child_process";
import { userInfo } from "os";
import { promisify } from "util";

import { supervisorLabel } from "./dolt-supervisor.js";
import type { DoltProcess } from "./dolt-rogue-guard.js";

const execFileAsync = promisify(execFile);

/** Minimal exec result the scrapers consume. */
export interface ScanExecResult {
  stdout: string;
  stderr: string;
}

/** Run a command, returning its stdout/stderr. MAY throw (non-zero exit) — callers guard. */
export type ScanExecFn = (cmd: string, args: readonly string[]) => Promise<ScanExecResult>;

/** Default exec seam over `execFile`. */
const defaultExec: ScanExecFn = async (cmd, args) => {
  const { stdout, stderr } = await execFileAsync(cmd, [...args]);
  return { stdout, stderr };
};

/**
 * Parse the dolt sql-server PIDs out of `ps -axo pid,command` output. Skips the grep/ugrep
 * helper line (which also contains the literal `dolt sql-server` from the search pattern).
 */
function parseDoltPids(psOut: string): number[] {
  const pids: number[] = [];
  for (const line of psOut.split("\n")) {
    if (!/dolt sql-server/.test(line)) continue;
    if (/\bgrep\b|\bugrep\b/.test(line)) continue;
    const m = line.trim().match(/^(\d+)\s/);
    if (m) pids.push(parseInt(m[1], 10));
  }
  return pids;
}

/** Parse the LISTEN port from `lsof -anP -p <pid> -iTCP -sTCP:LISTEN` output for `pid`. */
function parseListenPort(lsofOut: string, pid: number): number | null {
  const line = lsofOut.split("\n").find((l) => new RegExp(`^\\S+\\s+${pid}\\b`).test(l));
  const portMatch = line?.match(/:(\d+)\s*\(LISTEN\)/);
  return portMatch ? parseInt(portMatch[1], 10) : null;
}

/** Parse the cwd from `lsof -p <pid>` output (the `cwd` FD row's last column). */
function parseCwd(lsofOut: string): string | null {
  const cwdLine = lsofOut.split("\n").find((l) => /\bcwd\b/.test(l));
  const parts = cwdLine?.trim().split(/\s+/);
  return parts && parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Scan for all `dolt sql-server` processes via ps + lsof (pid/port/cwd). Returns [] when
 * `ps` fails. Per-pid lsof failures degrade that pid's port/cwd to null but never throw.
 */
export async function scanDoltProcesses(exec: ScanExecFn = defaultExec): Promise<DoltProcess[]> {
  let psOut = "";
  try {
    const { stdout } = await exec("ps", ["-axo", "pid,command"]);
    psOut = stdout;
  } catch {
    return [];
  }

  const out: DoltProcess[] = [];
  for (const pid of parseDoltPids(psOut)) {
    let port: number | null = null;
    let cwd: string | null = null;
    try {
      const { stdout } = await exec("lsof", ["-anP", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"]);
      port = parseListenPort(stdout, pid);
    } catch {
      /* port stays null */
    }
    try {
      const { stdout } = await exec("lsof", ["-p", String(pid)]);
      cwd = parseCwd(stdout);
    } catch {
      /* cwd stays null */
    }
    out.push({ pid, port, cwd });
  }
  return out;
}

/**
 * Resolve the launchd-supervised PID for a project via `launchctl print
 * gui/<uid>/<label>` (adj-182.2.7). `launchctl print` emits a `pid = <n>` line ONLY when
 * the job has a running process; its absence (job loaded-but-not-running, or print
 * failing because the agent is not loaded) means no supervised PID → null.
 */
export async function launchctlSupervisedPid(
  projectId: string,
  uid: number = userInfo().uid,
  exec: ScanExecFn = defaultExec,
): Promise<number | null> {
  const label = supervisorLabel(projectId);
  const target = `gui/${uid}/${label}`;
  try {
    const { stdout } = await exec("launchctl", ["print", target]);
    const m = stdout.match(/\bpid\s*=\s*(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}
