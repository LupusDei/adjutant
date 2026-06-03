/**
 * Tests for the shared first-install rogue guard (adj-182.2.2.1).
 *
 * Both `doctor --fix` (fixDolt) and `adjutant init` (initDoltSupervisor) must avoid the
 * two-servers-on-one-data-dir double-open: before bootstrapping the supervised server
 * they classify any dolt already running under THIS project's data-dir.
 *
 * `classifyDataDirRogues` is the pure decision the two callers share:
 *   - supervised PID KNOWN (launchd loaded): every data-dir dolt that is NOT the
 *     supervised PID is a rogue to kill.
 *   - supervised PID UNKNOWN (first install): a data-dir dolt that holds the PINNED PORT
 *     is an unambiguous squatter → kill it; any OTHER data-dir dolt is unclassifiable →
 *     do not kill, and signal that the install must be REFUSED (would double-open).
 *
 * Pure function — no I/O, fully unit-testable.
 */

import { describe, it, expect } from "vitest";

import { classifyDataDirRogues } from "../../../cli/lib/dolt-rogue-guard.js";
import type { DoltProcess } from "../../../cli/lib/dolt-rogue-guard.js";

const BEADS_DIR = "/Users/me/proj/.beads";
const PINNED_PORT = 17005;
const SUPERVISED_PID = 4242;

describe("classifyDataDirRogues", () => {
  it("should kill non-supervised data-dir dolts when the supervised PID is known", () => {
    const procs: DoltProcess[] = [
      { pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
      { pid: 9999, port: 18000, cwd: `${BEADS_DIR}/dolt` },
    ];
    const r = classifyDataDirRogues(procs, {
      beadsDir: BEADS_DIR,
      pinnedPort: PINNED_PORT,
      supervisedPid: SUPERVISED_PID,
    });
    expect(r.killPids).toEqual([9999]);
    expect(r.refuseInstall).toBe(false);
  });

  it("should never target the supervised PID itself", () => {
    const r = classifyDataDirRogues(
      [{ pid: SUPERVISED_PID, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` }],
      { beadsDir: BEADS_DIR, pinnedPort: PINNED_PORT, supervisedPid: SUPERVISED_PID },
    );
    expect(r.killPids).toEqual([]);
    expect(r.refuseInstall).toBe(false);
  });

  it("should ignore dolts on a sibling data-dir that merely shares the path prefix", () => {
    const r = classifyDataDirRogues(
      [{ pid: 9999, port: 18000, cwd: "/Users/me/proj/.beads-backup/dolt" }],
      { beadsDir: BEADS_DIR, pinnedPort: PINNED_PORT, supervisedPid: SUPERVISED_PID },
    );
    expect(r.killPids).toEqual([]);
    expect(r.refuseInstall).toBe(false);
  });

  it("should kill a pinned-port squatter even when the supervised PID is unknown", () => {
    const r = classifyDataDirRogues(
      [{ pid: 7777, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` }],
      { beadsDir: BEADS_DIR, pinnedPort: PINNED_PORT, supervisedPid: null },
    );
    expect(r.killPids).toEqual([7777]);
    expect(r.refuseInstall).toBe(false);
  });

  it("should refuse install for an unclassifiable data-dir dolt when the supervised PID is unknown", () => {
    const r = classifyDataDirRogues(
      [{ pid: 8888, port: 18000, cwd: `${BEADS_DIR}/dolt` }],
      { beadsDir: BEADS_DIR, pinnedPort: PINNED_PORT, supervisedPid: null },
    );
    expect(r.killPids).toEqual([]);
    expect(r.refuseInstall).toBe(true);
  });

  it("should kill the pinned-port squatter AND still refuse if another unclassifiable dolt remains", () => {
    const r = classifyDataDirRogues(
      [
        { pid: 7777, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
        { pid: 8888, port: 18000, cwd: `${BEADS_DIR}/dolt` },
      ],
      { beadsDir: BEADS_DIR, pinnedPort: PINNED_PORT, supervisedPid: null },
    );
    expect(r.killPids).toEqual([7777]);
    expect(r.refuseInstall).toBe(true);
  });

  it("should allow a clean first install (no dolt on the data-dir, supervised PID unknown)", () => {
    const r = classifyDataDirRogues([], {
      beadsDir: BEADS_DIR,
      pinnedPort: PINNED_PORT,
      supervisedPid: null,
    });
    expect(r.killPids).toEqual([]);
    expect(r.refuseInstall).toBe(false);
  });

  it("should treat a data-dir dolt with an unknown (null) port as unclassifiable when supervised PID is unknown", () => {
    const r = classifyDataDirRogues(
      [{ pid: 5555, port: null, cwd: `${BEADS_DIR}/dolt` }],
      { beadsDir: BEADS_DIR, pinnedPort: PINNED_PORT, supervisedPid: null },
    );
    expect(r.killPids).toEqual([]);
    expect(r.refuseInstall).toBe(true);
  });
});
