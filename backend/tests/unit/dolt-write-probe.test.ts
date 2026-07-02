import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Absolute path to python3 so the child's PATH can be controlled independently of
 * where python3 lives (on this host python3 shares /usr/local/bin with `dolt`, so
 * the "no dolt on PATH" case cannot just whitelist python3's dir).
 */
const PYTHON3 = (() => {
  const r = spawnSync("command", ["-v", "python3"], { shell: true, encoding: "utf8" });
  return r.stdout.trim() || "python3";
})();

/**
 * Regression tests for the dolt-heal write-path liveness probe (adj-iw0vy).
 *
 * The launchd dolt-heal watchdog only checked the SQL handshake, which passes even
 * when EVERY write hangs (the bd server-mode auto-import write-deadlock). Such a
 * server is "alive" to the handshake forever and never self-heals. `dolt-write-probe.py`
 * closes that gap: it runs a scratch TEMPORARY-table write and reports whether the
 * write COMPLETES. The timeout IS the wedge detector.
 *
 * Contract (exit codes the heal script branches on):
 *   0 = write completed        → server is writable
 *   1 = write FAILED (wedged)  → timed out or `dolt` errored → caller kickstarts
 *   2 = could not probe        → not a dolt data dir / no `dolt` → caller SKIPS (handshake-only)
 *
 * We drive it with a FAKE `dolt` on PATH so no real server is needed and the
 * timeout-as-detector + fail-closed semantics are exercised deterministically.
 */

const PROBE = join(__dirname, "..", "..", "..", "scripts", "supervisor", "dolt-write-probe.py");

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "adj-write-probe-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** Create a fake `dolt` executable on a fresh bin dir; return that dir for PATH. */
function fakeDoltBin(scriptBody: string): string {
  const bin = join(work, "bin");
  mkdirSync(bin, { recursive: true });
  const p = join(bin, "dolt");
  writeFileSync(p, `#!/bin/sh\n${scriptBody}\n`);
  chmodSync(p, 0o755);
  return bin;
}

/** A dolt data dir is any dir containing a `.dolt/` subdir. */
function makeDataDir(): string {
  const d = join(work, "data");
  mkdirSync(join(d, ".dolt"), { recursive: true });
  return d;
}

function runProbe(dataDir: string, binDir: string | null, timeoutSec = "5") {
  const env: NodeJS.ProcessEnv = { ...process.env, ADJ_WRITE_PROBE_TIMEOUT: timeoutSec };
  if (binDir) env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  return spawnSync(PYTHON3, [PROBE, dataDir], { env, encoding: "utf8" });
}

describe("dolt-write-probe.py (adj-iw0vy write-wedge detector)", () => {
  it("should exit 0 when the scratch write completes (server writable)", () => {
    const data = makeDataDir();
    const bin = fakeDoltBin("exit 0"); // healthy server: write succeeds
    const r = runProbe(data, bin);
    expect(r.status).toBe(0);
  });

  it("should exit 1 when the write HANGS past the timeout (write-wedged server)", () => {
    const data = makeDataDir();
    const bin = fakeDoltBin("sleep 30"); // wedge: dolt sql never returns
    const r = runProbe(data, bin, "1"); // 1s timeout → detector fires fast
    expect(r.status).toBe(1);
  });

  it("should exit 1 when dolt returns a non-zero status (write errored — fail closed)", () => {
    const data = makeDataDir();
    const bin = fakeDoltBin("exit 1"); // server rejects the write
    const r = runProbe(data, bin);
    expect(r.status).toBe(1);
  });

  it("should exit 2 when the target is not a dolt data dir (skip → handshake-only)", () => {
    const notData = join(work, "plain"); // exists but has no .dolt/ subdir
    mkdirSync(notData, { recursive: true });
    const bin = fakeDoltBin("exit 0");
    const r = runProbe(notData, bin);
    expect(r.status).toBe(2);
  });

  it("should exit 2 when the data dir does not exist (skip, never false-fail)", () => {
    const bin = fakeDoltBin("exit 0");
    const r = runProbe(join(work, "nope"), bin);
    expect(r.status).toBe(2);
  });

  it("should exit 2 when the dolt binary is absent (cannot probe → skip)", () => {
    const data = makeDataDir();
    // PATH pointed at an empty bin dir → `dolt` not resolvable.
    const emptyBin = join(work, "empty");
    mkdirSync(emptyBin, { recursive: true });
    // Invoke python3 by ABSOLUTE path so the child's PATH (empty) governs only the
    // probe's own `dolt` lookup — which must resolve to nothing.
    const r = spawnSync(PYTHON3, [PROBE, data], {
      env: { ...process.env, PATH: emptyBin, ADJ_WRITE_PROBE_TIMEOUT: "5" },
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });
});
