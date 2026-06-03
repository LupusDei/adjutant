/**
 * `adjutant doctor` — Check system health and prerequisites.
 *
 * Validates file existence, network health, tool availability,
 * and plugin registration. Returns exit code 0 on all pass, 1 on any fail.
 */

import { execFile, execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { createConnection } from "net";
import { homedir, userInfo } from "os";
import { join } from "path";
import { promisify } from "util";

import { printHeader, printCheck, printSummary, type CheckResult } from "../lib/output.js";
import { type Registry } from "../lib/dolt-port-registry.js";
import { supervisorLabel } from "../lib/dolt-supervisor.js";
import {
  fileExists,
  dirExists,
  mcpJsonValid,
  getAdjutantDbPath,
  getApiKeysPath,
  httpReachable,
  commandAvailable,
  nodeVersionOk,
  parseJsonFile,
  getClaudeSettingsPath,
  type ClaudeSettings,
} from "../lib/checks.js";
import { PLUGIN_KEY, LEGACY_HOOK_COMMANDS } from "../lib/plugin.js";
import { getQualityFilePaths, QUALITY_FILES, loadTemplate } from "../lib/quality-templates.js";

/** adj-013.3.1: File/directory existence checks. */
function checkFiles(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];

  // .adjutant/PRIME.md
  results.push(
    fileExists(`${cwd}/.adjutant/PRIME.md`)
      ? { name: ".adjutant/PRIME.md", status: "pass" }
      : { name: ".adjutant/PRIME.md", status: "fail", message: "run adjutant init" },
  );

  // .mcp.json existence and adjutant entry
  const mcp = mcpJsonValid(cwd);
  if (!mcp.exists) {
    results.push({ name: ".mcp.json", status: "fail", message: "run adjutant init" });
  } else if (mcp.malformed) {
    results.push({ name: ".mcp.json", status: "fail", message: "invalid JSON — fix manually" });
  } else if (!mcp.hasAdjutant) {
    results.push({ name: ".mcp.json has adjutant", status: "fail", message: "run adjutant init" });
  } else {
    results.push({ name: ".mcp.json", status: "pass" });
    results.push({ name: ".mcp.json has adjutant", status: "pass" });
  }

  // SQLite database
  results.push(
    fileExists(getAdjutantDbPath())
      ? { name: "SQLite database", status: "pass" }
      : { name: "SQLite database", status: "warn", message: "start backend first" },
  );

  // Backend deps
  results.push(
    dirExists(`${cwd}/backend/node_modules`)
      ? { name: "Backend dependencies", status: "pass" }
      : { name: "Backend dependencies", status: "fail", message: "run npm run install:all" },
  );

  // Frontend deps
  results.push(
    dirExists(`${cwd}/frontend/node_modules`)
      ? { name: "Frontend dependencies", status: "pass" }
      : { name: "Frontend dependencies", status: "fail", message: "run npm run install:all" },
  );

  // Plugin health checks
  results.push(...checkPlugin());

  // API keys
  results.push(
    fileExists(getApiKeysPath())
      ? { name: "API keys", status: "pass" }
      : { name: "API keys", status: "info", message: "open mode (no API keys)" },
  );

  return results;
}

/** adj-013.3.2: Network checks. */
async function checkNetwork(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Backend health
  const healthStatus = await httpReachable("http://localhost:4201/health");
  results.push(
    healthStatus !== null
      ? { name: "Backend health", status: "pass" }
      : { name: "Backend health", status: "fail", message: "run npm run dev" },
  );

  // MCP Streamable HTTP endpoint (POST returns a response means reachable)
  const mcpStatus = await httpReachable("http://localhost:4201/mcp");
  results.push(
    mcpStatus !== null
      ? { name: "MCP endpoint", status: "pass" }
      : { name: "MCP endpoint", status: "fail", message: "backend not serving MCP" },
  );

  return results;
}

/** adj-013.3.3: Tool availability checks. */
function checkTools(): CheckResult[] {
  const results: CheckResult[] = [];

  // Node.js version check
  const nodeCheck = nodeVersionOk();
  results.push(
    nodeCheck.ok
      ? { name: `Node.js (v${nodeCheck.version})`, status: "pass" }
      : { name: `Node.js (v${nodeCheck.version})`, status: "fail", message: "requires >= 20" },
  );

  // bd CLI
  results.push(
    commandAvailable("bd")
      ? { name: "bd CLI", status: "pass" }
      : { name: "bd CLI", status: "warn", message: "beads not available" },
  );

  return results;
}

/** Check plugin installation via claude CLI. */
function checkPlugin(): CheckResult[] {
  const results: CheckResult[] = [];

  if (!commandAvailable("claude")) {
    results.push({ name: "Adjutant plugin", status: "warn", message: "claude CLI not found" });
    return results;
  }

  // Check if plugin is installed and enabled via claude plugin list
  try {
    const output = execSync("claude plugin list", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
      encoding: "utf-8",
    });
    if (output.includes(PLUGIN_KEY) || output.includes("adjutant-agent")) {
      results.push({ name: "Adjutant plugin", status: "pass" });
    } else {
      results.push({ name: "Adjutant plugin", status: "fail", message: "run adjutant init" });
    }
  } catch {
    results.push({ name: "Adjutant plugin", status: "fail", message: "claude plugin list failed" });
  }

  // Check for stale legacy hooks
  const settings = parseJsonFile<ClaudeSettings>(getClaudeSettingsPath());
  let hasLegacy = false;
  if (settings?.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      const matchers = settings.hooks[event];
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        if (matcher.hooks?.some((h: { command: string }) => LEGACY_HOOK_COMMANDS.includes(h.command))) {
          hasLegacy = true;
          break;
        }
      }
      if (hasLegacy) break;
    }
  }
  results.push(
    hasLegacy
      ? { name: "No stale legacy hooks", status: "warn", message: "run adjutant init to clean up" }
      : { name: "No stale legacy hooks", status: "pass" },
  );

  return results;
}

/** Check presence and freshness of quality gate files (testing rules, CI config, etc.). */
export function checkQualityFiles(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  for (const qf of QUALITY_FILES) {
    const fullPath = join(cwd, qf.destPath);
    if (!fileExists(fullPath)) {
      results.push({ name: qf.destPath, status: "fail", message: "run adjutant upgrade" });
      continue;
    }
    // Compare content against template to detect outdated files
    try {
      const currentContent = readFileSync(fullPath, "utf-8");
      const templateContent = loadTemplate(qf.templateName);
      if (currentContent !== templateContent) {
        results.push({ name: qf.destPath, status: "warn", message: "outdated — run adjutant upgrade" });
      } else {
        results.push({ name: qf.destPath, status: "pass" });
      }
    } catch {
      // Template loading failed — just report existence
      results.push({ name: qf.destPath, status: "pass" });
    }
  }
  return results;
}

// ── checkDolt() — Dolt health group (adj-182.2.1, folding in adj-182.2.7) ────
//
// Verifies the supervised, pinned-port Dolt topology this epic establishes. ALL
// external effects (SQL probe, launchctl print, ps/lsof scan, registry/file reads)
// are INJECTED seams so the check is trivially unit-testable and NEVER runs real
// launchctl/ps/dolt or touches the live server. checkDolt is read/diagnostic only —
// there is no kill/mutation seam (repair lives in `doctor --fix`, adj-182.2.2).

/** A discovered `dolt sql-server` process (from the ps/lsof scan seam). */
export interface DoltProcess {
  /** Process id. */
  pid: number;
  /** Listening port, when discoverable. */
  port: number | null;
  /** Working directory — a proxy for which project's data-dir the server owns. */
  cwd: string | null;
}

/** One registry port allocation (`{ projectId, doltPort }`) for collision detection. */
export interface PortAllocation {
  projectId: string;
  doltPort: number;
}

/** Everything {@link checkDolt} needs. External effects are injected seams. */
export interface CheckDoltOptions {
  /** Project UUID — used to derive the supervisor label + own the allocation. */
  projectId: string;
  /** Absolute path to the project's `.beads` directory. */
  beadsDir: string;
  /** Registry-allocated pinned port for THIS project (null when none allocated). */
  pinnedPort: number | null;
  /** All `{ projectId, doltPort }` allocations from `~/.adjutant/projects.json`. */
  portAllocations: PortAllocation[];
  /** `dolt_server_port` in `.beads/metadata.json` (null when self-managed). */
  metadataPort: number | null;
  /** `.beads/dolt-server.port` contents (null when absent/unreadable). */
  portFileValue: number | null;
  /** `.beads/dolt-server.pid` contents — informational ONLY (adj-182.2.7 distrusts it). */
  pidFileValue?: number | null;
  /**
   * Resolve the supervised server's PID from launchd (`launchctl print`). The single
   * source of truth for which dolt is legitimate (adj-182.2.7) — NOT the pidfile.
   * Returns null when the agent is not loaded.
   */
  launchctlSupervisedPid: () => Promise<number | null>;
  /** SQL health probe against the pinned port. true == reachable (NOT the PID — #2670). */
  sqlProbe: (port: number) => Promise<boolean>;
  /** Scan for all `dolt sql-server` processes (ps/lsof). */
  scanDoltProcesses: () => Promise<DoltProcess[]>;
}

/**
 * Does `cwd` point at this project's data-dir (exactly, or a child)?
 *
 * Path-BOUNDARY match (adj-182.1.5.1): a bare prefix would also match sibling dirs
 * that merely share the prefix (`.beads-backup`, `.beads2`) — those belong to OTHER
 * projects. Anchor on the separator so only true children match.
 */
function cwdUnderDataDir(cwd: string | null, beadsDir: string): boolean {
  if (!cwd) return false;
  return cwd === beadsDir || cwd.startsWith(`${beadsDir}/`);
}

/**
 * The Dolt health-check group. Returns one {@link CheckResult} per dimension:
 * port pinned, agent loaded, server reachable (SQL probe, NOT PID), port-file match,
 * cross-project collision, rogue dolt on the data-dir.
 *
 * Pure orchestration over injected seams — no I/O of its own.
 */
export async function checkDolt(opts: CheckDoltOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Port pinned — metadata `dolt_server_port` is set AND matches the registry.
  if (opts.pinnedPort === null || opts.metadataPort === null) {
    results.push({
      name: "Dolt port pinned",
      status: "fail",
      message: "self-managed mode — run adjutant doctor --fix",
    });
  } else if (opts.metadataPort !== opts.pinnedPort) {
    results.push({
      name: "Dolt port pinned",
      status: "fail",
      message: `metadata.json port ${opts.metadataPort} != registry port ${opts.pinnedPort}`,
    });
  } else {
    results.push({ name: "Dolt port pinned", status: "pass" });
  }

  // 2. Agent loaded — launchd reports a supervised PID for our label.
  const supervisedPid = await opts.launchctlSupervisedPid();
  const label = supervisorLabel(opts.projectId);
  results.push(
    supervisedPid !== null
      ? { name: "Dolt launchd agent loaded", status: "pass" }
      : { name: "Dolt launchd agent loaded", status: "fail", message: `${label} not loaded — run adjutant doctor --fix` },
  );

  // 3. Server reachable — SQL probe on the PINNED PORT (never the PID — #2670 false-up).
  if (opts.pinnedPort === null) {
    results.push({
      name: "Dolt server reachable",
      status: "fail",
      message: "no pinned port to probe",
    });
  } else {
    const reachable = await opts.sqlProbe(opts.pinnedPort);
    results.push(
      reachable
        ? { name: "Dolt server reachable", status: "pass" }
        : { name: "Dolt server reachable", status: "fail", message: `no SQL response on pinned port ${opts.pinnedPort}` },
    );
  }

  // 4. Port-file matches the pinned port.
  if (opts.pinnedPort === null) {
    results.push({ name: "Dolt port file matches", status: "fail", message: "no pinned port" });
  } else if (opts.portFileValue !== opts.pinnedPort) {
    results.push({
      name: "Dolt port file matches",
      status: "fail",
      message: `.beads/dolt-server.port=${opts.portFileValue ?? "<missing>"} != pinned ${opts.pinnedPort}`,
    });
  } else {
    results.push({ name: "Dolt port file matches", status: "pass" });
  }

  // 5. No cross-project port collision — no OTHER project shares our doltPort.
  if (opts.pinnedPort === null) {
    results.push({ name: "No Dolt port collision", status: "pass" });
  } else {
    const collidingProjects = opts.portAllocations.filter(
      (a) => a.doltPort === opts.pinnedPort && a.projectId !== opts.projectId,
    );
    results.push(
      collidingProjects.length === 0
        ? { name: "No Dolt port collision", status: "pass" }
        : {
            name: "No Dolt port collision",
            status: "fail",
            message: `port ${opts.pinnedPort} also allocated to ${collidingProjects.map((p) => p.projectId).join(", ")}`,
          },
    );
  }

  // 6. No rogue dolt on the data-dir — a dolt under OUR data-dir whose PID is NOT the
  //    launchd-supervised one. adj-182.2.7: the supervised PID comes from launchd, NOT
  //    the (possibly stale) pidfile, so a rogue reusing the pidfile's PID is still caught.
  const processes = await opts.scanDoltProcesses();
  const onOurDataDir = processes.filter((p) => cwdUnderDataDir(p.cwd, opts.beadsDir));
  if (supervisedPid === null) {
    // Agent not loaded → supervised PID unknown. Refuse to classify rogues: killing
    // the wrong process is worse than a stale file. Degrade to warn, never fail.
    results.push(
      onOurDataDir.length === 0
        ? { name: "No rogue Dolt server", status: "pass" }
        : {
            name: "No rogue Dolt server",
            status: "warn",
            message: "agent not loaded — cannot classify dolt on data-dir; run adjutant doctor --fix",
          },
    );
  } else {
    const rogues = onOurDataDir.filter((p) => p.pid !== supervisedPid);
    results.push(
      rogues.length === 0
        ? { name: "No rogue Dolt server", status: "pass" }
        : {
            name: "No rogue Dolt server",
            status: "fail",
            message: `rogue dolt pid(s) ${rogues.map((p) => p.pid).join(", ")} on data-dir (supervised pid=${supervisedPid}) — run adjutant doctor --fix`,
          },
    );
  }

  return results;
}

// ── Real seams for checkDolt() ──────────────────────────────────────────────
// Production wiring that resolves the injected seams against the real system. Kept
// separate from the pure check so the orchestration stays trivially testable.

const execFileAsync = promisify(execFile);

/** Read + parse a JSON file, returning null on any failure. */
function readJsonFileSafe<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Read a scalar integer from a file (e.g. `.beads/dolt-server.port`), or null. */
function readIntFileSafe(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const n = parseInt(readFileSync(path, "utf-8").trim(), 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/** The registry path (`~/.adjutant/projects.json`). */
function registryPath(): string {
  return join(homedir(), ".adjutant", "projects.json");
}

/** Read all `{ projectId, doltPort }` allocations from the registry. */
function realPortAllocations(): PortAllocation[] {
  const registry = readJsonFileSafe<Registry>(registryPath());
  if (!registry || !Array.isArray(registry.projects)) return [];
  const out: PortAllocation[] = [];
  for (const p of registry.projects) {
    if (typeof p.id === "string" && typeof p.doltPort === "number") {
      out.push({ projectId: p.id, doltPort: p.doltPort });
    }
  }
  return out;
}

/** Resolve the supervised PID from launchd via `launchctl print` (adj-182.2.7). */
async function realLaunchctlSupervisedPid(projectId: string): Promise<number | null> {
  const label = supervisorLabel(projectId);
  const target = `gui/${userInfo().uid}/${label}`;
  try {
    const { stdout } = await execFileAsync("launchctl", ["print", target]);
    // `launchctl print` emits a `pid = <n>` line only when the job has a running
    // process. Absence (or a non-running job) means no supervised PID.
    const m = stdout.match(/\bpid\s*=\s*(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

/** TCP-connect SQL probe against the pinned port (loopback). Mirrors the installer seam. */
function realSqlProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Scan for all `dolt sql-server` processes via ps + lsof (pid/port/cwd). */
async function realScanDoltProcesses(): Promise<DoltProcess[]> {
  let psOut = "";
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid,command"]);
    psOut = stdout;
  } catch {
    return [];
  }
  const pids: number[] = [];
  for (const line of psOut.split("\n")) {
    if (!/dolt sql-server/.test(line) || /grep/.test(line)) continue;
    const m = line.trim().match(/^(\d+)\s/);
    if (m) pids.push(parseInt(m[1], 10));
  }
  const out: DoltProcess[] = [];
  for (const pid of pids) {
    let port: number | null = null;
    let cwd: string | null = null;
    try {
      const { stdout } = await execFileAsync("lsof", ["-anP", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"]);
      const m = stdout.split("\n").find((l) => new RegExp(`^\\S+\\s+${pid}\\b`).test(l));
      const portMatch = m?.match(/:(\d+)\s*\(LISTEN\)/);
      if (portMatch) port = parseInt(portMatch[1], 10);
    } catch {
      /* port stays null */
    }
    try {
      const { stdout } = await execFileAsync("lsof", ["-p", String(pid)]);
      const cwdLine = stdout.split("\n").find((l) => /\bcwd\b/.test(l));
      const parts = cwdLine?.trim().split(/\s+/);
      if (parts && parts.length > 0) cwd = parts[parts.length - 1];
    } catch {
      /* cwd stays null */
    }
    out.push({ pid, port, cwd });
  }
  return out;
}

/**
 * Build the production {@link CheckDoltOptions} for the project at `cwd`, then run
 * {@link checkDolt}. Returns [] when there is no `.beads/metadata.json` (not a beads
 * project) so the doctor simply omits the dolt group.
 */
export async function runRealCheckDolt(cwd: string): Promise<CheckResult[]> {
  const beadsDir = join(cwd, ".beads");
  const metadata = readJsonFileSafe<Record<string, unknown>>(join(beadsDir, "metadata.json"));
  if (!metadata) return [];

  const projectId = typeof metadata["project_id"] === "string" ? (metadata["project_id"] as string) : null;
  if (!projectId) {
    return [{ name: "Dolt", status: "warn", message: ".beads/metadata.json has no project_id" }];
  }

  const allocations = realPortAllocations();
  const pinnedFromRegistry = allocations.find((a) => a.projectId === projectId)?.doltPort ?? null;
  const rawMetaPort = metadata["dolt_server_port"];
  const metadataPort = typeof rawMetaPort === "number" ? rawMetaPort : null;

  return checkDolt({
    projectId,
    beadsDir,
    pinnedPort: pinnedFromRegistry,
    portAllocations: allocations,
    metadataPort,
    portFileValue: readIntFileSafe(join(beadsDir, "dolt-server.port")),
    pidFileValue: readIntFileSafe(join(beadsDir, "dolt-server.pid")),
    launchctlSupervisedPid: () => realLaunchctlSupervisedPid(projectId),
    sqlProbe: realSqlProbe,
    scanDoltProcesses: realScanDoltProcesses,
  });
}

export async function runDoctor(): Promise<number> {
  printHeader("Adjutant Doctor");
  const cwd = process.cwd();
  const results: CheckResult[] = [];

  // adj-013.3.1 - File/directory existence checks
  results.push(...checkFiles(cwd));

  // Quality gate file checks
  results.push(...checkQualityFiles(cwd));

  // adj-013.3.2 - Network checks (health, MCP SSE)
  results.push(...(await checkNetwork()));

  // adj-013.3.3 - Tool availability checks
  results.push(...checkTools());

  // adj-182.2.1 - Dolt supervised-server health group (omitted on non-beads projects).
  results.push(...(await runRealCheckDolt(cwd)));

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  return hasFail ? 1 : 0;
}
