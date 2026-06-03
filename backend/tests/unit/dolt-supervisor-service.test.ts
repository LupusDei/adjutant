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
