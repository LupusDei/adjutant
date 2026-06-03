/**
 * `adjutant doctor` — Check system health and prerequisites.
 *
 * Validates file existence, network health, tool availability,
 * and plugin registration. Returns exit code 0 on all pass, 1 on any fail.
 */

import { execFile, execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir, userInfo } from "os";
import { join } from "path";
import { promisify } from "util";

import { printHeader, printCheck, printSummary, type CheckResult } from "../lib/output.js";
import { allocateDoltPortByPath, type Registry } from "../lib/dolt-port-registry.js";
import { pinDoltPort } from "../lib/dolt-pin.js";
import { doltSqlHandshakeOk } from "../lib/dolt-sql-probe.js";
import { classifyDataDirRogues, cwdUnderDataDir, type DoltProcess } from "../lib/dolt-rogue-guard.js";
import { scanDoltProcesses as realScanDoltProcesses, launchctlSupervisedPid as realLaunchctlSupervisedPid } from "../lib/dolt-process-scan.js";
import { clearCircuitFileForPort } from "../lib/dolt-circuit-clear.js";
import {
  installSupervisor,
  supervisorLabel,
  type ExecResult,
  type InstallSupervisorOptions,
  type InstallSupervisorResult,
} from "../lib/dolt-supervisor.js";
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

// `DoltProcess` + `cwdUnderDataDir` now live in the shared rogue-guard module
// (adj-182.2.2.1) so fixDolt and initDoltSupervisor share one classification policy.
// Re-exported here to preserve existing `import { DoltProcess } from "doctor.js"`.
export type { DoltProcess } from "../lib/dolt-rogue-guard.js";

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
 * The Dolt health-check group. Returns one {@link CheckResult} per dimension:
 * port pinned, agent loaded, server reachable (SQL probe, NOT PID), port-file match,
 * cross-project collision, rogue dolt on the data-dir.
 *
 * Pure orchestration over injected seams — no I/O of its own.
 */
export async function checkDolt(opts: CheckDoltOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // adj-182.2.1.r2 — rollout exit-code contract. A CLEAN self-managed project (neither a
  // registry pin NOR a metadata port — i.e. not yet migrated, the state of EVERY project
  // before the cutover) is NOT a failure: bd manages its own ephemeral server today. The
  // old code emitted THREE FAILs for this one root cause, so `doctor` exited 1 on every
  // healthy pre-migration project (noise + broke any CI/script gating on the exit code).
  //
  // For the clean self-managed case we emit ONE actionable non-fail notice and SKIP the
  // dependent reachable/port-file checks (there is no pinned port to reach or match).
  // We STILL run the agent/collision/rogue checks below, but with nothing pinned they are
  // benign (agent-loaded degrades to a notice via the same expected-supervised gate).
  //
  // Hard FAILs are reserved for genuine inconsistency: a PARTIAL pin (one of metadata /
  // registry set but not the other), metadataPort != pinnedPort, a stale port file, a
  // cross-project collision, or a rogue — handled in their own branches.
  const expectedSupervised = opts.pinnedPort !== null || opts.metadataPort !== null;

  // 1. Port pinned — metadata `dolt_server_port` is set AND matches the registry.
  if (opts.pinnedPort === null && opts.metadataPort === null) {
    // Clean self-managed: not yet migrated. One actionable notice, no FAIL.
    results.push({
      name: "Dolt self-managed",
      status: "info",
      message: "self-managed Dolt (not yet migrated) — run adjutant doctor --fix to adopt supervised mode",
    });
  } else if (opts.pinnedPort === null || opts.metadataPort === null) {
    // PARTIAL pin — a genuine inconsistency (one source set, the other missing).
    results.push({
      name: "Dolt port pinned",
      status: "fail",
      message:
        opts.metadataPort === null
          ? `registry pin ${opts.pinnedPort} present but metadata.json dolt_server_port missing — run adjutant doctor --fix`
          : `metadata.json port ${opts.metadataPort} present but no registry allocation — run adjutant doctor --fix`,
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

  // 2. Agent loaded — launchd reports a supervised PID for our label. Only an EXPECTED-
  //    supervised project FAILs when the agent is missing (adj-182.2.1.r2): a clean
  //    self-managed project has no agent by design.
  const supervisedPid = await opts.launchctlSupervisedPid();
  const label = supervisorLabel(opts.projectId);
  if (expectedSupervised) {
    results.push(
      supervisedPid !== null
        ? { name: "Dolt launchd agent loaded", status: "pass" }
        : { name: "Dolt launchd agent loaded", status: "fail", message: `${label} not loaded — run adjutant doctor --fix` },
    );
  }

  // 3. Server reachable — SQL probe on the PINNED PORT (never the PID — #2670 false-up).
  //    SKIPPED entirely for a clean self-managed project: there is no pinned port to reach
  //    (adj-182.2.1.r2 — do not emit a FAIL for the absence of something not yet adopted).
  if (opts.pinnedPort !== null) {
    const reachable = await opts.sqlProbe(opts.pinnedPort);
    results.push(
      reachable
        ? { name: "Dolt server reachable", status: "pass" }
        : { name: "Dolt server reachable", status: "fail", message: `no SQL response on pinned port ${opts.pinnedPort}` },
    );
  }

  // 4. Port-file matches the pinned port. SKIPPED when nothing is pinned (adj-182.2.1.r2).
  if (opts.pinnedPort !== null) {
    if (opts.portFileValue !== opts.pinnedPort) {
      results.push({
        name: "Dolt port file matches",
        status: "fail",
        message: `.beads/dolt-server.port=${opts.portFileValue ?? "<missing>"} != pinned ${opts.pinnedPort}`,
      });
    } else {
      results.push({ name: "Dolt port file matches", status: "pass" });
    }
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

/**
 * Real Dolt SQL-handshake probe (adj-182.2.1.r3): validates the server's MySQL
 * greeting, NOT a bare TCP accept — so a squatter/rogue on the pinned port cannot
 * false-pass. Delegates to the shared {@link doltSqlHandshakeOk}.
 */
function realSqlProbe(port: number): Promise<boolean> {
  return doltSqlHandshakeOk(port);
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

// ── fixDolt() — `adjutant doctor --fix` repair path (adj-182.2.2) ────────────
//
// SAFETY: `--fix` only acts when a HUMAN runs it (never auto-invoked). EVERY
// external effect is an INJECTED seam (install/launchctl, kill, circuit-file delete,
// port allocate, process scan) so this orchestration is trivially testable and
// never runs real launchctl/kill/dolt or mutates the live server in a test.
//
// Repair sequence (order load-bearing):
//   1. Allocate (idempotent) + pin the port — done INSIDE installSupervisor, which
//      pins before loading the agent.
//   2. Resolve the launchd-supervised PID (adj-182.2.7 — NOT the stale pidfile) and
//      kill ROGUE dolt on our data-dir BEFORE installing, so the supervised server
//      owns the data-dir cleanly (two servers on one data-dir → double-open corruption).
//   3. Install + load the agent (idempotent: bootout then bootstrap).
//   4. Clear stale `/tmp/beads-dolt-circuit-*.json` breaker files.

/** Allocate (idempotent) the pinned Dolt port for a project. */
export type AllocatePortFn = (projectId: string) => number;

/** Kill a process by PID (the kill seam — never executed in tests). */
export type KillProcessFn = (pid: number) => void;

/**
 * Clear this project's stale circuit-breaker file (adj-uk9af). Receives the repaired
 * pinned PORT so it targets ONLY `/tmp/beads-dolt-circuit-<port>.json` — never other
 * projects' breaker state. Returns the paths cleared.
 */
export type ClearCircuitFilesFn = (port: number) => Promise<string[]>;

/** Install + verify the supervised server (wraps {@link installSupervisor}). */
export type FixInstallSeam = (opts: InstallSupervisorOptions) => Promise<InstallSupervisorResult>;

/** Everything {@link fixDolt} needs. External effects are injected seams. */
export interface FixDoltOptions {
  /** Project UUID. */
  projectId: string;
  /** Absolute path to the project's `.beads` directory. */
  beadsDir: string;
  /** Allocate (idempotent) the pinned port from the registry. */
  allocatePort: AllocatePortFn;
  /** Install + verify the supervised server. */
  install: FixInstallSeam;
  /** Resolve the supervised PID from launchd (adj-182.2.7 — NOT the pidfile). */
  launchctlSupervisedPid: () => Promise<number | null>;
  /** Scan for all `dolt sql-server` processes (ps/lsof). */
  scanDoltProcesses: () => Promise<DoltProcess[]>;
  /** Kill a process by PID. */
  killProcess: KillProcessFn;
  /** Clear stale circuit-breaker files. */
  clearCircuitFiles: ClearCircuitFilesFn;
  /**
   * Extra install options (doltBin/plistPath/logPath/uid/exec/pinPort/writePlist/
   * sqlProbe) threaded through to {@link install}. Real callers supply the full seam
   * set via {@link runRealFixDolt}; tests stub {@link install} and omit these.
   */
  installOptions?: Omit<InstallSupervisorOptions, "projectId" | "beadsDir" | "port">;
}

/** Outcome of a `--fix` repair. */
export interface FixDoltResult {
  /** True iff the supervised agent verified after repair. */
  ok: boolean;
  /** Per-step CheckResults (kill / agent install / circuit clear). */
  results: CheckResult[];
  /** Rogue PIDs that were killed. */
  killedPids: number[];
  /** Circuit-breaker files cleared. */
  clearedCircuitFiles: string[];
}

/**
 * Repair the Dolt topology. Pure orchestration over injected seams — no I/O of its own.
 */
export async function fixDolt(opts: FixDoltOptions): Promise<FixDoltResult> {
  const results: CheckResult[] = [];

  // 1. Allocate (idempotent) the pinned port.
  const port = opts.allocatePort(opts.projectId);

  // 2. Kill rogues FIRST (before install). adj-182.2.7: classify against the launchd
  //    supervised PID, never the stale pidfile.
  //
  //    adj-182.2.2.1 — first-install double-open guard: on a first install the agent is
  //    not yet loaded, so the supervised PID is unknown. We can STILL safely act on a
  //    rogue that holds the PINNED PORT: port ownership is unambiguous (only one process
  //    can LISTEN on a port), and that squatter is exactly what our about-to-bootstrap
  //    server would collide with — so we kill it. A dolt on our data-dir that does NOT
  //    hold the pinned port remains unclassifiable; killing the wrong process is worse
  //    than leaving a stale one, so we leave it AND refuse the install (step 3) rather
  //    than bootstrap a SECOND server onto a data-dir a rogue still co-owns.
  const supervisedPid = await opts.launchctlSupervisedPid();
  const processes = await opts.scanDoltProcesses();
  const { killPids, refuseInstall } = classifyDataDirRogues(processes, {
    beadsDir: opts.beadsDir,
    pinnedPort: port,
    supervisedPid,
  });
  const killedPids: number[] = [];
  for (const pid of killPids) {
    opts.killProcess(pid);
    killedPids.push(pid);
  }
  if (refuseInstall) {
    results.push({
      name: "Kill rogue Dolt",
      status: "warn",
      message: "agent not loaded — a dolt on the data-dir cannot be classified (not on the pinned port); not killing",
    });
  } else {
    results.push({
      name: "Kill rogue Dolt",
      status: "pass",
      message: killedPids.length > 0 ? `killed ${killedPids.length}` : "no rogues",
    });
  }

  // 3. Install + load the supervisor (pins the port internally; idempotent) — UNLESS an
  //    unclassifiable rogue still co-owns the data-dir. Installing then would put two
  //    servers on one data-dir (double-open corruption), so we abort with a clear FAIL
  //    instead and never call the install seam.
  if (refuseInstall) {
    results.push({
      name: "Dolt launchd agent installed",
      status: "fail",
      message:
        "refused: an unclassifiable dolt occupies the data-dir (agent not loaded). " +
        "Stop the stray dolt server manually, then re-run adjutant doctor --fix.",
    });
    // Still clear stale circuit files (harmless, scoped) so the report is complete.
    const clearedCircuitFiles = await opts.clearCircuitFiles(port);
    results.push({
      name: "Cleared stale circuit files",
      status: "pass",
      message: `${clearedCircuitFiles.length} cleared`,
    });
    return { ok: false, results, killedPids, clearedCircuitFiles };
  }

  const installOptions = {
    ...(opts.installOptions ?? {}),
    projectId: opts.projectId,
    beadsDir: opts.beadsDir,
    port,
  } as InstallSupervisorOptions;
  const install = await opts.install(installOptions);
  results.push(
    install.ok
      ? { name: "Dolt launchd agent installed", status: "pass" }
      : {
          name: "Dolt launchd agent installed",
          status: "fail",
          message: `${install.label} did not verify on port ${port} (bootstrapped=${install.bootstrapped})`,
        },
  );

  // 4. Clear stale circuit-breaker files for THIS port only (adj-uk9af).
  const clearedCircuitFiles = await opts.clearCircuitFiles(port);
  results.push({
    name: "Cleared stale circuit files",
    status: "pass",
    message: `${clearedCircuitFiles.length} cleared`,
  });

  return { ok: install.ok, results, killedPids, clearedCircuitFiles };
}

// ── Real seams for fixDolt() ─────────────────────────────────────────────────

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

/** Resolve the `dolt` binary absolute path via `which`, or null when absent. */
async function resolveDoltBin(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", ["dolt"]);
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Clear ONLY this port's `/tmp/beads-dolt-circuit-<port>.json` breaker file (adj-uk9af).
 * Scoped to the repaired project's pinned port so a single-project `doctor --fix` never
 * wipes OTHER projects' breaker state. Delegates to the shared, unit-tested helper.
 */
async function realClearCircuitFiles(port: number): Promise<string[]> {
  const { readdirSync, rmSync } = await import("fs");
  return clearCircuitFileForPort(port, {
    tmpDir: "/tmp",
    readdir: (dir) => readdirSync(dir),
    remove: (p) => rmSync(p),
  });
}

/**
 * Build the production {@link FixDoltOptions} for the project at `cwd` and run
 * {@link fixDolt}. Returns null when there is no `.beads/metadata.json` with a
 * `project_id` (nothing to repair).
 */
export async function runRealFixDolt(cwd: string): Promise<FixDoltResult | null> {
  const beadsDir = join(cwd, ".beads");
  const metadata = readJsonFileSafe<Record<string, unknown>>(join(beadsDir, "metadata.json"));
  const projectId = metadata && typeof metadata["project_id"] === "string"
    ? (metadata["project_id"] as string)
    : null;
  if (!projectId) return null;

  const doltBin = await resolveDoltBin();
  if (!doltBin) {
    return {
      ok: false,
      results: [{ name: "Dolt repair", status: "fail", message: "`dolt` binary not found on PATH" }],
      killedPids: [],
      clearedCircuitFiles: [],
    };
  }

  const { writeFileSync } = await import("fs");
  const plistPath = join(
    homedir(),
    "Library",
    "LaunchAgents",
    `${supervisorLabel(projectId)}.plist`,
  );

  return fixDolt({
    projectId,
    beadsDir,
    // Allocate by repo PATH, not the beads UUID: the central registry keys entries by
    // an 8-char short id, so resolving by UUID throws "not found" (adj-182.1.4.1). The
    // seam still passes the UUID for label/metadata use; we ignore it for allocation.
    allocatePort: () => allocateDoltPortByPath(cwd),
    install: installSupervisor,
    launchctlSupervisedPid: () => realLaunchctlSupervisedPid(projectId),
    scanDoltProcesses: realScanDoltProcesses,
    killProcess: (pid) => {
      try {
        process.kill(pid);
      } catch {
        /* best-effort */
      }
    },
    clearCircuitFiles: realClearCircuitFiles,
    installOptions: {
      doltBin,
      plistPath,
      logPath: join(beadsDir, "dolt-server.log"),
      uid: userInfo().uid,
      exec: realExec,
      pinPort: pinDoltPort,
      writePlist: (path, contents) => writeFileSync(path, contents, "utf-8"),
      sqlProbe: realSqlProbe,
    },
  });
}

export async function runDoctor(options: { fix?: boolean } = {}): Promise<number> {
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

  // adj-182.2.2 - `--fix` repair path: install/load the supervisor, pin the port, kill
  //   rogue dolt, clear stale circuit files. Human-invoked only. Run BEFORE the dolt
  //   health group so the post-repair state is what gets reported.
  if (options.fix) {
    printHeader("Repairing Dolt (--fix)");
    const fix = await runRealFixDolt(cwd);
    if (fix) {
      results.push(...fix.results);
    } else {
      results.push({ name: "Dolt repair", status: "info", message: "not a beads project — skipped" });
    }
  }

  // adj-182.2.1 - Dolt supervised-server health group (omitted on non-beads projects).
  results.push(...(await runRealCheckDolt(cwd)));

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  return hasFail ? 1 : 0;
}
