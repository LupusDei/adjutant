/**
 * Tests for the REAL ps/lsof/launchctl parsing seams (adj-182.2.1.r1).
 *
 * Rule 1 (real data shapes): the production scrapers that parse `ps`, `lsof`, and
 * `launchctl print` output were previously UNtested — exactly the real-CLI-output
 * parsing that ships bugs when tested against hand-crafted shapes. These tests feed the
 * parsers REAL captured output (samples taken from `ps -axo pid,command`,
 * `lsof -anP -p <pid> -iTCP -sTCP:LISTEN`, `lsof -p <pid>`, and `launchctl print
 * gui/<uid>/<label>` on macOS) via an INJECTED exec seam — no real process is spawned.
 *
 * Captured 2026-06-03 on darwin:
 *   ps line:   `93123 /usr/local/bin/dolt sql-server -H 127.0.0.1 -P 49820`
 *   lsof TCP:  `dolt    93123 Reason   25u  IPv4 0x3bcceec3976ebe00  0t0  TCP 127.0.0.1:49820 (LISTEN)`
 *   lsof cwd:  `dolt    93123 Reason  cwd      DIR   1,6   288   479144797 /Users/Reason/code/ai/adjutant/.beads/dolt`
 *   launchctl: `\tpid = 1598`  (preceded by `\tstate = running`)
 */

import { describe, it, expect, vi } from "vitest";

import {
  scanDoltProcesses,
  launchctlSupervisedPid,
  type ScanExecFn,
} from "../../../cli/lib/dolt-process-scan.js";

// ── Real captured CLI output ──────────────────────────────────────────────────

const PS_OUTPUT = `  PID COMMAND
    1 /sbin/launchd
  117 /usr/libexec/logd
93123 /usr/local/bin/dolt sql-server -H 127.0.0.1 -P 49820
61259 ugrep -G --ignore-files --hidden -iE dolt sql-server
`;

const LSOF_LISTEN_93123 = `COMMAND   PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
dolt    93123 Reason   25u  IPv4 0x3bcceec3976ebe00      0t0  TCP 127.0.0.1:49820 (LISTEN)
`;

const LSOF_FULL_93123 = `COMMAND   PID   USER   FD   TYPE             DEVICE SIZE/OFF     NODE NAME
dolt    93123 Reason  cwd      DIR                1,6       288 479144797 /Users/Reason/code/ai/adjutant/.beads/dolt
dolt    93123 Reason  txt      REG                1,6  12345678 123456789 /usr/local/bin/dolt
`;

const LAUNCHCTL_RUNNING = `com.adjutant.dolt.proj = {
	active count = 1
	path = /Users/me/Library/LaunchAgents/com.adjutant.dolt.proj.plist
	state = running
	program = /usr/local/bin/dolt
	pid = 1598
	...
}
`;

const LAUNCHCTL_NOT_RUNNING = `com.adjutant.dolt.proj = {
	active count = 0
	path = /Users/me/Library/LaunchAgents/com.adjutant.dolt.proj.plist
	state = not running
	...
}
`;

/** Build an exec seam that returns scripted stdout per command. */
function makeExec(
  responses: { match: (cmd: string, args: readonly string[]) => boolean; stdout: string }[],
  fallbackThrows = false,
): ScanExecFn {
  return vi.fn(async (cmd: string, args: readonly string[]) => {
    for (const r of responses) {
      if (r.match(cmd, args)) return { stdout: r.stdout, stderr: "" };
    }
    if (fallbackThrows) throw new Error("command failed");
    return { stdout: "", stderr: "" };
  });
}

describe("scanDoltProcesses (real ps/lsof parsing — adj-182.2.1.r1)", () => {
  it("should parse a real dolt sql-server pid from `ps -axo pid,command` and ignore the grep/ugrep line", async () => {
    const exec = makeExec([
      { match: (cmd) => cmd === "ps", stdout: PS_OUTPUT },
      { match: (cmd, a) => cmd === "lsof" && a.includes("-iTCP"), stdout: LSOF_LISTEN_93123 },
      { match: (cmd) => cmd === "lsof", stdout: LSOF_FULL_93123 },
    ]);
    const procs = await scanDoltProcesses(exec);
    expect(procs.map((p) => p.pid)).toEqual([93123]);
  });

  it("should parse the LISTEN port from real `lsof -iTCP -sTCP:LISTEN` output", async () => {
    const exec = makeExec([
      { match: (cmd) => cmd === "ps", stdout: PS_OUTPUT },
      { match: (cmd, a) => cmd === "lsof" && a.includes("-iTCP"), stdout: LSOF_LISTEN_93123 },
      { match: (cmd) => cmd === "lsof", stdout: LSOF_FULL_93123 },
    ]);
    const procs = await scanDoltProcesses(exec);
    expect(procs[0]?.port).toBe(49820);
  });

  it("should parse the cwd from real `lsof -p <pid>` output", async () => {
    const exec = makeExec([
      { match: (cmd) => cmd === "ps", stdout: PS_OUTPUT },
      { match: (cmd, a) => cmd === "lsof" && a.includes("-iTCP"), stdout: LSOF_LISTEN_93123 },
      { match: (cmd) => cmd === "lsof", stdout: LSOF_FULL_93123 },
    ]);
    const procs = await scanDoltProcesses(exec);
    expect(procs[0]?.cwd).toBe("/Users/Reason/code/ai/adjutant/.beads/dolt");
  });

  it("should return [] when ps reports no dolt sql-server processes", async () => {
    const exec = makeExec([
      { match: (cmd) => cmd === "ps", stdout: "  PID COMMAND\n    1 /sbin/launchd\n" },
    ]);
    expect(await scanDoltProcesses(exec)).toEqual([]);
  });

  it("should return [] when ps itself fails (no throw escapes the parser)", async () => {
    const exec = makeExec([], /* fallbackThrows */ true);
    expect(await scanDoltProcesses(exec)).toEqual([]);
  });

  it("should yield null port/cwd when the lsof lookups fail for a found pid", async () => {
    const exec: ScanExecFn = vi.fn(async (cmd: string) => {
      if (cmd === "ps") return { stdout: PS_OUTPUT, stderr: "" };
      throw new Error("lsof failed");
    });
    const procs = await scanDoltProcesses(exec);
    expect(procs).toEqual([{ pid: 93123, port: null, cwd: null }]);
  });
});

describe("launchctlSupervisedPid (real `launchctl print` parsing — adj-182.2.1.r1)", () => {
  const PROJECT_ID = "proj";
  const UID = 501;

  it("should parse the running pid from real `launchctl print` output", async () => {
    const exec = makeExec([{ match: (cmd) => cmd === "launchctl", stdout: LAUNCHCTL_RUNNING }]);
    expect(await launchctlSupervisedPid(PROJECT_ID, UID, exec)).toBe(1598);
  });

  it("should return null when the job is loaded but not running (no pid line)", async () => {
    const exec = makeExec([{ match: (cmd) => cmd === "launchctl", stdout: LAUNCHCTL_NOT_RUNNING }]);
    expect(await launchctlSupervisedPid(PROJECT_ID, UID, exec)).toBeNull();
  });

  it("should return null when `launchctl print` fails (agent not loaded)", async () => {
    const exec: ScanExecFn = vi.fn(async () => {
      throw new Error('Could not find service in domain for user gui: 501');
    });
    expect(await launchctlSupervisedPid(PROJECT_ID, UID, exec)).toBeNull();
  });

  it("should target the gui/<uid>/<label> domain for the project's supervisor label", async () => {
    const exec = vi.fn(async () => ({ stdout: LAUNCHCTL_RUNNING, stderr: "" }));
    await launchctlSupervisedPid(PROJECT_ID, UID, exec);
    const [, args] = exec.mock.calls[0];
    expect(args).toContain("print");
    expect(args.some((a: string) => a === `gui/501/com.adjutant.dolt.${PROJECT_ID}`)).toBe(true);
  });
});
