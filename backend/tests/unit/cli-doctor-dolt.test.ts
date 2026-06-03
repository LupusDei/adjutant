/**
 * Tests for checkDolt() — the Dolt health-check group in `adjutant doctor`
 * (adj-182.2.1, folding in adj-182.2.7).
 *
 * checkDolt() verifies, each as a CheckResult:
 *   1. Port pinned        — metadata.json `dolt_server_port` (or env) is set + matches
 *                           the registry-allocated port for this project.
 *   2. Agent loaded       — the launchd LaunchAgent `com.adjutant.dolt.<projectId>` is
 *                           loaded (probed via the injected launchctl seam).
 *   3. Server reachable    — a SQL probe on the PINNED PORT succeeds. NEVER the PID file
 *                           (the #2670 false-up — a stale/rogue PID can look "up").
 *   4. Port-file matches   — `.beads/dolt-server.port` == the pinned port.
 *   5. No cross-project     — no OTHER project in `~/.adjutant/projects.json` was allocated
 *      collision            the same `doltPort`.
 *   6. No rogue dolt        — no dolt sql-server with a cwd under THIS data-dir whose PID
 *                            is NOT the supervised instance.
 *
 * adj-182.2.7 fold-in: the supervised PID used to tell rogues apart is derived from
 * launchd (`launchctl print`), NOT the possibly-stale `.beads/dolt-server.pid`. So a
 * rogue dolt that happens to reuse the pidfile's PID is still flagged rogue.
 *
 * SAFETY: every external effect (SQL probe, launchctl, ps/lsof scan, registry + file
 * reads) is an INJECTED seam. This test NEVER runs real launchctl/ps/dolt, never
 * touches the live server, never mutates `.beads`. checkDolt is read/diagnostic only.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  checkDolt,
  type CheckDoltOptions,
  type DoltProcess,
} from "../../../cli/commands/doctor.js";
import type { CheckResult } from "../../../cli/lib/output.js";

const PROJECT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const BEADS_DIR = "/Users/me/proj/.beads";
const PINNED_PORT = 17005;
const SUPERVISED_PID = 4242;

/** Look up a single CheckResult by a substring of its name. */
function find(results: CheckResult[], nameContains: string): CheckResult | undefined {
  return results.find((r) => r.name.toLowerCase().includes(nameContains.toLowerCase()));
}

/** Build fully-seamed options describing a HEALTHY supervised dolt server. */
function makeOpts(overrides: Partial<CheckDoltOptions> = {}): CheckDoltOptions {
  return {
    projectId: PROJECT_ID,
    beadsDir: BEADS_DIR,
    // Registry seam: the pinned port for THIS project, and the full allocation map for
    // cross-project collision detection.
    pinnedPort: PINNED_PORT,
    portAllocations: [{ projectId: PROJECT_ID, doltPort: PINNED_PORT }],
    // metadata.json `dolt_server_port` (externally-managed mode marker).
    metadataPort: PINNED_PORT,
    // `.beads/dolt-server.port` contents.
    portFileValue: PINNED_PORT,
    // launchd: agent loaded + the supervised PID it reports (adj-182.2.7 source of truth).
    launchctlSupervisedPid: vi.fn(async () => SUPERVISED_PID),
    // SQL probe on the pinned port — true == reachable.
    sqlProbe: vi.fn(async () => true),
    // ps/lsof scan: the one supervised server, no rogues.
    scanDoltProcesses: vi.fn(async () => [
      { pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
    ] as DoltProcess[]),
    ...overrides,
  };
}

describe("checkDolt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Port pinned ────────────────────────────────────────────────────────
  it("should PASS the port-pinned check when metadata dolt_server_port matches the registry", async () => {
    const results = await checkDolt(makeOpts());
    const r = find(results, "pinned");
    expect(r?.status).toBe("pass");
  });

  // adj-182.2.1.r2 — rollout exit-code contract. A clean, not-yet-migrated self-managed
  // project (both pinnedPort AND metadataPort null) must NOT emit three FAILs for one
  // root cause (which forced doctor exit 1 on every pre-cutover project). Emit ONE
  // actionable non-fail result and SKIP the dependent reachable/port-file checks.
  describe("adj-182.2.1.r2 self-managed (not-yet-migrated) contract", () => {
    it("should emit a single non-fail self-managed notice when both pinned and metadata ports are null", async () => {
      const results = await checkDolt(makeOpts({ metadataPort: null, pinnedPort: null }));
      const r = find(results, "self-managed");
      expect(r).toBeDefined();
      expect(["info", "warn"]).toContain(r?.status);
    });

    it("should NOT emit any FAIL for a clean self-managed project (no exit-1 pre-migration)", async () => {
      const results = await checkDolt(
        makeOpts({
          metadataPort: null,
          pinnedPort: null,
          portFileValue: null,
          launchctlSupervisedPid: vi.fn(async () => null),
          scanDoltProcesses: vi.fn(async () => []),
        }),
      );
      expect(results.some((r) => r.status === "fail")).toBe(false);
    });

    it("should SKIP the reachable + port-file checks for a clean self-managed project", async () => {
      const opts = makeOpts({
        metadataPort: null,
        pinnedPort: null,
        portFileValue: null,
        launchctlSupervisedPid: vi.fn(async () => null),
        scanDoltProcesses: vi.fn(async () => []),
      });
      const results = await checkDolt(opts);
      expect(find(results, "reachable")).toBeUndefined();
      expect(find(results, "port file")).toBeUndefined();
      // It must not even probe when there is nothing pinned to reach.
      expect(opts.sqlProbe).not.toHaveBeenCalled();
    });

    it("should still FAIL (expected-supervised) when only the metadata port is set without a registry pin", async () => {
      // A genuine inconsistency, not a clean self-managed state — keep the hard FAIL.
      const results = await checkDolt(makeOpts({ pinnedPort: null, metadataPort: 17005 }));
      expect(results.some((r) => r.status === "fail")).toBe(true);
    });

    it("should still FAIL (expected-supervised) when only the registry pin is set without metadata", async () => {
      const results = await checkDolt(makeOpts({ pinnedPort: 17005, metadataPort: null }));
      expect(results.some((r) => r.status === "fail")).toBe(true);
    });
  });

  it("should FAIL the port-pinned check when metadata port disagrees with the registry", async () => {
    const results = await checkDolt(makeOpts({ metadataPort: 17009 }));
    const r = find(results, "pinned");
    expect(r?.status).toBe("fail");
  });

  // ── 2. Agent loaded ─────────────────────────────────────────────────────────
  it("should PASS the agent-loaded check when launchctl reports the supervised PID", async () => {
    const results = await checkDolt(makeOpts());
    const r = find(results, "agent");
    expect(r?.status).toBe("pass");
  });

  it("should FAIL the agent-loaded check when launchctl reports no loaded agent", async () => {
    const results = await checkDolt(makeOpts({ launchctlSupervisedPid: vi.fn(async () => null) }));
    const r = find(results, "agent");
    expect(r?.status).toBe("fail");
  });

  // ── 3. Server reachable via SQL probe (NOT the PID) ─────────────────────────
  it("should PASS the reachable check when the SQL probe on the pinned port succeeds", async () => {
    const opts = makeOpts();
    const results = await checkDolt(opts);
    const r = find(results, "reachable");
    expect(r?.status).toBe("pass");
    // It probes the PINNED PORT, not the pid file.
    expect(opts.sqlProbe).toHaveBeenCalledWith(PINNED_PORT);
  });

  it("should FAIL the reachable check when the SQL probe fails even though a PID file exists", async () => {
    // The #2670 false-up: a pidfile/process exists but the server is NOT actually
    // serving on the pinned port. checkDolt must trust the probe, not the PID.
    const results = await checkDolt(makeOpts({ sqlProbe: vi.fn(async () => false) }));
    const r = find(results, "reachable");
    expect(r?.status).toBe("fail");
  });

  it("should NOT probe when no port is pinned (nothing to reach)", async () => {
    const opts = makeOpts({ metadataPort: null, pinnedPort: null });
    await checkDolt(opts);
    expect(opts.sqlProbe).not.toHaveBeenCalled();
  });

  // ── 4. Port-file matches pinned port ────────────────────────────────────────
  it("should PASS the port-file check when .beads/dolt-server.port equals the pinned port", async () => {
    const results = await checkDolt(makeOpts());
    const r = find(results, "port file");
    expect(r?.status).toBe("pass");
  });

  it("should FAIL the port-file check when .beads/dolt-server.port is stale", async () => {
    const results = await checkDolt(makeOpts({ portFileValue: 17099 }));
    const r = find(results, "port file");
    expect(r?.status).toBe("fail");
  });

  // ── 5. No cross-project port collision ──────────────────────────────────────
  it("should PASS the collision check when this project's port is unique in the registry", async () => {
    const results = await checkDolt(makeOpts());
    const r = find(results, "collision");
    expect(r?.status).toBe("pass");
  });

  it("should FAIL the collision check when another project was allocated the same port", async () => {
    const results = await checkDolt(
      makeOpts({
        portAllocations: [
          { projectId: PROJECT_ID, doltPort: PINNED_PORT },
          { projectId: "other-project-uuid", doltPort: PINNED_PORT },
        ],
      }),
    );
    const r = find(results, "collision");
    expect(r?.status).toBe("fail");
  });

  // ── 6. No rogue dolt on the data-dir ────────────────────────────────────────
  it("should PASS the rogue check when the only dolt on this data-dir is the supervised PID", async () => {
    const results = await checkDolt(makeOpts());
    const r = find(results, "rogue");
    expect(r?.status).toBe("pass");
  });

  it("should FAIL the rogue check when a non-supervised dolt has a cwd under this data-dir", async () => {
    const results = await checkDolt(
      makeOpts({
        scanDoltProcesses: vi.fn(async () => [
          { pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
          { pid: 9999, port: 18000, cwd: `${BEADS_DIR}/dolt` },
        ]),
      }),
    );
    const r = find(results, "rogue");
    expect(r?.status).toBe("fail");
  });

  it("should NOT flag a dolt on a SIBLING data-dir that merely shares the path prefix", async () => {
    // Path-boundary match (adj-182.1.5.1): `.beads-backup` shares the `.beads` prefix
    // but belongs to ANOTHER project — never a rogue for us.
    const results = await checkDolt(
      makeOpts({
        scanDoltProcesses: vi.fn(async () => [
          { pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
          { pid: 9999, port: 18000, cwd: "/Users/me/proj/.beads-backup/dolt" },
        ]),
      }),
    );
    const r = find(results, "rogue");
    expect(r?.status).toBe("pass");
  });

  // ── adj-182.2.7: supervised PID from launchd, NOT the stale pidfile ─────────
  it("should derive the supervised PID from launchd and flag a rogue that reuses the pidfile PID", async () => {
    // The stale pidfile says PID 4242 is the server. A rogue dolt is ALSO running as
    // PID 4242 on our data-dir, but launchd reports the REAL supervised PID is 5000.
    // Trusting the pidfile would treat the rogue as legitimate; trusting launchd
    // (adj-182.2.7) correctly flags 4242 as rogue.
    const results = await checkDolt(
      makeOpts({
        pidFileValue: 4242,
        launchctlSupervisedPid: vi.fn(async () => 5000),
        scanDoltProcesses: vi.fn(async () => [
          { pid: 5000, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
          { pid: 4242, port: 18000, cwd: `${BEADS_DIR}/dolt` },
        ]),
      }),
    );
    const rogue = find(results, "rogue");
    expect(rogue?.status).toBe("fail");
  });

  it("should NOT kill or guess when launchd reports no supervised PID (refuse to classify rogues)", async () => {
    // When the agent is not loaded, the supervised PID is unknown. checkDolt must NOT
    // declare a dolt on our data-dir a rogue (killing the wrong process is worse than a
    // stale file). The rogue check degrades to a warn, not a fail.
    const results = await checkDolt(
      makeOpts({
        launchctlSupervisedPid: vi.fn(async () => null),
        scanDoltProcesses: vi.fn(async () => [
          { pid: 7777, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
        ]),
      }),
    );
    const rogue = find(results, "rogue");
    expect(rogue?.status).not.toBe("fail");
  });

  // ── Aggregate ───────────────────────────────────────────────────────────────
  it("should return one CheckResult per dolt dimension on a healthy system, all passing", async () => {
    const results = await checkDolt(makeOpts());
    expect(results.length).toBeGreaterThanOrEqual(6);
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });

  it("should be read-only — it never invokes a kill/mutation seam (no such seam exists)", async () => {
    // checkDolt's options expose only diagnostic seams. This is a structural guard:
    // the only async seams are the probe, launchctl print, and the process scan.
    const opts = makeOpts();
    await checkDolt(opts);
    expect(opts.scanDoltProcesses).toHaveBeenCalledTimes(1);
    expect(opts.launchctlSupervisedPid).toHaveBeenCalled();
  });
});
