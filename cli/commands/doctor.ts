/**
 * `adjutant doctor` — Check system health and prerequisites.
 *
 * Validates file existence, network health, tool availability,
 * and plugin registration. Returns exit code 0 on all pass, 1 on any fail.
 */

import { execFile, execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { homedir, userInfo } from "os";
import { dirname, join } from "path";
import { promisify } from "util";

import { printHeader, printCheck, printSummary, type CheckResult } from "../lib/output.js";
import { allocateDoltPortByPath, getDoltPortByPath, getRegistryIdByPath, type Registry } from "../lib/dolt-port-registry.js";
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

  // Resolve the pinned port AND this project's own registry id by repo PATH, not the beads
  // UUID: the central registry keys entries by an 8-char short id (a different id-space from
  // the beads project_id), so a UUID lookup never matches — yielding both a false "no
  // registry allocation" FAIL and a false self-collision (adj-54n52). Dropping our own entry
  // (by short id) leaves only genuine cross-project collisions for the collision check.
  const selfRegistryId = getRegistryIdByPath(cwd);
  const allocations = realPortAllocations().filter((a) => a.projectId !== selfRegistryId);
  const pinnedFromRegistry = getDoltPortByPath(cwd);
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
 * Write a launchd plist, creating its parent directory if missing.
 *
 * On a fresh macOS account `~/Library/LaunchAgents` may not exist yet; a bare
 * `writeFileSync` then throws `ENOENT` and aborts `adjutant doctor --fix` before the
 * supervisor can install (adj-k5g14). `mkdir -p` of the parent makes the write robust
 * on a never-before-supervised machine. Idempotent — `recursive: true` is a no-op when
 * the directory already exists.
 */
export function writePlistEnsuringDir(plistPath: string, contents: string): void {
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, contents, "utf-8");
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
      writePlist: writePlistEnsuringDir,
      sqlProbe: realSqlProbe,
    },
  });
}

// ── checkBdSchema() — bd/dolt schema-currency group (adj-7h8ve, epic adj-182) ─
//
// bd 1.0.4 hangs on every server-mode WRITE (it auto-imports issues.jsonl). The fix is
// upstream #4170 ("auto-import: gate server mode at call site"), which only exists in
// builds AFTER the `0043` schema migration (`0043_drop_dependencies_generated_column` —
// it restructures the `dependencies` table to a surrogate `id CHAR(36)` PK). So a
// migrated DB has a `dependencies.id` column; a pre-0043 DB does not.
//
// A second, subtler failure mode is a HALF-APPLIED 0043: a `bd list` READ starts the
// 0043 migration chain but a read never commits, leaving `schema_migrations` + tables
// modified (a DIRTY working set) → the next write fails with
// "pre-existing dirty tables changed during schema migration: …". The repair (fixBdSchema)
// resets the dirty set then migrates-via-WRITE (a write applies AND commits in one op).
//
// checkBdSchema is PURE: it takes the RESULTS of the probes (bd version string, whether
// `dependencies.id` exists, whether the working set is dirty) — never the live calls —
// so it is trivially unit-testable with no real bd/dolt invocation. The real probing
// lives in runRealCheckBdSchema (below), mirroring the checkDolt/runRealCheckDolt split.

/** Seam RESULTS {@link checkBdSchema} reasons over. No live calls here. */
export interface CheckBdSchemaOptions {
  /** `bd version` output. A HEAD- build OR a tagged release >= 1.0.5 carries #4170. */
  bdVersion: string;
  /** Does `dependencies` have the `id` column? true == the 0043 migration is applied. */
  dependenciesHasIdColumn: boolean;
  /** Is the Dolt working set dirty (a half-applied 0043 migration)? */
  workingSetDirty: boolean;
  /** Is this a beads project at all? false → the group is omitted entirely. */
  isBeadsProject: boolean;
}

/**
 * Does this `bd version` string carry the #4170 server-mode write fix?
 *
 * A HEAD- build (e.g. `HEAD-1825cf3 (Homebrew: HEAD@…)`) is always post-fix. Otherwise
 * we parse the leading `major.minor.patch` and require >= 1.0.5 (the first tagged release
 * that includes #4170 + the 0043 migration). An unparseable version is treated as lacking
 * the fix (fail-closed — better to over-warn than ship the hang).
 */
export function bdVersionHasWriteFix(version: string): boolean {
  if (version.includes("HEAD-")) return true;
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (major !== 1) return major > 1; // 2.x.y and up are post-fix; 0.x is pre-fix.
  if (minor !== 0) return minor > 0; // 1.1.x and up are post-fix.
  return patch >= 5; // 1.0.5+ carries the fix; 1.0.0–1.0.4 do not.
}

/**
 * The bd/dolt schema-currency check group. One {@link CheckResult} on a healthy system;
 * a single actionable FAIL otherwise. Returns [] for non-beads projects.
 *
 * Ordering is deliberate: the bd-version gate is reported FIRST and short-circuits — if
 * bd itself lacks the fix, migrating the schema is pointless (the next write still hangs),
 * so we surface the one root cause rather than a cascade of derived failures.
 */
export function checkBdSchema(opts: CheckBdSchemaOptions): CheckResult[] {
  if (!opts.isBeadsProject) return [];

  if (!bdVersionHasWriteFix(opts.bdVersion)) {
    return [
      {
        name: "bd #4170 write fix",
        status: "fail",
        message: "bd lacks the #4170 server-mode write fix — run adjutant doctor --fix",
      },
    ];
  }

  if (opts.workingSetDirty) {
    return [
      {
        name: "Dolt working set clean",
        status: "fail",
        message: "Dolt working set dirty (half-applied 0043 migration) — run adjutant doctor --fix",
      },
    ];
  }

  if (!opts.dependenciesHasIdColumn) {
    return [
      {
        name: "Dolt schema 0043 applied",
        status: "fail",
        message: "Dolt schema pre-0043 (server-mode writes will fail) — run adjutant doctor --fix",
      },
    ];
  }

  return [
    {
      name: "bd schema current",
      status: "pass",
      message: "0043 applied, #4170 fix present",
    },
  ];
}

// ── Real seams for checkBdSchema() ───────────────────────────────────────────
// Production wiring that resolves the pure check's inputs against the real system —
// kept separate so the orchestration stays trivially testable.

/**
 * Resolve the single dbName subdir under `<beadsDir>/dolt/` (e.g. `beads_adj`, `beads`,
 * `factorify`). bd lays out exactly one database dir there; returns null when absent.
 */
function resolveDoltDbName(beadsDir: string): string | null {
  const doltDir = join(beadsDir, "dolt");
  if (!existsSync(doltDir)) return null;
  try {
    const dirs = readdirSync(doltDir).filter((e) => {
      if (e.startsWith(".")) return false;
      try {
        return statSync(join(doltDir, e)).isDirectory();
      } catch {
        return false;
      }
    });
    return dirs.length > 0 ? dirs[0] : null;
  } catch {
    return null;
  }
}

/** True iff `dolt status` (routed to the live server) reports a dirty working set. */
function parseWorkingSetDirty(statusStdout: string): boolean {
  return /changes not staged for commit|changes to be committed|modified:/i.test(statusStdout);
}

/** True iff a `SHOW COLUMNS … LIKE 'id'` returned a row (the 0043 `dependencies.id` PK). */
function parseHasIdColumn(showColumnsStdout: string): boolean {
  return showColumnsStdout.trim().length > 0 && /\bid\b/i.test(showColumnsStdout);
}

/**
 * Probe the real system for {@link checkBdSchema}'s inputs and run it. Returns [] when
 * there is no `<cwd>/.beads/dolt/<db>` (not a migrated beads project) so the doctor
 * simply omits the group. The `dolt` CLI is invoked WITH the db dir as cwd so it routes
 * to the running supervised sql-server (no stop/start, read-only here).
 */
export async function runRealCheckBdSchema(cwd: string): Promise<CheckResult[]> {
  const beadsDir = join(cwd, ".beads");
  const dbName = resolveDoltDbName(beadsDir);
  if (!dbName) return [];

  const doltDir = join(beadsDir, "dolt");
  // dolt CLI must run IN the repo dir (.beads/dolt/<db>), NOT the parent data-dir — else
  // `dolt status` reports an empty/wrong working set and a dirty half-migration goes
  // UNDETECTED (adj-7h8ve: caught by the live backup-fixture validation, not unit stubs).
  const repoDir = join(doltDir, dbName);

  // bd version (the #4170 gate).
  const versionRes = await realExec("bd", ["version"]);
  const bdVersion = `${versionRes.stdout} ${versionRes.stderr}`.trim();

  // dolt status — dirty working set detection (run in the repo dir → routes to live server).
  const statusRes = await realExecInDir(repoDir, "dolt", ["status"]);
  const workingSetDirty = parseWorkingSetDirty(statusRes.stdout);

  // dependencies.id column — the 0043 marker.
  const colRes = await realExecInDir(repoDir, "dolt", [
    "sql",
    "-q",
    `SHOW COLUMNS FROM ${dbName}.dependencies LIKE 'id'`,
  ]);
  const dependenciesHasIdColumn = colRes.code === 0 && parseHasIdColumn(colRes.stdout);

  return checkBdSchema({
    bdVersion,
    dependenciesHasIdColumn,
    workingSetDirty,
    isBeadsProject: true,
  });
}

// ── Dolt engine version compatibility (adj-tgthb) ────────────────────────────
//
// dolt 2.x changed same-transaction foreign-key visibility. bd's top-level `create`
// inserts the issue and its self-referential `child_counters` row in ONE transaction;
// dolt 2.x fails the FK check because it does not see the pending parent insert, so
// EVERY top-level `bd create` dies with "cannot add or update a child row". The beads
// HEAD brew formula pulls dolt as a dependency and can silently bump it to 2.x. dolt
// 1.83.x is the known-good band. Reads are unaffected, so this WARNs (not FAILs).

/**
 * Classify a `dolt version` string for bd write-compatibility. Pure — no I/O.
 *
 * Returns a WARN for dolt major >= 2 (breaks top-level `bd create`), a WARN when the
 * version cannot be parsed (can't verify), else a PASS carrying the parsed version.
 */
export function checkDoltVersionCompat(versionOutput: string): CheckResult {
  const m = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return { name: "Dolt version", status: "warn", message: "could not parse `dolt version` output" };
  }
  if (Number(m[1]) >= 2) {
    return {
      name: "Dolt version",
      status: "warn",
      message: `dolt ${m[0]} breaks top-level bd create (FK same-tx, adj-tgthb) — relink dolt < 2.0 (e.g. 1.83.6)`,
    };
  }
  return { name: "Dolt version", status: "pass", message: `dolt ${m[0]}` };
}

/**
 * Probe the real `dolt version` and classify it via {@link checkDoltVersionCompat}.
 * Returns [] for a non-beads project (the group is irrelevant) or when `dolt` is
 * absent/unrunnable (the "bd CLI"/dolt-repair groups already cover a missing toolchain).
 */
export async function runRealCheckDoltVersion(cwd: string): Promise<CheckResult[]> {
  if (!resolveDoltDbName(join(cwd, ".beads"))) return [];
  const res = await realExec("dolt", ["version"]);
  if (res.code !== 0) return [];
  return [checkDoltVersionCompat(`${res.stdout} ${res.stderr}`)];
}

// ── fixBdSchema() — `adjutant doctor --fix` bd/dolt schema repair (adj-7h8ve) ─
//
// The VALIDATED 5-step repair (run live 11× across the fleet):
//   1. BACKUP the `.beads/dolt` dir + `issues.jsonl` (forward-only migration; the backup
//      IS the rollback). Always taken, before any mutation.
//   2. DETECT a dirty working set via `dolt status` (a half-applied 0043 — a READ began
//      the migration chain but never committed, leaving schema_migrations + tables dirty).
//   3. If dirty: `dolt reset --hard` to discard the half-applied migration. The dolt CLI,
//      invoked in the db dir, routes to the RUNNING supervised server — it stays up.
//   4. MIGRATE-VIA-WRITE: `bd create` + `bd close`. A WRITE (not a read) applies AND
//      commits the 0043 migration in one op (autocommit on). KEY INSIGHT: reads leave it
//      dirty, writes commit it.
//   5. VERIFY: a second `bd create` + `bd close` completes cleanly (no "dirty tables", no
//      "auto-importing into empty database").
//
// SAFETY: `--fix` only acts when a HUMAN runs it (never auto-invoked). EVERY external
// effect (exec of dolt/bd, the backup copy) is an INJECTED seam — this orchestration runs
// NO real dolt/bd and never mutates a live server in a test. Idempotent: on an already-
// migrated, clean system the reset is SKIPPED and the verify write still passes.

/** A throwaway bead title used by the migrate-via-write + verify steps. */
const SCHEMA_PROBE_TITLE = "adjutant doctor schema-migration probe";

/** Everything {@link fixBdSchema} needs. External effects are injected seams. */
export interface FixBdSchemaOptions {
  /** The repo dir whose `.beads/dolt/<db>` we repair. `bd` runs with this as cwd. */
  repoDir: string;
  /** The single dolt database name under `.beads/dolt/` (e.g. `beads_adj`). */
  dbName: string;
  /** Project path for bd resolution (usually == repoDir). */
  projectPath: string;
  /** The exec seam (reused like {@link realExec}). cwd is threaded via the args contract. */
  exec: (cmd: string, args: readonly string[]) => Promise<ExecResult>;
  /** Backup the `.beads/dolt` dir + `issues.jsonl`. Returns the backup path. */
  backup: () => Promise<string>;
}

/** Outcome of a bd/dolt schema `--fix` repair. */
export interface FixBdSchemaResult {
  /** True iff the verify-via-write step completed cleanly. */
  ok: boolean;
  /** Per-step CheckResults (backup / reset / migrate / verify). */
  results: CheckResult[];
}

/**
 * Run a `bd create` + `bd close` write cycle in `repoDir`. Returns whether the create
 * (the migration-committing WRITE) completed — a non-zero code or a "dirty tables" /
 * "auto-importing" stderr means it did not. The close is best-effort cleanup of the
 * throwaway bead and never fails the cycle.
 */
async function bdWriteCycle(opts: FixBdSchemaOptions): Promise<{ ok: boolean; detail: string }> {
  const createRes = await opts.exec("bd", [
    "create",
    "--title",
    SCHEMA_PROBE_TITLE,
    "--type",
    "task",
    "-C",
    opts.repoDir,
  ]);
  const combined = `${createRes.stdout}\n${createRes.stderr}`;
  const failed =
    createRes.code !== 0 ||
    /dirty tables|auto-importing into empty database|schema migration/i.test(combined);
  if (failed) {
    return { ok: false, detail: createRes.stderr.trim() || combined.trim() };
  }

  // Extract the created bead id (best-effort) to close it; never fail the cycle on close.
  const idMatch = createRes.stdout.match(/\b([a-z][a-z0-9]*-[a-z0-9.]+)\b/i);
  if (idMatch) {
    await opts.exec("bd", ["close", idMatch[1], "-C", opts.repoDir]);
  }
  return { ok: true, detail: createRes.stdout.trim() };
}

/**
 * Repair the bd/dolt schema. Pure orchestration over injected seams — no I/O of its own.
 */
export async function fixBdSchema(opts: FixBdSchemaOptions): Promise<FixBdSchemaResult> {
  const results: CheckResult[] = [];

  // 1. BACKUP — always, before any mutation (the backup IS the rollback).
  const backupPath = await opts.backup();
  results.push({ name: "Backup .beads/dolt", status: "pass", message: backupPath });

  // 2. DETECT dirty working set (`dolt status`, routed to the live server via the db-dir cwd).
  const statusRes = await opts.exec("dolt", ["status", "-C", opts.repoDir]);
  const dirty = parseWorkingSetDirty(statusRes.stdout);

  // 3. RESET --hard only when dirty (discard the half-applied 0043 migration). Idempotent:
  //    a clean working set SKIPS the reset.
  if (dirty) {
    await opts.exec("dolt", ["reset", "--hard", "-C", opts.repoDir]);
    results.push({
      name: "Dolt reset --hard (discard half-applied 0043)",
      status: "pass",
      message: "discarded dirty working set",
    });
  } else {
    results.push({
      name: "Dolt reset --hard",
      status: "info",
      message: "working set already clean — reset skipped",
    });
  }

  // 4. MIGRATE-VIA-WRITE — a WRITE applies AND commits 0043 in one op.
  const migrate = await bdWriteCycle(opts);
  if (!migrate.ok) {
    results.push({
      name: "Migrate-via-write (0043)",
      status: "fail",
      message: migrate.detail || "bd write did not complete",
    });
    return { ok: false, results };
  }
  results.push({
    name: "Migrate-via-write (0043)",
    status: "pass",
    message: "bd write applied + committed the 0043 migration",
  });

  // 5. VERIFY — a SECOND bd write completes cleanly (no dirty tables, no empty-db import).
  const verify = await bdWriteCycle(opts);
  if (!verify.ok) {
    results.push({
      name: "Verify schema (second write)",
      status: "fail",
      message: verify.detail || "verify write did not complete",
    });
    return { ok: false, results };
  }
  results.push({
    name: "Verify schema (second write)",
    status: "pass",
    message: "second bd write completed cleanly",
  });

  return { ok: true, results };
}

// ── Real seams for fixBdSchema() ─────────────────────────────────────────────

/** Exec a command WITH a fixed cwd (the dolt CLI routes to the live server by cwd). */
async function realExecInDir(
  cwd: string,
  cmd: string,
  args: readonly string[],
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...args], { cwd });
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
 * Back up `<beadsDir>/dolt` + `<beadsDir>/issues.jsonl` to a timestamped sibling dir.
 * Forward-only migration: this backup IS the rollback. Returns the backup dir path.
 */
async function realBackupBeads(beadsDir: string): Promise<string> {
  const { cpSync, mkdirSync } = await import("fs");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(beadsDir, `backup-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  const doltDir = join(beadsDir, "dolt");
  if (existsSync(doltDir)) {
    cpSync(doltDir, join(backupDir, "dolt"), { recursive: true });
  }
  const jsonl = join(beadsDir, "issues.jsonl");
  if (existsSync(jsonl)) {
    cpSync(jsonl, join(backupDir, "issues.jsonl"));
  }
  return backupDir;
}

/**
 * Build the production {@link FixBdSchemaOptions} for the project at `cwd` and run
 * {@link fixBdSchema}. Returns null when there is no `<cwd>/.beads/dolt/<db>` (nothing
 * to repair). The exec seam runs `dolt` with the db dir as cwd so it routes to the
 * running supervised server; `bd` runs in the repo dir.
 */
export async function runRealFixBdSchema(cwd: string): Promise<FixBdSchemaResult | null> {
  const beadsDir = join(cwd, ".beads");
  const dbName = resolveDoltDbName(beadsDir);
  if (!dbName) return null;

  const doltDir = join(beadsDir, "dolt");
  // dolt commands must run in the repo dir (.beads/dolt/<db>), not the parent data-dir
  // (adj-7h8ve fixture bug: a parent-dir `dolt status` never sees the dirty working set).
  const doltRepoDir = join(doltDir, dbName);

  return fixBdSchema({
    repoDir: cwd,
    dbName,
    projectPath: cwd,
    // The exec seam: `dolt` runs in the db dir (routes to the live server); `bd` runs in
    // the repo dir. We strip the synthetic `-C <repoDir>` contract args used by the pure
    // orchestration (they make cwd observable in unit tests) and apply the real cwd here.
    exec: (cmd, args) => {
      const stripped: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-C") {
          i++; // skip the -C value
          continue;
        }
        stripped.push(args[i]);
      }
      const isDolt = cmd.includes("dolt");
      return realExecInDir(isDolt ? doltRepoDir : cwd, cmd, stripped);
    },
    backup: () => realBackupBeads(beadsDir),
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

    // adj-7h8ve - bd/dolt schema repair: reset a half-applied 0043, then migrate-via-write
    //   so server-mode writes (the #4170 path) stop hanging. Human-invoked only; runs after
    //   the supervisor repair (the server must be up for the dolt CLI to route to it) and
    //   BEFORE the schema health check so the post-repair state is reported.
    printHeader("Repairing bd/dolt schema (--fix)");
    const schemaFix = await runRealFixBdSchema(cwd);
    if (schemaFix) {
      results.push(...schemaFix.results);
    } else {
      results.push({ name: "bd schema repair", status: "info", message: "not a beads project — skipped" });
    }
  }

  // adj-182.2.1 - Dolt supervised-server health group (omitted on non-beads projects).
  results.push(...(await runRealCheckDolt(cwd)));

  // adj-7h8ve - bd/dolt schema-currency health group (omitted on non-beads projects).
  results.push(...(await runRealCheckBdSchema(cwd)));

  // adj-tgthb - Dolt engine version compatibility (dolt 2.x breaks bd top-level create).
  results.push(...(await runRealCheckDoltVersion(cwd)));

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  return hasFail ? 1 : 0;
}
