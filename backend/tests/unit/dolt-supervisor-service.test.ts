/**
 * adj-182.2.5 — Backend dolt-supervisor service (TDD).
 *
 * `ensureDoltSupervisor()` is the backend's self-heal entry point:
 *   - GATED behind a default-OFF env flag (ADJUTANT_DOLT_SUPERVISOR). When the
 *     flag is unset/0 (the default) it is a NO-OP at boot — so merging this does
 *     NOT adopt the supervisor or trigger a cutover on the running backend.
 *   - When the flag is on: load the launchd agent if it is not already loaded,
 *     then run a health loop that SQL-probes the pinned port on an interval; on a
 *     probe FAILURE it `launchctl kickstart -k`s the agent AND re-inits the
 *     bd-client connection (reuse adj-182.2.4), so a churned endpoint recovers
 *     without a backend restart.
 *
 * Every external effect (flag read, agent load/probe/kickstart, bd-client
 * re-init, interval scheduling, logging) is an INJECTED seam so the unit test
 * never loads a real launchd agent, probes a real server, or touches the wall
 * clock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ensureDoltSupervisor,
  doltWriteProbe,
  type DoltSupervisorSeams,
  type DoltSupervisorHandle,
} from "../../src/services/dolt-supervisor.js";

/** Build a seam set with safe defaults, overridable per-test. */
function makeSeams(overrides: Partial<DoltSupervisorSeams> = {}): DoltSupervisorSeams {
  return {
    projectId: "proj-uuid",
    pinnedPort: 17005,
    isFlagEnabled: () => true,
    isAgentLoaded: vi.fn(async () => true),
    loadAgent: vi.fn(async () => true),
    kickstartAgent: vi.fn(async () => {}),
    sqlProbe: vi.fn(async () => true),
    reinitBdClient: vi.fn(),
    probeIntervalMs: 1000,
    // Synchronous interval seam the test drives manually.
    setIntervalFn: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
    clearIntervalFn: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

describe("ensureDoltSupervisor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should be a NO-OP when the flag is unset/off (the default)", async () => {
    const seams = makeSeams({ isFlagEnabled: () => false });

    const handle = await ensureDoltSupervisor(seams);

    expect(handle.enabled).toBe(false);
    // Nothing touched: no agent load, no probe, no interval scheduled.
    expect(seams.isAgentLoaded).not.toHaveBeenCalled();
    expect(seams.loadAgent).not.toHaveBeenCalled();
    expect(seams.setIntervalFn).not.toHaveBeenCalled();
    expect(seams.sqlProbe).not.toHaveBeenCalled();
  });

  it("should load the launchd agent when the flag is on and the agent is not loaded", async () => {
    const isAgentLoaded = vi.fn(async () => false);
    const loadAgent = vi.fn(async () => true);
    const seams = makeSeams({ isAgentLoaded, loadAgent });

    const handle = await ensureDoltSupervisor(seams);

    expect(handle.enabled).toBe(true);
    expect(isAgentLoaded).toHaveBeenCalledTimes(1);
    expect(loadAgent).toHaveBeenCalledTimes(1);
  });

  it("should NOT reload the agent when it is already loaded", async () => {
    const isAgentLoaded = vi.fn(async () => true);
    const loadAgent = vi.fn(async () => true);
    const seams = makeSeams({ isAgentLoaded, loadAgent });

    await ensureDoltSupervisor(seams);

    expect(isAgentLoaded).toHaveBeenCalledTimes(1);
    expect(loadAgent).not.toHaveBeenCalled();
  });

  it("should schedule the health loop on the configured interval when enabled", async () => {
    const setIntervalFn = vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>);
    const seams = makeSeams({ setIntervalFn, probeIntervalMs: 5000 });

    const handle = await ensureDoltSupervisor(seams);

    expect(handle.enabled).toBe(true);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    // Second arg is the interval period.
    expect((setIntervalFn.mock.calls[0] as unknown[])[1]).toBe(5000);
  });

  it("should kickstart the agent AND re-init the bd-client when a probe fails", async () => {
    let tick: (() => void | Promise<void>) | undefined;
    const setIntervalFn = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const sqlProbe = vi.fn(async () => false); // server unreachable
    const kickstartAgent = vi.fn(async () => {});
    const reinitBdClient = vi.fn();

    const seams = makeSeams({ setIntervalFn, sqlProbe, kickstartAgent, reinitBdClient });

    await ensureDoltSupervisor(seams);

    // Drive one health-loop tick.
    expect(tick).toBeDefined();
    await tick!();

    expect(sqlProbe).toHaveBeenCalledWith(17005);
    // On failure: self-heal — kickstart the agent and re-init the client.
    expect(kickstartAgent).toHaveBeenCalledTimes(1);
    expect(reinitBdClient).toHaveBeenCalledTimes(1);
  });

  it("should NOT kickstart or re-init when the probe succeeds", async () => {
    let tick: (() => void | Promise<void>) | undefined;
    const setIntervalFn = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const sqlProbe = vi.fn(async () => true); // healthy
    const kickstartAgent = vi.fn(async () => {});
    const reinitBdClient = vi.fn();

    const seams = makeSeams({ setIntervalFn, sqlProbe, kickstartAgent, reinitBdClient });

    await ensureDoltSupervisor(seams);

    await tick!();

    expect(sqlProbe).toHaveBeenCalledWith(17005);
    expect(kickstartAgent).not.toHaveBeenCalled();
    expect(reinitBdClient).not.toHaveBeenCalled();
  });

  it("should expose a stop() that clears the health-loop interval", async () => {
    const clearIntervalFn = vi.fn();
    const setIntervalFn = vi.fn(() => 99 as unknown as ReturnType<typeof setInterval>);
    const seams = makeSeams({ setIntervalFn, clearIntervalFn });

    const handle: DoltSupervisorHandle = await ensureDoltSupervisor(seams);
    handle.stop();

    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith(99);
  });

  it("should be a safe NO-OP stop() when disabled (no interval was scheduled)", async () => {
    const clearIntervalFn = vi.fn();
    const seams = makeSeams({ isFlagEnabled: () => false, clearIntervalFn });

    const handle = await ensureDoltSupervisor(seams);
    handle.stop();

    expect(clearIntervalFn).not.toHaveBeenCalled();
  });

  // adj-iw0vy — write-path liveness: a reachable-but-write-wedged server (handshake
  // passes, every write hangs) must self-heal instead of staying blind forever.
  it("should kickstart + re-init when the server is reachable but WRITE-WEDGED", async () => {
    let tick: (() => void | Promise<void>) | undefined;
    const setIntervalFn = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const sqlProbe = vi.fn(async () => true); // handshake OK (reachable)
    const writeProbe = vi.fn(async () => false); // but writes are wedged
    const kickstartAgent = vi.fn(async () => {});
    const reinitBdClient = vi.fn();

    const seams = makeSeams({ setIntervalFn, sqlProbe, writeProbe, kickstartAgent, reinitBdClient });

    await ensureDoltSupervisor(seams);
    await tick!();

    expect(sqlProbe).toHaveBeenCalledWith(17005);
    expect(writeProbe).toHaveBeenCalledWith(17005);
    // The write-wedge is the new self-heal trigger this bead adds.
    expect(kickstartAgent).toHaveBeenCalledTimes(1);
    expect(reinitBdClient).toHaveBeenCalledTimes(1);
  });

  it("should NOT run the write probe when the handshake already failed (heal first, skip)", async () => {
    let tick: (() => void | Promise<void>) | undefined;
    const setIntervalFn = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const sqlProbe = vi.fn(async () => false); // unreachable
    const writeProbe = vi.fn(async () => true);
    const kickstartAgent = vi.fn(async () => {});

    const seams = makeSeams({ setIntervalFn, sqlProbe, writeProbe, kickstartAgent });

    await ensureDoltSupervisor(seams);
    await tick!();

    // Handshake failed → heal immediately; the expensive write probe is skipped.
    expect(writeProbe).not.toHaveBeenCalled();
    expect(kickstartAgent).toHaveBeenCalledTimes(1);
  });

  it("should NOT kickstart when reachable AND writable", async () => {
    let tick: (() => void | Promise<void>) | undefined;
    const setIntervalFn = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const sqlProbe = vi.fn(async () => true);
    const writeProbe = vi.fn(async () => true);
    const kickstartAgent = vi.fn(async () => {});
    const reinitBdClient = vi.fn();

    const seams = makeSeams({ setIntervalFn, sqlProbe, writeProbe, kickstartAgent, reinitBdClient });

    await ensureDoltSupervisor(seams);
    await tick!();

    expect(writeProbe).toHaveBeenCalledWith(17005);
    expect(kickstartAgent).not.toHaveBeenCalled();
    expect(reinitBdClient).not.toHaveBeenCalled();
  });

  it("should not crash the boot path if a single probe tick throws", async () => {
    let tick: (() => void | Promise<void>) | undefined;
    const setIntervalFn = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    // A probe that throws (e.g. transient socket error) must be swallowed so the
    // loop survives to the next interval.
    const sqlProbe = vi.fn(async () => {
      throw new Error("socket blew up");
    });
    const log = vi.fn();
    const seams = makeSeams({ setIntervalFn, sqlProbe, log });

    await ensureDoltSupervisor(seams);

    await expect(tick!()).resolves.not.toThrow();
  });
});

/**
 * adj-182.2.5.1 — boot ENTRY-POINT no-op gate (the function index.ts actually
 * calls). The "merging must NOT adopt the supervisor / trigger cutover" guarantee
 * depends on `startDoltSupervisorFromEnv()` / `startDoltSupervisorOnBoot()`
 * short-circuiting on the REAL ADJUTANT_DOLT_SUPERVISOR env BEFORE reading
 * ADJUTANT_DOLT_PROJECT_ID / BEADS_DOLT_SERVER_PORT or building any seam. The
 * existing suite only exercises ensureDoltSupervisor() with a FAKE isFlagEnabled,
 * so the boot wrappers were untested — a future edit reordering the flag check
 * (e.g. computing the label or reading projectId first) would silently re-enable
 * on-merge work with no failing test. These tests mutate process.env in a
 * try/finally and assert the genuine no-op (no further env read, disabled handle)
 * AND the flag-on wiring path.
 */
describe("startDoltSupervisorFromEnv (boot entry-point gate — adj-182.2.5.1)", () => {
  /**
   * Wrap process.env so we can observe WHICH keys the boot wrapper reads. The
   * genuine no-op must read ONLY the gate flag — never the projectId/port — so a
   * disabled backend does no further env work or seam build.
   */
  function withTrackedEnv<T>(
    overrides: Record<string, string | undefined>,
    fn: (readKeys: Set<string>) => Promise<T>,
  ): Promise<T> {
    const original = process.env;
    const readKeys = new Set<string>();
    const base: NodeJS.ProcessEnv = { ...original };
    // Apply overrides. Assigning `undefined` (rather than `delete`) clears the
    // value while satisfying @typescript-eslint/no-dynamic-delete; the gate reads
    // it as "unset" and the proxy still records the read for the no-op assertions.
    for (const [k, v] of Object.entries(overrides)) {
      base[k] = v;
    }
    const tracked = new Proxy(base, {
      get(target, prop: string | symbol) {
        if (typeof prop === "string") readKeys.add(prop);
        return target[prop as string];
      },
    });
    process.env = tracked;
    return fn(readKeys).finally(() => {
      process.env = original;
    });
  }

  it("should be a genuine NO-OP (disabled, no projectId/port read) when the flag is unset", async () => {
    const { startDoltSupervisorFromEnv } = await import(
      "../../src/services/dolt-supervisor.js"
    );
    await withTrackedEnv(
      {
        ADJUTANT_DOLT_SUPERVISOR: undefined,
        // Provide a VALID projectId + port: the flag-on path WOULD build seams and
        // start the loop with these. A genuine no-op must ignore them entirely.
        ADJUTANT_DOLT_PROJECT_ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        BEADS_DOLT_SERVER_PORT: "17005",
      },
      async (readKeys) => {
        const handle = await startDoltSupervisorFromEnv();
        expect(handle.enabled).toBe(false);
        // The gate flag was consulted...
        expect(readKeys.has("ADJUTANT_DOLT_SUPERVISOR")).toBe(true);
        // ...but NOTHING downstream — no projectId, no port, no seam build.
        expect(readKeys.has("ADJUTANT_DOLT_PROJECT_ID")).toBe(false);
        expect(readKeys.has("BEADS_DOLT_SERVER_PORT")).toBe(false);
      },
    );
  });

  it("should be a genuine NO-OP when the flag is explicitly 0", async () => {
    const { startDoltSupervisorFromEnv } = await import(
      "../../src/services/dolt-supervisor.js"
    );
    await withTrackedEnv(
      {
        ADJUTANT_DOLT_SUPERVISOR: "0",
        ADJUTANT_DOLT_PROJECT_ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        BEADS_DOLT_SERVER_PORT: "17005",
      },
      async (readKeys) => {
        const handle = await startDoltSupervisorFromEnv();
        expect(handle.enabled).toBe(false);
        expect(readKeys.has("ADJUTANT_DOLT_PROJECT_ID")).toBe(false);
        expect(readKeys.has("BEADS_DOLT_SERVER_PORT")).toBe(false);
      },
    );
  });

  it("should expose a no-op stop() on the disabled handle (boot path never blocks)", async () => {
    const { startDoltSupervisorFromEnv } = await import(
      "../../src/services/dolt-supervisor.js"
    );
    await withTrackedEnv({ ADJUTANT_DOLT_SUPERVISOR: undefined }, async () => {
      const handle = await startDoltSupervisorFromEnv();
      expect(handle.enabled).toBe(false);
      // Must be safe to call with no scheduled interval.
      expect(() => { handle.stop(); }).not.toThrow();
    });
  });

  it("should stay disabled (and warn) when the flag is on but ADJUTANT_DOLT_PROJECT_ID is missing", async () => {
    const { startDoltSupervisorFromEnv } = await import(
      "../../src/services/dolt-supervisor.js"
    );
    await withTrackedEnv(
      {
        ADJUTANT_DOLT_SUPERVISOR: "1",
        ADJUTANT_DOLT_PROJECT_ID: undefined,
        BEADS_DOLT_SERVER_PORT: "17005",
      },
      async () => {
        const handle = await startDoltSupervisorFromEnv();
        // No projectId ⇒ cannot derive the launchd label ⇒ skip cleanly, never
        // touching launchctl.
        expect(handle.enabled).toBe(false);
      },
    );
  });

  it("should stay disabled when the flag is on but BEADS_DOLT_SERVER_PORT is invalid", async () => {
    const { startDoltSupervisorFromEnv } = await import(
      "../../src/services/dolt-supervisor.js"
    );
    await withTrackedEnv(
      {
        ADJUTANT_DOLT_SUPERVISOR: "true",
        ADJUTANT_DOLT_PROJECT_ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        BEADS_DOLT_SERVER_PORT: "not-a-port",
      },
      async () => {
        const handle = await startDoltSupervisorFromEnv();
        // Invalid port ⇒ nothing to probe ⇒ skip cleanly, never touching launchctl.
        expect(handle.enabled).toBe(false);
      },
    );
  });
});

describe("startDoltSupervisorOnBoot (boot wiring — adj-182.2.5.1)", () => {
  // These tests inject FAKE launchctl/timer behaviour by flipping the env flag and
  // supplying options, while NEVER touching real launchd: the disabled paths
  // return before building seams, and the enabled path is asserted only via the
  // returned handle (no real interval is awaited).

  function withFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
    const original = process.env;
    // Swap the whole env object (rather than delete a computed key) so we both
    // restore cleanly and satisfy @typescript-eslint/no-dynamic-delete.
    const base: NodeJS.ProcessEnv = { ...original };
    if (value === undefined) base["ADJUTANT_DOLT_SUPERVISOR"] = undefined;
    else base["ADJUTANT_DOLT_SUPERVISOR"] = value;
    process.env = base;
    return fn().finally(() => {
      process.env = original;
    });
  }

  it("should return a disabled handle without building seams when the flag is off", async () => {
    const { startDoltSupervisorOnBoot } = await import(
      "../../src/services/dolt-supervisor.js"
    );
    await withFlag(undefined, async () => {
      const handle = await startDoltSupervisorOnBoot({
        projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        uid: 501,
        plistPath: "/tmp/never-touched.plist",
        pinnedPort: 17005,
      });
      expect(handle.enabled).toBe(false);
      expect(() => { handle.stop(); }).not.toThrow();
    });
  });

  it("should return a disabled handle when the flag is on but no pinned port is resolvable", async () => {
    const { startDoltSupervisorOnBoot } = await import(
      "../../src/services/dolt-supervisor.js"
    );
    await withFlag("1", async () => {
      // No pinned port ⇒ buildProductionSupervisorSeams returns null ⇒ disabled,
      // and crucially launchctl is never invoked (no agent load / probe).
      const handle = await startDoltSupervisorOnBoot({
        projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        uid: 501,
        plistPath: "/tmp/never-touched.plist",
        pinnedPort: null,
      });
      expect(handle.enabled).toBe(false);
    });
  });
});

describe("isDoltSupervisorFlagEnabled (env gate)", () => {
  it("should default to OFF semantics for unset/0/empty and ON only for 1/true", async () => {
    const { isDoltSupervisorFlagEnabled } = await import(
      "../../src/services/dolt-supervisor.js"
    );
    expect(isDoltSupervisorFlagEnabled(undefined)).toBe(false);
    expect(isDoltSupervisorFlagEnabled("")).toBe(false);
    expect(isDoltSupervisorFlagEnabled("0")).toBe(false);
    expect(isDoltSupervisorFlagEnabled("false")).toBe(false);
    expect(isDoltSupervisorFlagEnabled("1")).toBe(true);
    expect(isDoltSupervisorFlagEnabled("true")).toBe(true);
  });
});

/**
 * adj-iw0vy — doltWriteProbe: the write-path liveness check. The exec is an injected
 * seam so the unit test NEVER spawns `dolt` or touches a real server. The wedge case
 * is modeled as the exec rejecting (a real timeout kills the child → rejection).
 */
describe("doltWriteProbe (write-wedge detector — adj-iw0vy)", () => {
  it("should resolve true when the scratch write completes", async () => {
    const exec = vi.fn(async () => ({ stdout: "", stderr: "" }));

    const ok = await doltWriteProbe("/repo/.beads/dolt", { exec });

    expect(ok).toBe(true);
    // Routes via the repo dir, carries a hard timeout, and runs a non-persisting
    // TEMPORARY-table write (no fleet-synced state).
    expect(exec).toHaveBeenCalledTimes(1);
    const [file, args, opts] = exec.mock.calls[0] as [string, string[], { cwd: string; timeout: number }];
    expect(file).toBe("dolt");
    expect(args[0]).toBe("sql");
    expect(args.join(" ")).toMatch(/CREATE TEMPORARY TABLE/i);
    expect(args.join(" ")).toMatch(/DROP TABLE/i);
    expect(opts.cwd).toBe("/repo/.beads/dolt");
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it("should resolve false when the write hangs/exec rejects (timeout IS the detector)", async () => {
    // A wedged server hangs; the exec timeout kills the child and rejects.
    const exec = vi.fn(async () => {
      throw Object.assign(new Error("write probe timed out"), { killed: true, signal: "SIGTERM" });
    });

    const ok = await doltWriteProbe("/repo/.beads/dolt", { exec });

    expect(ok).toBe(false);
  });

  it("should resolve false (never reject) on any exec error — fail-closed", async () => {
    const exec = vi.fn(async () => {
      throw new Error("dolt: command not found");
    });

    await expect(doltWriteProbe("/repo/.beads/dolt", { exec })).resolves.toBe(false);
  });
});
