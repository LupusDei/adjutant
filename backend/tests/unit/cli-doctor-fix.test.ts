/**
 * Tests for fixDolt() — the `adjutant doctor --fix` Dolt repair path (adj-182.2.2).
 *
 * fixDolt() repairs the supervised, pinned-port Dolt topology:
 *   1. Allocate + pin the port (idempotent via the registry/pin seams) → externally-
 *      managed mode.
 *   2. Install + load the launchd LaunchAgent (idempotent via the install seam,
 *      which itself runs `launchctl bootout` then `bootstrap`).
 *   3. Kill ROGUE dolt — any dolt whose cwd is under THIS data-dir whose PID is NOT
 *      the launchd-supervised one (adj-182.2.7: supervised PID from launchd, not the
 *      stale pidfile). Refuses to kill when the supervised PID is unknown.
 *   4. Clear stale `/tmp/beads-dolt-circuit-*.json` breaker files.
 *
 * Idempotent on a healthy system: re-running pins the same port, re-installs the
 * already-loaded agent (bootout+bootstrap is a no-op restart), kills no rogues
 * (none present), and clears whatever stale circuit files exist (zero on a clean box).
 *
 * SAFETY: `--fix` only acts when a human runs it (never auto-invoked). EVERY external
 * effect (install/launchctl, kill, circuit-file delete, port allocate/pin, process
 * scan) is an INJECTED seam — this test runs NO real launchctl/kill/dolt, never
 * mutates the live server, never deletes real files.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { fixDolt, type FixDoltOptions } from "../../../cli/commands/doctor.js";
import type { DoltProcess } from "../../../cli/commands/doctor.js";
import type { InstallSupervisorResult } from "../../../cli/lib/dolt-supervisor.js";

const PROJECT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const BEADS_DIR = "/Users/me/proj/.beads";
const PINNED_PORT = 17005;
const SUPERVISED_PID = 4242;

interface KillCall {
  pid: number;
}

/** Build fully-seamed options describing a repairable system + capture side effects. */
function makeOpts(overrides: Partial<FixDoltOptions> = {}): {
  opts: FixDoltOptions;
  killCalls: KillCall[];
} {
  const killCalls: KillCall[] = [];

  const opts: FixDoltOptions = {
    projectId: PROJECT_ID,
    beadsDir: BEADS_DIR,
    // allocate seam → returns the (idempotent) pinned port.
    allocatePort: vi.fn(() => PINNED_PORT),
    // install seam → verified-healthy supervisor by default.
    install: vi.fn(
      async (): Promise<InstallSupervisorResult> => ({
        ok: true,
        verified: true,
        label: `com.adjutant.dolt.${PROJECT_ID}`,
        bootstrapped: true,
      }),
    ),
    // launchd supervised PID (adj-182.2.7 source of truth for rogue classification).
    launchctlSupervisedPid: vi.fn(async () => SUPERVISED_PID),
    // process scan: only the supervised server, no rogues.
    scanDoltProcesses: vi.fn(async () => [
      { pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
    ] as DoltProcess[]),
    // kill seam — records, never executes.
    killProcess: vi.fn((pid: number) => {
      killCalls.push({ pid });
    }),
    // circuit-file clear seam — returns the paths it removed.
    clearCircuitFiles: vi.fn(async () => [] as string[]),
    ...overrides,
  };

  return { opts, killCalls };
}

describe("fixDolt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Port allocate + pin (via install) ───────────────────────────────────────
  it("should allocate the pinned port and pass it to the supervisor install", async () => {
    const { opts } = makeOpts();
    await fixDolt(opts);
    expect(opts.allocatePort).toHaveBeenCalledWith(PROJECT_ID);
    expect(opts.install).toHaveBeenCalledTimes(1);
    const installArg = vi.mocked(opts.install).mock.calls[0][0];
    expect(installArg.port).toBe(PINNED_PORT);
    expect(installArg.projectId).toBe(PROJECT_ID);
    expect(installArg.beadsDir).toBe(BEADS_DIR);
  });

  it("should report a PASS for the agent install when the supervisor verifies", async () => {
    const { opts } = makeOpts();
    const result = await fixDolt(opts);
    const r = result.results.find((x) => x.name.toLowerCase().includes("agent"));
    expect(r?.status).toBe("pass");
  });

  it("should report a FAIL for the agent install when the supervisor does not verify", async () => {
    const { opts } = makeOpts({
      install: vi.fn(async () => ({
        ok: false,
        verified: false,
        label: `com.adjutant.dolt.${PROJECT_ID}`,
        bootstrapped: true,
      })),
    });
    const result = await fixDolt(opts);
    const r = result.results.find((x) => x.name.toLowerCase().includes("agent"));
    expect(r?.status).toBe("fail");
  });

  // ── Rogue kill ──────────────────────────────────────────────────────────────
  it("should kill a rogue dolt on the data-dir that is not the supervised PID", async () => {
    const { opts, killCalls } = makeOpts({
      scanDoltProcesses: vi.fn(async () => [
        { pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
        { pid: 9999, port: 18000, cwd: `${BEADS_DIR}/dolt` },
      ]),
    });
    await fixDolt(opts);
    expect(killCalls.map((c) => c.pid)).toEqual([9999]);
  });

  it("should NOT kill the supervised server itself", async () => {
    const { opts, killCalls } = makeOpts();
    await fixDolt(opts);
    expect(killCalls).toHaveLength(0);
  });

  it("should NOT kill a dolt on a sibling data-dir sharing the path prefix", async () => {
    const { opts, killCalls } = makeOpts({
      scanDoltProcesses: vi.fn(async () => [
        { pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
        { pid: 9999, port: 18000, cwd: "/Users/me/proj/.beads-backup/dolt" },
      ]),
    });
    await fixDolt(opts);
    expect(killCalls).toHaveLength(0);
  });

  it("should refuse to kill a NON-pinned-port dolt when the launchd supervised PID is unknown", async () => {
    // adj-182.2.7 safety: with no supervised PID and a dolt on our data-dir that does
    // NOT hold our pinned port, we cannot tell rogue from legit — killing the wrong
    // process is worse than leaving a stale one. (A dolt that DOES hold the pinned port
    // is unambiguous and IS killed — see the adj-182.2.2.1 first-install tests below.)
    const { opts, killCalls } = makeOpts({
      launchctlSupervisedPid: vi.fn(async () => null),
      scanDoltProcesses: vi.fn(async () => [
        { pid: 7777, port: 18000, cwd: `${BEADS_DIR}/dolt` },
      ]),
    });
    await fixDolt(opts);
    expect(killCalls).toHaveLength(0);
  });

  // ── adj-182.2.2.1: first-install double-open + false-positive verify ──────────
  // On a FIRST install the launchd agent is not yet loaded, so launchctlSupervisedPid()
  // returns null. The OLD code refused to kill ANY rogue and then bootstrapped a SECOND
  // server on the SAME data-dir as a pre-existing rogue (two servers, one data-dir →
  // double-open corruption); worse, if the rogue held the pinned port, the SQL probe
  // connected to the rogue and falsely reported verified:true.
  describe("adj-182.2.2.1 first-install rogue handling (supervised PID unknown)", () => {
    it("should kill a rogue that holds the PINNED PORT even when the supervised PID is unknown", async () => {
      // Port ownership is unambiguous — only one process can LISTEN on the pinned port.
      // A dolt on our data-dir bound to OUR pinned port is the squatter we are about to
      // bootstrap over, so it is safe (and necessary) to kill before install.
      const { opts, killCalls } = makeOpts({
        launchctlSupervisedPid: vi.fn(async () => null),
        scanDoltProcesses: vi.fn(async () => [
          { pid: 7777, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
        ]),
      });
      const result = await fixDolt(opts);
      expect(killCalls.map((c) => c.pid)).toEqual([7777]);
      // After clearing the port squatter, the install proceeds.
      expect(opts.install).toHaveBeenCalledTimes(1);
      expect(result.killedPids).toEqual([7777]);
    });

    it("should kill the pinned-port squatter BEFORE installing the supervisor", async () => {
      const order: string[] = [];
      const { opts } = makeOpts({
        launchctlSupervisedPid: vi.fn(async () => null),
        killProcess: vi.fn(() => order.push("kill")),
        install: vi.fn(async () => {
          order.push("install");
          return { ok: true, verified: true, label: "x", bootstrapped: true };
        }),
        scanDoltProcesses: vi.fn(async () => [
          { pid: 7777, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
        ]),
      });
      await fixDolt(opts);
      expect(order).toEqual(["kill", "install"]);
    });

    it("should REFUSE to install (no double-open) when an unclassifiable rogue sits on the data-dir and cannot be killed", async () => {
      // supervised PID unknown AND the data-dir dolt does NOT hold our pinned port → we
      // cannot safely kill it, and bootstrapping anyway would put two servers on one
      // data-dir. Refuse: do not call install, report a FAIL, ok=false.
      const { opts, killCalls } = makeOpts({
        launchctlSupervisedPid: vi.fn(async () => null),
        scanDoltProcesses: vi.fn(async () => [
          { pid: 8888, port: 18000, cwd: `${BEADS_DIR}/dolt` },
        ]),
      });
      const result = await fixDolt(opts);
      expect(killCalls).toHaveLength(0);
      expect(opts.install).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      const installed = result.results.find((r) => r.name.toLowerCase().includes("agent"));
      expect(installed?.status).toBe("fail");
    });

    it("should install normally on a clean first install (no dolt on the data-dir, supervised PID unknown)", async () => {
      // The legitimate first-install case: nothing is running yet. Install proceeds.
      const { opts, killCalls } = makeOpts({
        launchctlSupervisedPid: vi.fn(async () => null),
        scanDoltProcesses: vi.fn(async () => []),
      });
      const result = await fixDolt(opts);
      expect(killCalls).toHaveLength(0);
      expect(opts.install).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    });

    it("should kill a pinned-port squatter but still REFUSE if another unclassifiable rogue remains on the data-dir", async () => {
      // Two rogues: one holds the pinned port (killable), one does not (unclassifiable).
      // After killing the port squatter, an unclassifiable dolt still co-owns the data-dir
      // → refuse to install rather than risk a double-open.
      const { opts, killCalls } = makeOpts({
        launchctlSupervisedPid: vi.fn(async () => null),
        scanDoltProcesses: vi.fn(async () => [
          { pid: 7777, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
          { pid: 8888, port: 18000, cwd: `${BEADS_DIR}/dolt` },
        ]),
      });
      const result = await fixDolt(opts);
      expect(killCalls.map((c) => c.pid)).toEqual([7777]);
      expect(opts.install).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
    });
  });

  // ── Circuit file clearing ─────────────────────────────────────────────────────
  it("should clear stale circuit-breaker files and report the count", async () => {
    const { opts } = makeOpts({
      clearCircuitFiles: vi.fn(async () => ["/tmp/beads-dolt-circuit-17005.json"]),
    });
    const result = await fixDolt(opts);
    expect(opts.clearCircuitFiles).toHaveBeenCalledTimes(1);
    const r = result.results.find((x) => x.name.toLowerCase().includes("circuit"));
    expect(r?.status).toBe("pass");
    expect(r?.message).toContain("1");
  });

  // adj-uk9af: the clear must be SCOPED to THIS project's pinned port — fixDolt passes
  // the resolved port to the clear seam so it can target only beads-dolt-circuit-<port>.json
  // (never wiping OTHER projects' breaker state via a broad glob).
  it("should pass the repaired pinned port to the circuit-file clear seam (adj-uk9af)", async () => {
    const { opts } = makeOpts({
      clearCircuitFiles: vi.fn(async () => [`/tmp/beads-dolt-circuit-${PINNED_PORT}.json`]),
    });
    await fixDolt(opts);
    expect(opts.clearCircuitFiles).toHaveBeenCalledWith(PINNED_PORT);
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────
  it("should be idempotent on a healthy system — pin same port, no kills, no circuit files", async () => {
    const { opts, killCalls } = makeOpts();
    const first = await fixDolt(opts);
    const second = await fixDolt(opts);
    expect(killCalls).toHaveLength(0);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // install called once per run (idempotent restart), allocate once per run.
    expect(opts.install).toHaveBeenCalledTimes(2);
    expect(opts.allocatePort).toHaveBeenCalledTimes(2);
  });

  it("should return ok=true when the agent verified and ok=false when it did not", async () => {
    const healthy = makeOpts();
    expect((await fixDolt(healthy.opts)).ok).toBe(true);

    const broken = makeOpts({
      install: vi.fn(async () => ({
        ok: false,
        verified: false,
        label: `com.adjutant.dolt.${PROJECT_ID}`,
        bootstrapped: false,
      })),
    });
    expect((await fixDolt(broken.opts)).ok).toBe(false);
  });

  // ── Ordering: kill rogues BEFORE the install so the supervised server owns the
  //    data-dir cleanly (two servers on one data-dir risk double-open corruption). ─
  it("should kill rogues before installing the supervisor", async () => {
    const order: string[] = [];
    const { opts } = makeOpts({
      killProcess: vi.fn(() => order.push("kill")),
      install: vi.fn(async () => {
        order.push("install");
        return { ok: true, verified: true, label: "x", bootstrapped: true };
      }),
      scanDoltProcesses: vi.fn(async () => [
        { pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
        { pid: 9999, port: 18000, cwd: `${BEADS_DIR}/dolt` },
      ]),
    });
    await fixDolt(opts);
    expect(order.indexOf("kill")).toBeLessThan(order.indexOf("install"));
  });
});
