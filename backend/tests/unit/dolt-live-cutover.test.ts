/**
 * Tests for doltLiveCutover() (adj-182.1.6, T006a/b).
 *
 * `doltLiveCutover(opts)` migrates a RUNNING project from a self-managed, random-
 * ephemeral-port Dolt server to the supervised, pinned-port server WITHOUT data
 * loss. It enforces a strict order:
 *   1. quiesce        — pause/settle in-flight bd writes
 *   2. stopLazy       — stop the self-managed (lazy) server bd spawned
 *   3. installSupervisor — start the supervised server on the pinned port + verify
 *      via SQL probe
 *   4. clearCircuit   — delete stale /tmp/beads-dolt-circuit-*.json breaker files
 *   5. restartBackend — trigger backend re-init against the pinned endpoint
 *
 * SAFETY ABORT: if the supervised server fails its SQL probe (install not ok),
 * the cutover ABORTS — it does NOT clear circuit files and does NOT restart the
 * backend. Better to leave the (still-running) old topology than to point the
 * backend at a dead server.
 *
 * ALL effects are INJECTED seams. These tests NEVER stop/start a real dolt server,
 * never restart a real backend, and never touch real /tmp circuit files. The real
 * cutover is a SEPARATE operator step (runbook-cutover.md), not exercised here.
 */

import { describe, it, expect, vi } from "vitest";

import {
  doltLiveCutover,
  type DoltLiveCutoverOptions,
} from "../../../cli/lib/dolt-supervisor.js";

/** Build seamed cutover options that record the order of operations. */
function makeOpts(overrides: Partial<DoltLiveCutoverOptions> = {}): {
  opts: DoltLiveCutoverOptions;
  order: string[];
  cleared: string[];
} {
  const order: string[] = [];
  const cleared: string[] = [];

  const opts: DoltLiveCutoverOptions = {
    projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    beadsDir: "/Users/me/proj/.beads",
    port: 17005,
    quiesce: vi.fn(async () => {
      order.push("quiesce");
    }),
    stopLazyServer: vi.fn(async () => {
      order.push("stopLazy");
    }),
    install: vi.fn(async () => {
      order.push("install");
      return { ok: true, verified: true, label: "com.adjutant.dolt.x", bootstrapped: true };
    }),
    clearCircuitFiles: vi.fn(async () => {
      order.push("clearCircuit");
      cleared.push("/tmp/beads-dolt-circuit-host-49599.json");
      return ["/tmp/beads-dolt-circuit-host-49599.json"];
    }),
    restartBackend: vi.fn(async () => {
      order.push("restartBackend");
    }),
    ...overrides,
  };

  return { opts, order, cleared };
}

describe("doltLiveCutover", () => {
  it("should run the steps in the mandated order on a successful cutover", async () => {
    const h = makeOpts();
    const result = await doltLiveCutover(h.opts);
    expect(result.ok).toBe(true);
    expect(h.order).toEqual([
      "quiesce",
      "stopLazy",
      "install",
      "clearCircuit",
      "restartBackend",
    ]);
  });

  it("should stop the lazy server BEFORE starting the supervised one", async () => {
    const h = makeOpts();
    await doltLiveCutover(h.opts);
    expect(h.order.indexOf("stopLazy")).toBeLessThan(h.order.indexOf("install"));
  });

  it("should clear circuit files only AFTER the supervised server verifies", async () => {
    const h = makeOpts();
    await doltLiveCutover(h.opts);
    expect(h.order.indexOf("install")).toBeLessThan(h.order.indexOf("clearCircuit"));
  });

  it("should restart the backend LAST (after clearing circuit files)", async () => {
    const h = makeOpts();
    await doltLiveCutover(h.opts);
    expect(h.order.indexOf("clearCircuit")).toBeLessThan(h.order.indexOf("restartBackend"));
  });

  it("should install the supervisor on the pinned port", async () => {
    const h = makeOpts();
    await doltLiveCutover(h.opts);
    expect(h.opts.install).toHaveBeenCalledWith(
      expect.objectContaining({ port: 17005, projectId: h.opts.projectId }),
    );
  });

  it("should report the cleared circuit files in the result", async () => {
    const h = makeOpts();
    const result = await doltLiveCutover(h.opts);
    expect(result.clearedCircuitFiles).toEqual([
      "/tmp/beads-dolt-circuit-host-49599.json",
    ]);
  });

  describe("safety abort when the supervised server fails its SQL probe", () => {
    it("should NOT clear circuit files when install does not verify", async () => {
      const h = makeOpts({
        install: vi.fn(async () => ({
          ok: false,
          verified: false,
          label: "com.adjutant.dolt.x",
          bootstrapped: true,
        })),
      });
      const result = await doltLiveCutover(h.opts);
      expect(result.ok).toBe(false);
      expect(h.opts.clearCircuitFiles).not.toHaveBeenCalled();
    });

    it("should NOT restart the backend when install does not verify", async () => {
      const h = makeOpts({
        install: vi.fn(async () => ({
          ok: false,
          verified: false,
          label: "com.adjutant.dolt.x",
          bootstrapped: false,
        })),
      });
      const result = await doltLiveCutover(h.opts);
      expect(result.ok).toBe(false);
      expect(h.opts.restartBackend).not.toHaveBeenCalled();
    });

    it("should still have quiesced and stopped the lazy server before aborting", async () => {
      // quiesce + stopLazy happen before install, so they run even on abort; the
      // abort only skips the post-verify steps (clearCircuit + restartBackend).
      const h = makeOpts();
      // Replace the install seam with a failing one that STILL records its call so
      // we can assert install ran but the post-verify steps did not.
      h.opts.install = vi.fn(async () => {
        h.order.push("install");
        return { ok: false, verified: false, label: "com.adjutant.dolt.x", bootstrapped: true };
      });
      await doltLiveCutover(h.opts);
      expect(h.opts.quiesce).toHaveBeenCalled();
      expect(h.opts.stopLazyServer).toHaveBeenCalled();
      // Aborted right after install — no clearCircuit, no restartBackend.
      expect(h.order).toEqual(["quiesce", "stopLazy", "install"]);
    });

    it("should surface the failed install result in the abort", async () => {
      const failingInstall = {
        ok: false,
        verified: false,
        label: "com.adjutant.dolt.x",
        bootstrapped: true,
      };
      const h = makeOpts({ install: vi.fn(async () => failingInstall) });
      const result = await doltLiveCutover(h.opts);
      expect(result.ok).toBe(false);
      expect(result.install).toEqual(failingInstall);
    });
  });
});
