/**
 * `adjutant init` — Bootstrap a fresh Adjutant installation.
 *
 * Creates .adjutant/PRIME.md, .mcp.json, registers Claude Code hooks,
 * checks dependencies, and initializes the SQLite database.
 *
 * Idempotent: safe to run multiple times.
 */

import { execFile } from "child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir, userInfo } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

import {
  fileExists,
  dirExists,
  mcpJsonValid,
  parseJsonFile,
  writeJsonFile,
  getAdjutantDbPath,
  getGlobalAdjutantDir,
} from "../lib/checks.js";
import { installPlugin } from "../lib/plugin.js";
import { QUALITY_FILES, loadTemplate } from "../lib/quality-templates.js";
import { printHeader, printCheck, printSummary, printSuccess, printError, type CheckResult } from "../lib/output.js";
import { PRIME_MD_CONTENT } from "../lib/prime.js";
import { allocateDoltPortByPath } from "../lib/dolt-port-registry.js";
import { pinDoltPort } from "../lib/dolt-pin.js";
import { doltSqlHandshakeOk } from "../lib/dolt-sql-probe.js";
import { classifyDataDirRogues, type DoltProcess } from "../lib/dolt-rogue-guard.js";
import { scanDoltProcesses as realScanDoltProcesses, launchctlSupervisedPid as realLaunchctlSupervisedPid } from "../lib/dolt-process-scan.js";
import {
  installSupervisor,
  supervisorLabel,
  type ExecResult,
  type InstallSupervisorOptions,
  type InstallSupervisorResult,
} from "../lib/dolt-supervisor.js";

interface InitOptions {
  force: boolean;
}

const MCP_CONFIG = {
  mcpServers: {
    adjutant: {
      type: "http",
      url: "http://localhost:4201/mcp",
      headers: {
        "X-Agent-Id": "${ADJUTANT_AGENT_ID:-unknown}",
        "X-Project-Root": "${ADJUTANT_PROJECT_ROOT:-}",
      },
    },
  },
};

function initAdjutantDir(projectRoot: string, force: boolean): CheckResult {
  const adjDir = join(projectRoot, ".adjutant");
  const primePath = join(adjDir, "PRIME.md");

  if (!dirExists(adjDir)) {
    mkdirSync(adjDir, { recursive: true });
  }

  if (fileExists(primePath) && !force) {
    return { name: ".adjutant/PRIME.md", status: "skipped", message: "already exists" };
  }

  writeFileSync(primePath, PRIME_MD_CONTENT, "utf-8");
  return { name: ".adjutant/PRIME.md", status: "created" };
}

function initGlobalPrime(force: boolean): CheckResult {
  const globalDir = getGlobalAdjutantDir();
  const primePath = join(globalDir, "PRIME.md");

  if (!dirExists(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }

  if (fileExists(primePath) && !force) {
    return { name: "~/.adjutant/PRIME.md", status: "skipped", message: "already exists" };
  }

  writeFileSync(primePath, PRIME_MD_CONTENT, "utf-8");
  return { name: "~/.adjutant/PRIME.md", status: "created", message: "default global PRIME.md" };
}

function initMcpJson(projectRoot: string): CheckResult {
  const { exists, hasAdjutant, malformed } = mcpJsonValid(projectRoot);

  if (!exists) {
    writeJsonFile(join(projectRoot, ".mcp.json"), MCP_CONFIG);
    return { name: ".mcp.json", status: "created" };
  }

  if (malformed) {
    return { name: ".mcp.json", status: "fail", message: "file exists but contains invalid JSON — fix manually" };
  }

  if (hasAdjutant) {
    return { name: ".mcp.json", status: "skipped", message: "adjutant server already configured" };
  }

  // Exists but missing adjutant entry — merge without clobbering
  const mcpPath = join(projectRoot, ".mcp.json");
  const existing = parseJsonFile<Record<string, unknown>>(mcpPath) ?? {};
  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  servers.adjutant = MCP_CONFIG.mcpServers.adjutant;
  existing.mcpServers = servers;
  writeJsonFile(mcpPath, existing);

  return { name: ".mcp.json", status: "created", message: "merged adjutant into existing config" };
}

function checkDependencies(projectRoot: string): CheckResult[] {
  const results: CheckResult[] = [];

  const backendModules = dirExists(join(projectRoot, "backend", "node_modules"));
  const frontendModules = dirExists(join(projectRoot, "frontend", "node_modules"));

  if (backendModules && frontendModules) {
    results.push({ name: "Dependencies", status: "pass", message: "node_modules found" });
  } else {
    const missing: string[] = [];
    if (!backendModules) missing.push("backend");
    if (!frontendModules) missing.push("frontend");
    results.push({
      name: "Dependencies",
      status: "warn",
      message: `${missing.join(", ")} node_modules missing — run: npm run install:all`,
    });
  }

  return results;
}

function checkDatabase(): CheckResult {
  const dbPath = getAdjutantDbPath();
  if (fileExists(dbPath)) {
    return { name: "SQLite database", status: "pass", message: dbPath };
  }
  return {
    name: "SQLite database",
    status: "warn",
    message: "not found — created automatically on first npm run dev",
  };
}

/**
 * Scaffold quality-gate files (testing rules, code review, CI, etc.) into a project.
 *
 * Copies templates from cli/templates/quality/ to their destination paths.
 * Respects skipIfExists (e.g. ci.yml is never overwritten) and force flag.
 *
 * @param projectRoot - Absolute path to the project root directory
 * @param force - If true, overwrite existing files (except those with skipIfExists)
 * @returns Array of CheckResults describing what was created or skipped
 */
export function scaffoldQualityFiles(projectRoot: string, force: boolean): CheckResult[] {
  const results: CheckResult[] = [];

  for (const qf of QUALITY_FILES) {
    const fullPath = join(projectRoot, qf.destPath);

    if (qf.skipIfExists && fileExists(fullPath)) {
      results.push({ name: qf.destPath, status: "skipped", message: "existing CI config preserved" });
      continue;
    }

    if (fileExists(fullPath) && !force) {
      results.push({ name: qf.destPath, status: "skipped", message: "already exists" });
      continue;
    }

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, loadTemplate(qf.templateName), "utf-8");

    if (qf.executable) {
      chmodSync(fullPath, 0o755);
    }

    results.push({ name: qf.destPath, status: "created" });
  }

  return results;
}

// ── initDoltSupervisor() — pin port + install supervisor on init (adj-182.2.3) ─
//
// Fresh `adjutant init` makes new projects correct-by-default: allocate (idempotent)
// + pin a stable per-project Dolt port and install+load the launchd supervisor so the
// one server is always running on the pinned port. Re-running is idempotent (same port;
// install bootout+bootstrap is a no-op restart).
//
// SAFETY: every external effect (allocate, install/launchctl, plist write, SQL probe) is
// an INJECTED seam so this is trivially testable and never runs real launchctl/dolt.

/** Allocate (idempotent) the pinned Dolt port for a project. */
export type AllocatePortFn = (projectId: string) => number;

/** Install + verify the supervised server (wraps {@link installSupervisor}). */
export type InitInstallSeam = (opts: InstallSupervisorOptions) => Promise<InstallSupervisorResult>;

/** Everything {@link initDoltSupervisor} needs. External effects are injected seams. */
export interface InitDoltSupervisorOptions {
  /** Project UUID. */
  projectId: string;
  /** Absolute path to the project's `.beads` directory. */
  beadsDir: string;
  /** Allocate (idempotent) the pinned port from the registry. */
  allocatePort: AllocatePortFn;
  /** Install + verify the supervised server. */
  install: InitInstallSeam;
  /**
   * adj-182.2.2.1 — OPTIONAL first-install double-open guard seams. When `scanDoltProcesses`
   * is provided, init classifies any dolt already running under the data-dir BEFORE
   * installing (kill a pinned-port squatter; refuse install on an unclassifiable rogue) so
   * a fresh init never bootstraps a SECOND server onto a shared data-dir. When omitted, init
   * behaves exactly as before (clean fresh install) for back-compat.
   */
  scanDoltProcesses?: () => Promise<DoltProcess[]>;
  /** Kill a process by PID (paired with {@link scanDoltProcesses}). */
  killProcess?: (pid: number) => void;
  /**
   * Resolve the supervised PID from launchd (adj-182.2.7). At init time the agent is
   * usually not loaded yet → null → first-install classification. Defaults to null.
   */
  launchctlSupervisedPid?: () => Promise<number | null>;
  /**
   * Extra install options threaded through to {@link install}. Real callers supply the
   * full seam set via {@link runRealInitDoltSupervisor}; tests stub {@link install}.
   */
  installOptions?: Omit<InstallSupervisorOptions, "projectId" | "beadsDir" | "port">;
}

/**
 * Allocate+pin the port and install+load the supervisor. Returns a single
 * {@link CheckResult} summarizing the outcome. Pure orchestration over injected seams.
 */
export async function initDoltSupervisor(opts: InitDoltSupervisorOptions): Promise<CheckResult> {
  // 1. Allocate (idempotent) the pinned port. A failure (band exhausted / no registry)
  //    aborts BEFORE any install attempt.
  let port: number;
  try {
    port = opts.allocatePort(opts.projectId);
  } catch (err) {
    return {
      name: "Dolt supervisor",
      status: "fail",
      message: `port allocation failed: ${(err as Error).message}`,
    };
  }

  // 1b. adj-182.2.2.1 first-install double-open guard. Only runs when the caller wires
  //     the scan seam. Kill a pinned-port squatter (unambiguous); refuse to install if an
  //     unclassifiable dolt still co-owns the data-dir (would double-open).
  if (opts.scanDoltProcesses) {
    const supervisedPid = opts.launchctlSupervisedPid ? await opts.launchctlSupervisedPid() : null;
    const processes = await opts.scanDoltProcesses();
    const { killPids, refuseInstall } = classifyDataDirRogues(processes, {
      beadsDir: opts.beadsDir,
      pinnedPort: port,
      supervisedPid,
    });
    if (opts.killProcess) {
      for (const pid of killPids) opts.killProcess(pid);
    }
    if (refuseInstall) {
      return {
        name: "Dolt supervisor",
        status: "fail",
        message:
          "refused: an unclassifiable dolt occupies the data-dir. Stop the stray dolt " +
          "server manually, then re-run adjutant init.",
      };
    }
  }

  // 2. Install + load the supervisor (pins the port internally; idempotent).
  const installOptions = {
    ...(opts.installOptions ?? {}),
    projectId: opts.projectId,
    beadsDir: opts.beadsDir,
    port,
  } as InstallSupervisorOptions;
  const result = await opts.install(installOptions);

  return result.ok
    ? { name: "Dolt supervisor", status: "created", message: `pinned port ${port}, agent loaded` }
    : {
        name: "Dolt supervisor",
        status: "fail",
        message: `${result.label} did not verify on port ${port} (bootstrapped=${result.bootstrapped})`,
      };
}

// ── Real seams for initDoltSupervisor() ──────────────────────────────────────

const execFileAsync = promisify(execFile);

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
 * Real Dolt SQL-handshake probe (adj-182.2.1.r3): validates the server's MySQL
 * greeting, NOT a bare TCP accept — so a squatter/rogue on the pinned port cannot
 * false-pass. Delegates to the shared {@link doltSqlHandshakeOk}.
 */
function realSqlProbe(port: number): Promise<boolean> {
  return doltSqlHandshakeOk(port);
}

/**
 * Build the production {@link InitDoltSupervisorOptions} for the project at `projectRoot`
 * and run {@link initDoltSupervisor}. Returns null when there is no `.beads/metadata.json`
 * with a `project_id` (not a beads project — nothing to supervise). Returns a `warn`
 * CheckResult when `dolt` is not installed (init still succeeds; supervisor is optional).
 */
export async function runRealInitDoltSupervisor(projectRoot: string): Promise<CheckResult | null> {
  const beadsDir = join(projectRoot, ".beads");
  const metadataPath = join(beadsDir, "metadata.json");
  if (!existsSync(metadataPath)) return null;

  let projectId: string | null = null;
  try {
    const meta = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
    if (typeof meta["project_id"] === "string") projectId = meta["project_id"] as string;
  } catch {
    return { name: "Dolt supervisor", status: "warn", message: ".beads/metadata.json unreadable — skipped" };
  }
  if (!projectId) {
    return { name: "Dolt supervisor", status: "warn", message: ".beads/metadata.json has no project_id — skipped" };
  }

  const doltBin = await resolveDoltBin();
  if (!doltBin) {
    return { name: "Dolt supervisor", status: "warn", message: "`dolt` not on PATH — supervisor not installed" };
  }

  const plistPath = join(
    homedir(),
    "Library",
    "LaunchAgents",
    `${supervisorLabel(projectId)}.plist`,
  );

  return initDoltSupervisor({
    projectId,
    beadsDir,
    // Allocate by repo PATH, not the beads UUID: the central registry keys entries by
    // an 8-char short id, so resolving by UUID throws "not found" (adj-182.1.4.1). The
    // seam still passes the UUID for label/metadata use; we ignore it for allocation.
    allocatePort: () => allocateDoltPortByPath(projectRoot),
    install: installSupervisor,
    // adj-182.2.2.1 first-install double-open guard: wire the real ps/lsof + launchctl
    // seams so a fresh init never bootstraps a second server onto a data-dir a rogue
    // already co-owns (kills a pinned-port squatter; refuses on an unclassifiable rogue).
    scanDoltProcesses: () => realScanDoltProcesses(),
    launchctlSupervisedPid: () => realLaunchctlSupervisedPid(projectId),
    killProcess: (pid) => {
      try {
        process.kill(pid);
      } catch {
        /* best-effort */
      }
    },
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

export async function runInit(options: InitOptions): Promise<number> {
  printHeader("Adjutant Init");
  const projectRoot = process.cwd();
  const results: CheckResult[] = [];

  // Global default PRIME.md (~/.adjutant/PRIME.md)
  results.push(initGlobalPrime(options.force));

  // Local .adjutant/ dir + PRIME.md (repo-specific override)
  results.push(initAdjutantDir(projectRoot, options.force));

  // adj-013.2.3: .mcp.json creation/validation
  results.push(initMcpJson(projectRoot));

  // Plugin installation (symlink, registry, enable, legacy hook cleanup)
  // Resolve adjutant project root from this module's location (not cwd)
  // dist/cli/commands/init.js -> project root is 3 levels up
  const adjutantRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const pkg = JSON.parse(readFileSync(join(adjutantRoot, "package.json"), "utf-8"));
  results.push(...installPlugin(adjutantRoot, pkg.version));

  // Adjutant-project-specific checks (only when running inside the adjutant repo)
  const isAdjutantProject = fileExists(join(projectRoot, "package.json")) &&
    JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8")).name === "adjutant";
  if (isAdjutantProject) {
    results.push(...checkDependencies(projectRoot));
    results.push(checkDatabase());
  }

  // Quality-gate files (testing rules, code review, CI, etc.)
  results.push(...scaffoldQualityFiles(projectRoot, options.force));

  // adj-182.2.3: pin the Dolt port + install/load the supervisor (beads projects only).
  // Idempotent: same port, no-op restart on re-run. A missing `dolt` binary warns
  // (supervisor optional); only a verified-failure of an installed agent fails init.
  const doltSupervisor = await runRealInitDoltSupervisor(projectRoot);
  if (doltSupervisor) {
    results.push(doltSupervisor);
  }

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  if (hasFail) {
    printError("\nAdjutant init completed with errors.");
    return 1;
  }
  printSuccess("\nAdjutant init complete.");
  return 0;
}
