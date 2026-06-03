/**
 * adj-182.2.4 — Reconnecting backend bd-client (TDD).
 *
 * Today the backend bd-client takes its Dolt endpoint from `process.env`
 * (BEADS_DOLT_SERVER_PORT) at process boot and never reconnects. When the pinned
 * port churns (macOS sleep/crash) the per-port circuit breaker inside `bd` stays
 * open forever against the dead cached port while a live server runs elsewhere —
 * exactly the wedge this epic fixes.
 *
 * These tests pin the resilience contract for the NEW pieces in bd-client.ts:
 *   - resolvePinnedDoltPort(beadsDir): env → metadata.json → dolt-server.port (in order)
 *   - isDoltConnectionFailure(stderr): matches "server appears down" / "circuit breaker is open"
 *   - execBdWithReconnect(): on a connection failure, RE-READ the pinned endpoint,
 *     clear the stale per-port circuit file, and retry with bounded backoff; RESET
 *     the in-process connection state on success — recovery WITHOUT a process restart.
 *
 * All external effects (spawn, clock/sleep, fs reads, circuit-file clear) are
 * INJECTED seams so the unit test never touches a real dolt server, the real
 * filesystem, or the wall clock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  resolvePinnedDoltPort,
  isDoltConnectionFailure,
  execBdWithReconnect,
  _resetDoltConnectionState,
  type ReconnectSeams,
  type BdResult,
} from "../../src/services/bd-client.js";

/** A connection-down bd result, matching real `bd` stderr shape. */
function downResult(port: number): BdResult {
  return {
    success: false,
    error: {
      code: "COMMAND_FAILED",
      message: `dolt circuit breaker is open: server appears down, failing fast (cooldown 5s)`,
      stderr: `failed to open database: dial tcp 127.0.0.1:${port}: connect: connection refused — server appears down`,
    },
    exitCode: 1,
  };
}

/** A clean success bd result. */
function okResult<T>(data: T): BdResult<T> {
  return { success: true, data, exitCode: 0 };
}

describe("resolvePinnedDoltPort", () => {
  const beadsDir = "/tmp/proj/.beads";

  beforeEach(() => {
    _resetDoltConnectionState();
  });

  it("should prefer BEADS_DOLT_SERVER_PORT env over file sources", () => {
    const seams: Pick<ReconnectSeams, "readEnvPort" | "readMetadataPort" | "readPortFile"> = {
      readEnvPort: () => 17005,
      readMetadataPort: () => 17010,
      readPortFile: () => 17020,
    };
    expect(resolvePinnedDoltPort(beadsDir, seams)).toBe(17005);
  });

  it("should fall back to metadata.json dolt_server_port when env is absent", () => {
    const seams = {
      readEnvPort: () => null,
      readMetadataPort: () => 17010,
      readPortFile: () => 17020,
    };
    expect(resolvePinnedDoltPort(beadsDir, seams)).toBe(17010);
  });

  it("should fall back to .beads/dolt-server.port when env and metadata are absent", () => {
    const seams = {
      readEnvPort: () => null,
      readMetadataPort: () => null,
      readPortFile: () => 17020,
    };
    expect(resolvePinnedDoltPort(beadsDir, seams)).toBe(17020);
  });

  it("should return null when no source yields a port", () => {
    const seams = {
      readEnvPort: () => null,
      readMetadataPort: () => null,
      readPortFile: () => null,
    };
    expect(resolvePinnedDoltPort(beadsDir, seams)).toBeNull();
  });
});

describe("isDoltConnectionFailure", () => {
  it("should detect the open-circuit-breaker signature", () => {
    expect(
      isDoltConnectionFailure("dolt circuit breaker is open: server appears down, failing fast"),
    ).toBe(true);
  });

  it("should detect the server-appears-down signature", () => {
    expect(
      isDoltConnectionFailure("failed to open database: ... server appears down"),
    ).toBe(true);
  });

  it("should detect a connection-refused dial error", () => {
    expect(
      isDoltConnectionFailure("dial tcp 127.0.0.1:17005: connect: connection refused"),
    ).toBe(true);
  });

  it("should NOT treat an ordinary not-found error as a connection failure", () => {
    expect(isDoltConnectionFailure("Error: bead adj-999 not found in database")).toBe(false);
  });

  it("should be safe on empty stderr", () => {
    expect(isDoltConnectionFailure("")).toBe(false);
  });
});

describe("execBdWithReconnect", () => {
  beforeEach(() => {
    _resetDoltConnectionState();
    vi.clearAllMocks();
  });

  /** Build a seam set with sensible defaults, overridable per-test. */
  function makeSeams(overrides: Partial<ReconnectSeams> = {}): ReconnectSeams {
    return {
      run: vi.fn(async () => okResult({ ok: true })),
      readEnvPort: () => 17005,
      readMetadataPort: () => 17005,
      readPortFile: () => 17005,
      clearCircuitFile: vi.fn(async () => {}),
      sleep: vi.fn(async () => {}),
      now: () => 0,
      ...overrides,
    };
  }

  it("should pass through a first-try success without any reconnect work", async () => {
    const seams = makeSeams();
    const result = await execBdWithReconnect(["list", "--json"], { beadsDir: "/tmp/p/.beads" }, seams);

    expect(result.success).toBe(true);
    expect(seams.run).toHaveBeenCalledTimes(1);
    // No reconnect on the happy path.
    expect(seams.clearCircuitFile).not.toHaveBeenCalled();
    expect(seams.sleep).not.toHaveBeenCalled();
  });

  it("should NOT retry a non-connection failure (e.g. bead-not-found)", async () => {
    const run = vi.fn(async () =>
      ({ success: false, error: { code: "COMMAND_FAILED", message: "not found", stderr: "Error: bead adj-999 not found" }, exitCode: 1 }) as BdResult,
    );
    const seams = makeSeams({ run });

    const result = await execBdWithReconnect(["show", "adj-999"], { beadsDir: "/tmp/p/.beads" }, seams);

    expect(result.success).toBe(false);
    // Exactly one attempt — connection-down detection must not fire on logic errors.
    expect(run).toHaveBeenCalledTimes(1);
    expect(seams.clearCircuitFile).not.toHaveBeenCalled();
  });

  it("should re-read the pinned endpoint, clear the stale circuit file, and reconnect on a connection failure", async () => {
    // The boot env still points at the now-dead port 17005; bd fails fast against
    // it. The pin has since moved to 17009 (metadata/port-file). The reconnect must
    // clear the DEAD port's stale circuit file, then re-resolve to the live port.
    let envPort: number | null = 17005;
    const run = vi
      .fn<ReconnectSeams["run"]>()
      // First attempt: resolves env=17005 (stale), fails connection-down. The seam
      // then drops the stale env so the next resolve falls through to the live pin.
      .mockImplementationOnce(async (_a, _o, port) => {
        envPort = null;
        return downResult(port ?? 0);
      })
      // Second attempt: resolves metadata=17009 (live), succeeds.
      .mockImplementationOnce(async () => okResult({ recovered: true }));

    const seams = makeSeams({
      run,
      readEnvPort: () => envPort,
      readMetadataPort: () => 17009,
      readPortFile: () => 17009,
    });

    const result = await execBdWithReconnect(["list", "--json"], { beadsDir: "/tmp/p/.beads" }, seams);

    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    // The stale per-port circuit file for the DEAD port (17005, what attempt 1
    // failed against) must be cleared so bd stops failing fast on it.
    expect(seams.clearCircuitFile).toHaveBeenCalledWith(17005);
    // The recovery ran against the freshly-resolved live port.
    expect((run.mock.calls[1] as unknown[])[2]).toBe(17009);
    // Backoff slept at least once between attempts.
    expect(seams.sleep).toHaveBeenCalled();
  });

  it("should RESET the in-process connection state after a successful reconnect (recovery without restart)", async () => {
    // Call 1: a connection failure that recovers on retry. This opens then resets
    // the in-process breaker.
    const run = vi
      .fn<ReconnectSeams["run"]>()
      .mockResolvedValueOnce(downResult(17005))
      .mockResolvedValueOnce(okResult({ first: true }))
      // Call 2 (a fresh execBdWithReconnect): must succeed on the FIRST attempt,
      // proving the breaker was reset — not still open from call 1.
      .mockResolvedValueOnce(okResult({ second: true }));

    const seams = makeSeams({ run });

    const r1 = await execBdWithReconnect(["update", "x"], { beadsDir: "/tmp/p/.beads" }, seams);
    expect(r1.success).toBe(true);

    const r2 = await execBdWithReconnect(["list"], { beadsDir: "/tmp/p/.beads" }, seams);
    expect(r2.success).toBe(true);
    // 2 attempts for call 1 (fail+recover) + 1 attempt for call 2 = 3 total.
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("should give up after the bounded attempt budget when the endpoint never recovers", async () => {
    const run = vi.fn<ReconnectSeams["run"]>(async () => downResult(17005));
    const seams = makeSeams({ run, maxAttempts: 3 });

    const result = await execBdWithReconnect(["list"], { beadsDir: "/tmp/p/.beads" }, seams);

    expect(result.success).toBe(false);
    // Exactly maxAttempts attempts — no unbounded retry loop.
    expect(run).toHaveBeenCalledTimes(3);
    expect(isDoltConnectionFailure(result.error?.stderr ?? result.error?.message ?? "")).toBe(true);
  });

  it("should always make at least one attempt even with a zero attempt budget", async () => {
    const run = vi.fn<ReconnectSeams["run"]>(async () => okResult({ ok: true }));
    const seams = makeSeams({ run, maxAttempts: 0 });

    const result = await execBdWithReconnect(["list"], { beadsDir: "/tmp/p/.beads" }, seams);

    // A 0 budget must clamp to 1 — never skip the loop and return null.
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("should use bounded exponential backoff capped at a max delay", async () => {
    const slept: number[] = [];
    const run = vi.fn<ReconnectSeams["run"]>(async () => downResult(17005));
    const seams = makeSeams({
      run,
      maxAttempts: 5,
      baseBackoffMs: 100,
      maxBackoffMs: 400,
      sleep: vi.fn(async (ms: number) => {
        slept.push(ms);
      }),
    });

    await execBdWithReconnect(["list"], { beadsDir: "/tmp/p/.beads" }, seams);

    // 5 attempts → 4 backoff sleeps. Exponential 100,200,400,400 (capped at 400).
    expect(slept).toEqual([100, 200, 400, 400]);
    // Every delay is within bounds.
    for (const d of slept) {
      expect(d).toBeGreaterThanOrEqual(100);
      expect(d).toBeLessThanOrEqual(400);
    }
  });
});
