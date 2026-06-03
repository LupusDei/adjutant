/**
 * End-to-end smoke test for the real Dolt supervised-install chain (adj-182.1.4.1).
 *
 * The live cutover surfaced an integration gap the seam-only unit tests could not:
 * port allocation was keyed by the beads UUID, but the real registry keys by short-id
 * + path. This test runs the REAL chain the install adapter runs — minus launchd —
 * end-to-end so the NEXT live cutover does not surface yet another seam gap:
 *
 *   1. allocateDoltPortByPath(repoRoot) against a TEMP registry whose entries mirror
 *      the REAL ~/.adjutant/projects.json shape (short-id + path, no uuid, no doltPort).
 *   2. pinDoltPort(beadsDir, port) — the real pin writer → metadata.json + config.yaml.
 *   3. Spawn a REAL `dolt sql-server --config <config.yaml>` on the pinned port.
 *   4. doltSqlHandshakeOk(port) — the REAL MySQL-handshake SQL probe used by the adapter.
 *   5. SQL-verify the server answers, then tear the server down.
 *
 * We deliberately drive `dolt sql-server` DIRECTLY rather than via launchctl: the
 * launchd `gui/<uid>` domain is session-bound and flaky/unavailable in CI, and is
 * already covered by the seam unit tests + the macOS-only supervisor-service test.
 * The integration value here is the allocate→pin→real-server→probe contract.
 *
 * HEAVY + ENV-GATED: requires a real `dolt` binary and spawns a real server, so it is
 * gated behind RUN_DOLT_E2E=1 and auto-skips otherwise (kept runnable for manual /
 * pre-cutover verification). It NEVER touches the live ~/.adjutant/projects.json or the
 * live dolt server — a temp HOME-style registry + a temp dolt data-dir are used throughout.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess, execFileSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { allocateDoltPortByPath } from "../../../cli/lib/dolt-port-registry.js";
import { pinDoltPort } from "../../../cli/lib/dolt-pin.js";
import { doltSqlHandshakeOk } from "../../../cli/lib/dolt-sql-probe.js";

const E2E_ENABLED = process.env["RUN_DOLT_E2E"] === "1";

// Resolve the dolt binary once; if absent we skip even when the flag is set.
function resolveDolt(): string | null {
  try {
    return execFileSync("which", ["dolt"]).toString().trim() || null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!E2E_ENABLED)("dolt supervised-install e2e smoke (adj-182.1.4.1)", () => {
  let tmpDir: string;
  let registryPath: string;
  let repoRoot: string;
  let beadsDir: string;
  let dataDir: string;
  let doltBin: string | null;
  let server: ChildProcess | null = null;
  let allocatedPort = 0;

  beforeAll(() => {
    doltBin = resolveDolt();
    if (!doltBin) return;

    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "dolt-e2e-")));
    registryPath = join(tmpDir, "projects.json");
    repoRoot = join(tmpDir, "code", "ai", "adjutant");
    beadsDir = join(repoRoot, ".beads");
    dataDir = join(beadsDir, "dolt");
    mkdirSync(dataDir, { recursive: true });

    // metadata.json mirrors the real beads file: project_id is a UUID (NOT a registry key).
    writeFileSync(
      join(beadsDir, "metadata.json"),
      JSON.stringify(
        { database: "dolt", backend: "dolt", dolt_mode: "server", project_id: "c249344d-1d43-4359-a2dd-be8cbb0270e3" },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    // Registry mirrors the REAL ~/.adjutant/projects.json shape: short-id + path, no uuid, no doltPort.
    writeFileSync(
      registryPath,
      JSON.stringify(
        { projects: [{ id: "0e578d15", name: "adjutant", path: repoRoot, hasBeads: true }] },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    // Initialize a real Dolt database in the data dir so sql-server has something to serve.
    execFileSync(doltBin, ["init"], { cwd: dataDir });
  });

  afterAll(() => {
    if (server && !server.killed) {
      try {
        server.kill("SIGKILL");
      } catch {
        /* best-effort */
      }
    }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allocates by path → pins → a real dolt sql-server answers the real SQL probe on the pinned port", async () => {
    expect(doltBin).not.toBeNull();
    const bin = doltBin!; // asserted non-null above; narrow once for the spawn/exec calls.

    // 1. Allocate by repo PATH (the cutover-failing call site's fix). UUID is irrelevant here.
    allocatedPort = allocateDoltPortByPath(repoRoot, { registryPath });
    expect(allocatedPort).toBeGreaterThanOrEqual(17000);
    expect(allocatedPort).toBeLessThanOrEqual(17999);

    // The port must have landed on the PATH-matched entry (short id), not on a uuid key.
    const reg = JSON.parse(readFileSync(registryPath, "utf-8")) as {
      projects: { id: string; path: string; doltPort?: number }[];
    };
    const entry = reg.projects.find((p) => p.path === repoRoot);
    expect(entry?.id).toBe("0e578d15");
    expect(entry?.doltPort).toBe(allocatedPort);

    // 2. Pin the port via the REAL pin writer (metadata.json + config.yaml + autocommit).
    pinDoltPort(beadsDir, allocatedPort);
    const configPath = join(dataDir, "config.yaml");
    expect(readFileSync(configPath, "utf-8")).toMatch(new RegExp(`port:\\s*${allocatedPort}`));

    // 3. Spawn a REAL dolt sql-server with the pinned config, rooted at the data dir.
    server = spawn(bin, ["sql-server", "--config", configPath], {
      cwd: dataDir,
      stdio: "ignore",
    });

    // 4. Poll the REAL SQL-handshake probe until the server is reachable (server start races us).
    let verified = false;
    for (let i = 0; i < 40; i++) {
      if (await doltSqlHandshakeOk(allocatedPort)) {
        verified = true;
        break;
      }
      await sleep(250);
    }
    expect(verified).toBe(true);

    // 5. SQL-verify the server actually answers a query on the pinned port.
    const out = execFileSync(
      bin,
      ["sql", "-r", "csv", "-q", "SELECT 1 AS ok"],
      { cwd: dataDir, env: { ...process.env, BEADS_DOLT_SERVER_PORT: String(allocatedPort) } },
    ).toString();
    expect(out).toMatch(/\bok\b/);
    expect(out).toMatch(/\b1\b/);
  }, 60_000);
});
