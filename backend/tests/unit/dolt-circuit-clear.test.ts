/**
 * Tests for the PORT-SCOPED circuit-file clear (adj-uk9af).
 *
 * Bug: `doctor --fix` realClearCircuitFiles() deleted EVERY
 * `/tmp/beads-dolt-circuit-*.json` via a broad glob, wiping the in-process
 * circuit-breaker state of every OTHER beads project/port on the host (bd 0.60.0 names
 * them per-port: `/tmp/beads-dolt-circuit-<port>.json`). A healthy concurrent project on
 * another port lost its breaker cooldown as collateral — and this would fire DURING the
 * live cutover.
 *
 * Fix: scope the clear to the repaired project's pinned port only.
 * `clearCircuitFileForPort(port, seams)` removes exactly `beads-dolt-circuit-<port>.json`
 * (and nothing else). fs seams are INJECTED so this test touches no real /tmp file.
 */

import { describe, it, expect, vi } from "vitest";

import { clearCircuitFileForPort, type CircuitClearSeams } from "../../../cli/lib/dolt-circuit-clear.js";

const PORT = 17005;

/** Build injected fs seams over an in-memory /tmp listing, recording removals. */
function makeSeams(entries: string[]): { seams: CircuitClearSeams; removed: string[] } {
  const removed: string[] = [];
  const seams: CircuitClearSeams = {
    tmpDir: "/tmp",
    readdir: vi.fn(() => entries),
    remove: vi.fn((p: string) => {
      removed.push(p);
    }),
  };
  return { seams, removed };
}

describe("clearCircuitFileForPort (adj-uk9af)", () => {
  it("should remove ONLY this port's circuit file, leaving other projects' files intact", () => {
    const { seams, removed } = makeSeams([
      "beads-dolt-circuit-17005.json",
      "beads-dolt-circuit-49820.json",
      "beads-dolt-circuit-50760.json",
      "some-other-file.json",
    ]);
    const cleared = clearCircuitFileForPort(PORT, seams);
    expect(removed).toEqual(["/tmp/beads-dolt-circuit-17005.json"]);
    expect(cleared).toEqual(["/tmp/beads-dolt-circuit-17005.json"]);
  });

  it("should return [] (and remove nothing) when this port has no circuit file", () => {
    const { seams, removed } = makeSeams([
      "beads-dolt-circuit-49820.json",
      "beads-dolt-circuit-50760.json",
    ]);
    const cleared = clearCircuitFileForPort(PORT, seams);
    expect(removed).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("should never match a different port that merely shares a digit prefix", () => {
    // 17005 must NOT match 170050 or 1700 — exact port only.
    const { seams, removed } = makeSeams([
      "beads-dolt-circuit-170050.json",
      "beads-dolt-circuit-1700.json",
    ]);
    clearCircuitFileForPort(PORT, seams);
    expect(removed).toEqual([]);
  });

  it("should be best-effort: a remove failure does not throw and does not abort", () => {
    const { seams } = makeSeams(["beads-dolt-circuit-17005.json"]);
    (seams.remove as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("EPERM");
    });
    expect(() => clearCircuitFileForPort(PORT, seams)).not.toThrow();
  });

  it("should return [] when the tmp dir cannot be read", () => {
    const seams: CircuitClearSeams = {
      tmpDir: "/tmp",
      readdir: vi.fn(() => {
        throw new Error("ENOENT");
      }),
      remove: vi.fn(),
    };
    expect(clearCircuitFileForPort(PORT, seams)).toEqual([]);
  });
});
