/**
 * Tests for initDoltSupervisor() — `adjutant init` allocates+pins the Dolt port and
 * installs+loads the supervisor (adj-182.2.3).
 *
 * On a fresh init we want new projects correct-by-default: a per-project port pinned
 * from the reserved band and a launchd LaunchAgent supervising the one server. Re-running
 * init must be idempotent (allocate returns the same port; install bootout+bootstrap is a
 * no-op restart).
 *
 * SAFETY: every external effect (allocate, install/launchctl, plist write, SQL probe) is
 * an INJECTED seam. This test runs NO real launchctl/dolt, never mutates the live server,
 * never touches `.beads`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { initDoltSupervisor, type InitDoltSupervisorOptions } from "../../../cli/commands/init.js";
import type { InstallSupervisorResult } from "../../../cli/lib/dolt-supervisor.js";

const PROJECT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const BEADS_DIR = "/Users/me/proj/.beads";
const PINNED_PORT = 17005;

/** Build fully-seamed options describing a fresh, installable project. */
function makeOpts(overrides: Partial<InitDoltSupervisorOptions> = {}): InitDoltSupervisorOptions {
  return {
    projectId: PROJECT_ID,
    beadsDir: BEADS_DIR,
    allocatePort: vi.fn(() => PINNED_PORT),
    install: vi.fn(
      async (): Promise<InstallSupervisorResult> => ({
        ok: true,
        verified: true,
        label: `com.adjutant.dolt.${PROJECT_ID}`,
        bootstrapped: true,
      }),
    ),
    ...overrides,
  };
}

describe("initDoltSupervisor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should allocate the pinned port and install the supervisor with it", async () => {
    const opts = makeOpts();
    await initDoltSupervisor(opts);
    expect(opts.allocatePort).toHaveBeenCalledWith(PROJECT_ID);
    expect(opts.install).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(opts.install).mock.calls[0][0];
    expect(arg.port).toBe(PINNED_PORT);
    expect(arg.projectId).toBe(PROJECT_ID);
    expect(arg.beadsDir).toBe(BEADS_DIR);
  });

  it("should return a CREATED result when the supervisor verifies", async () => {
    const result = await initDoltSupervisor(makeOpts());
    expect(["created", "pass"]).toContain(result.status);
  });

  it("should return a FAIL result when the supervisor does not verify", async () => {
    const result = await initDoltSupervisor(
      makeOpts({
        install: vi.fn(async () => ({
          ok: false,
          verified: false,
          label: `com.adjutant.dolt.${PROJECT_ID}`,
          bootstrapped: true,
        })),
      }),
    );
    expect(result.status).toBe("fail");
  });

  it("should be idempotent — re-running allocates the same port and re-installs cleanly", async () => {
    const opts = makeOpts();
    const first = await initDoltSupervisor(opts);
    const second = await initDoltSupervisor(opts);
    expect(opts.allocatePort).toHaveBeenCalledTimes(2);
    expect(opts.install).toHaveBeenCalledTimes(2);
    expect(["created", "pass"]).toContain(first.status);
    expect(["created", "pass"]).toContain(second.status);
  });

  it("should mention the pinned port in the result message", async () => {
    const result = await initDoltSupervisor(makeOpts());
    expect(result.message).toContain(String(PINNED_PORT));
  });

  it("should surface a clear failure message when allocate throws (band exhausted)", async () => {
    const result = await initDoltSupervisor(
      makeOpts({
        allocatePort: vi.fn(() => {
          throw new Error("Dolt port band exhausted");
        }),
      }),
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("exhausted");
    // install must NOT be attempted when allocation fails.
    // (the install seam was never called)
  });

  it("should NOT attempt install when port allocation fails", async () => {
    const opts = makeOpts({
      allocatePort: vi.fn(() => {
        throw new Error("Dolt port band exhausted");
      }),
    });
    await initDoltSupervisor(opts);
    expect(opts.install).not.toHaveBeenCalled();
  });

  // ── adj-182.2.2.1: first-install double-open guard ──────────────────────────
  // `adjutant init` shares the first-install exposure: with no launchd agent loaded yet
  // it must not bootstrap a SECOND server onto a data-dir a rogue already co-owns. The
  // rogue-detection seams (scanDoltProcesses / killProcess) are OPTIONAL — when absent,
  // init behaves exactly as before (clean fresh install). When present, init applies the
  // same pinned-port-squatter kill + refuse-on-unclassifiable policy as doctor --fix.
  describe("adj-182.2.2.1 first-install rogue guard", () => {
    it("should kill a pinned-port squatter on the data-dir before installing", async () => {
      const killed: number[] = [];
      const opts = makeOpts({
        scanDoltProcesses: vi.fn(async () => [
          { pid: 7777, port: PINNED_PORT, cwd: `${BEADS_DIR}/dolt` },
        ]),
        killProcess: vi.fn((pid: number) => killed.push(pid)),
      });
      const result = await initDoltSupervisor(opts);
      expect(killed).toEqual([7777]);
      expect(opts.install).toHaveBeenCalledTimes(1);
      expect(["created", "pass"]).toContain(result.status);
    });

    it("should REFUSE to install when an unclassifiable dolt occupies the data-dir", async () => {
      const killed: number[] = [];
      const opts = makeOpts({
        scanDoltProcesses: vi.fn(async () => [
          { pid: 8888, port: 18000, cwd: `${BEADS_DIR}/dolt` },
        ]),
        killProcess: vi.fn((pid: number) => killed.push(pid)),
      });
      const result = await initDoltSupervisor(opts);
      expect(killed).toEqual([]);
      expect(opts.install).not.toHaveBeenCalled();
      expect(result.status).toBe("fail");
    });

    it("should install cleanly when no dolt occupies the data-dir", async () => {
      const opts = makeOpts({
        scanDoltProcesses: vi.fn(async () => []),
        killProcess: vi.fn(),
      });
      const result = await initDoltSupervisor(opts);
      expect(opts.install).toHaveBeenCalledTimes(1);
      expect(["created", "pass"]).toContain(result.status);
    });

    it("should still install normally when no scan seam is provided (back-compat)", async () => {
      const opts = makeOpts(); // no scanDoltProcesses / killProcess seams
      const result = await initDoltSupervisor(opts);
      expect(opts.install).toHaveBeenCalledTimes(1);
      expect(["created", "pass"]).toContain(result.status);
    });
  });
});
