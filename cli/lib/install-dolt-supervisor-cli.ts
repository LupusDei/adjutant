/**
 * Thin CLI adapter for installSupervisor() (adj-182.1.4, T004c).
 *
 * Resolves the REAL seams (allocate+pin port via the registry, render+write the
 * plist, run launchctl, SQL-probe the server) and delegates ALL orchestration
 * logic to {@link installSupervisor} in `dolt-supervisor.ts`. This adapter holds
 * no orchestration logic of its own — only seam wiring + argv parsing — so the
 * `scripts/install-dolt-supervisor.sh` entrypoint can stay a one-liner.
 *
 * Invoked by the shell entrypoint as:
 *   npx tsx cli/lib/install-dolt-supervisor-cli.ts <repoRoot>
 *
 * <repoRoot> defaults to process.cwd().
 */

import { execFile } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir, userInfo } from "os";
import { join } from "path";
import { promisify } from "util";

import { allocateDoltPort } from "./dolt-port-registry.js";
import { pinDoltPort } from "./dolt-pin.js";
import { doltSqlHandshakeOk } from "./dolt-sql-probe.js";
import { installSupervisor, supervisorLabel, type ExecResult } from "./dolt-supervisor.js";

const execFileAsync = promisify(execFile);

/** Read `project_id` from `<beadsDir>/metadata.json`, or throw. */
function readProjectId(beadsDir: string): string {
  const metadataPath = join(beadsDir, "metadata.json");
  if (!existsSync(metadataPath)) {
    throw new Error(`install-dolt-supervisor: metadata.json not found at ${metadataPath}`);
  }
  const meta = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
  const id = meta["project_id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`install-dolt-supervisor: project_id missing in ${metadataPath}`);
  }
  return id;
}

/** Resolve the `dolt` binary's absolute path via `which`. */
async function resolveDoltBin(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("which", ["dolt"]);
    const path = stdout.trim();
    if (!path) throw new Error("empty");
    return path;
  } catch {
    throw new Error("install-dolt-supervisor: `dolt` binary not found on PATH");
  }
}

/** Real exec seam over execFile (never throws — normalizes to an ExecResult). */
async function realExec(cmd: string, args: readonly string[]): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(err),
    };
  }
}

/**
 * Real SQL-probe seam (adj-182.2.1.r3): a MySQL-handshake probe — validates the
 * server's greeting packet, NOT a bare TCP accept, so a squatter/rogue on the pinned
 * port cannot false-pass verification. Delegates to the shared {@link doltSqlHandshakeOk}.
 */
function realSqlProbe(port: number): Promise<boolean> {
  return doltSqlHandshakeOk(port);
}

/** Install the supervised Dolt server for the project at `repoRoot`. */
export async function runInstall(repoRoot: string): Promise<void> {
  const beadsDir = join(repoRoot, ".beads");
  const projectId = readProjectId(beadsDir);
  const port = allocateDoltPort(projectId);
  const doltBin = await resolveDoltBin();
  const plistPath = join(
    homedir(),
    "Library",
    "LaunchAgents",
    `${supervisorLabel(projectId)}.plist`,
  );
  const logPath = join(beadsDir, "dolt-server.log");

  const result = await installSupervisor({
    projectId,
    beadsDir,
    port,
    doltBin,
    plistPath,
    logPath,
    uid: userInfo().uid,
    exec: realExec,
    pinPort: pinDoltPort,
    writePlist: (path, contents) => writeFileSync(path, contents, "utf-8"),
    sqlProbe: realSqlProbe,
  });

  if (!result.ok) {
    throw new Error(
      `install-dolt-supervisor: supervisor ${result.label} installed but did not verify on port ${port} (bootstrapped=${result.bootstrapped})`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`install-dolt-supervisor: ${result.label} running + verified on port ${port}`);
}

// Run when invoked directly (not when imported by a test).
const invokedDirectly = process.argv[1]?.endsWith("install-dolt-supervisor-cli.ts");
if (invokedDirectly) {
  const repoRoot = process.argv[2] ?? process.cwd();
  runInstall(repoRoot).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error((err as Error).message);
    process.exit(1);
  });
}
