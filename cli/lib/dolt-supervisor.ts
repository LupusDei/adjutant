/**
 * Dolt supervisor generators (adj-182, Phase 1 — T003a/b).
 *
 * Adjutant runs exactly one supervised Dolt SQL server per project, pinned to a
 * stable port (band 17000–17999). The supervisor (macOS launchd LaunchAgent, or
 * Linux `systemd --user` unit) restarts the server on crash and at load, so `bd`
 * never fails fast against a dead ephemeral port after sleep/crash/churn.
 *
 * The functions in this module are PURE: they render supervisor definition
 * strings from a {@link SupervisorSpec} and perform no I/O. Installing, loading,
 * and probing the server is a separate orchestration concern (installSupervisor,
 * adj-182.1.4) so the generators stay trivially unit-testable and platform-free.
 */

/**
 * Everything the supervisor needs to launch one Dolt SQL server.
 *
 * The server is always invoked as `dolt sql-server --config <configPath>`; the
 * pinned port lives inside that config file (written by the pin writer,
 * adj-182.1.2), so the supervisor definition itself is port-agnostic and stable
 * across re-pins.
 */
export interface SupervisorSpec {
  /** Reverse-DNS supervisor label, e.g. `com.adjutant.dolt.<projectId>`. */
  label: string;
  /** Absolute path to the `dolt` binary (e.g. `/usr/local/bin/dolt`). */
  doltBin: string;
  /** Absolute path to the Dolt server config YAML (`.beads/dolt/config.yaml`). */
  configPath: string;
  /** Working directory for the server process (the Dolt data dir). */
  workingDir: string;
  /** Absolute path that receives the server's stdout and stderr. */
  logPath: string;
}

/** The ordered argv for the supervised Dolt server. */
function programArguments(spec: SupervisorSpec): readonly string[] {
  return [spec.doltBin, "sql-server", "--config", spec.configPath];
}

/** Escape a value for inclusion in XML/plist text content. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render a macOS launchd LaunchAgent plist for the supervised Dolt server.
 *
 * The agent uses `KeepAlive { Crashed: true, SuccessfulExit: false }` so launchd
 * restarts the server when it crashes but honors a clean shutdown (e.g. a
 * deliberate cutover), and `RunAtLoad` so it starts as soon as the agent is
 * loaded / at login. The server is launched as
 * `dolt sql-server --config <configPath>` with stdout/stderr routed to logPath.
 *
 * Pure: no filesystem or process access.
 */
export function renderLaunchdPlist(spec: SupervisorSpec): string {
  const argsXml = programArguments(spec)
    .map((arg) => `      <string>${escapeXml(arg)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${escapeXml(spec.label)}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(spec.workingDir)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>Crashed</key>
      <true/>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(spec.logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(spec.logPath)}</string>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>
`;
}

/** Reverse-DNS supervisor label for a project's Dolt server. */
export function supervisorLabel(projectId: string): string {
  return `com.adjutant.dolt.${projectId}`;
}

/**
 * Render a Linux `systemd --user` unit equivalent of the launchd supervisor.
 *
 * `Restart=on-failure` mirrors launchd's `KeepAlive { Crashed: true,
 * SuccessfulExit: false }`: restart on a non-zero/crash exit, but not on a clean
 * shutdown. `WantedBy=default.target` mirrors `RunAtLoad` for a user unit (auto-
 * start on user-session login). stdout/stderr append to logPath.
 *
 * Pure: no filesystem or process access.
 */
export function renderSystemdUnit(spec: SupervisorSpec): string {
  const execStart = programArguments(spec).join(" ");

  return `[Unit]
Description=Adjutant supervised Dolt SQL server (${spec.label})
After=network.target

[Service]
Type=simple
WorkingDirectory=${spec.workingDir}
ExecStart=${execStart}
Restart=on-failure
RestartSec=2
StandardOutput=append:${spec.logPath}
StandardError=append:${spec.logPath}

[Install]
WantedBy=default.target
`;
}

// ── installSupervisor() orchestration (adj-182.1.4) ──────────────────────────
//
// Turns the pure generators + pin writer into an actually-installed, loaded,
// supervised Dolt server. ALL external effects (process exec, fs writes, the SQL
// health probe) are INJECTED as seams so this stays trivially unit-testable and
// never touches launchd, the filesystem, or the live server unless a real caller
// supplies real seams.

/** Result of a single injected exec invocation. */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command (the process seam). Resolves with its exit code + output. */
export type ExecFn = (cmd: string, args: readonly string[]) => Promise<ExecResult>;

/** Pin the port across metadata.json/config.yaml (the pin-writer seam — dolt-pin.ts). */
export type PinPortFn = (beadsDir: string, port: number) => string;

/** Write the rendered plist to disk (the fs seam). */
export type WritePlistFn = (path: string, contents: string) => void;

/** SQL health probe against the supervised server on the given port (NOT the PID — #2670). */
export type SqlProbeFn = (port: number) => Promise<boolean>;

/** Everything {@link installSupervisor} needs. External effects are injected seams. */
export interface InstallSupervisorOptions {
  /** Project UUID — used to derive the supervisor label. */
  projectId: string;
  /** Absolute path to the project's `.beads` directory. */
  beadsDir: string;
  /** The pinned Dolt port (reserved band 17000–17999). */
  port: number;
  /** Absolute path to the `dolt` binary. */
  doltBin: string;
  /** Absolute path the LaunchAgent plist is written to. */
  plistPath: string;
  /** Absolute path the server's stdout/stderr is routed to. */
  logPath: string;
  /** Caller uid for the per-user launchd `gui/<uid>` domain target. */
  uid: number;
  /** Process exec seam (launchctl). */
  exec: ExecFn;
  /** Port-pin seam (dolt-pin.ts `pinDoltPort`). */
  pinPort: PinPortFn;
  /** Plist-write seam. */
  writePlist: WritePlistFn;
  /** SQL health-probe seam. */
  sqlProbe: SqlProbeFn;
  /**
   * Probe retry budget — how many times to poll the SQL probe before giving up.
   * launchd starts the server asynchronously, so the first probe may race the
   * server's listen() call. Defaults to a handful of attempts.
   */
  probeAttempts?: number;
  /** Optional async sleep seam between probe attempts (injected for tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** Outcome of an install attempt. */
export interface InstallSupervisorResult {
  /** True iff the agent installed AND the server verified reachable. */
  ok: boolean;
  /** True iff the SQL probe confirmed the server is reachable on the pinned port. */
  verified: boolean;
  /** The supervisor label that was installed. */
  label: string;
  /** Whether the launchctl bootstrap exec returned success. */
  bootstrapped: boolean;
}

const DEFAULT_PROBE_ATTEMPTS = 10;

/** The `gui/<uid>` launchd domain target for a per-user LaunchAgent. */
function guiDomain(uid: number): string {
  return `gui/${uid}`;
}

/**
 * Install (or re-install, idempotently) the supervised Dolt LaunchAgent.
 *
 * Sequence (each step gated on the previous where order matters):
 *   1. Pin the port → metadata.json `dolt_server_port` + config.yaml `listener.port`.
 *      Setting `dolt_server_port` puts beads into externally-managed mode, so it
 *      connects to this supervised server instead of spawning/killing its own.
 *   2. Render + write the launchd plist.
 *   3. `launchctl bootout gui/<uid> <plistPath>` — best-effort tear-down of any
 *      previously-loaded instance. This is EXPECTED to fail on a first install
 *      ("No such process"); a non-zero bootout is ignored so the install is
 *      idempotent.
 *   4. `launchctl bootstrap gui/<uid> <plistPath>` — load the agent fresh. A hard
 *      failure here aborts the install (ok=false) and SKIPS verification.
 *   5. Poll the injected SQL probe against the PINNED PORT (never the PID — the
 *      #2670 fix) until it succeeds or the retry budget is exhausted.
 *
 * Pure orchestration over injected seams — no direct I/O of its own.
 */
export async function installSupervisor(
  opts: InstallSupervisorOptions,
): Promise<InstallSupervisorResult> {
  const label = supervisorLabel(opts.projectId);
  const domain = guiDomain(opts.uid);

  // 1. Pin the port (externally-managed mode) BEFORE loading the agent so the
  //    server reads the pinned config the moment launchd starts it.
  opts.pinPort(opts.beadsDir, opts.port);

  // 2. Render + write the plist.
  const spec: SupervisorSpec = {
    label,
    doltBin: opts.doltBin,
    configPath: `${opts.beadsDir}/dolt/config.yaml`,
    workingDir: `${opts.beadsDir}/dolt`,
    logPath: opts.logPath,
  };
  opts.writePlist(opts.plistPath, renderLaunchdPlist(spec));

  // 3. bootout (best-effort, idempotent) — ignore a non-zero "not loaded" result.
  await opts.exec("launchctl", ["bootout", domain, opts.plistPath]);

  // 4. bootstrap (load fresh). A hard failure aborts before verification.
  const bootstrap = await opts.exec("launchctl", ["bootstrap", domain, opts.plistPath]);
  const bootstrapped = bootstrap.code === 0;
  if (!bootstrapped) {
    return { ok: false, verified: false, label, bootstrapped: false };
  }

  // 5. Verify via the SQL probe on the pinned port, polling to tolerate launchd's
  //    asynchronous start.
  const attempts = opts.probeAttempts ?? DEFAULT_PROBE_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let verified = false;
  for (let i = 0; i < attempts; i++) {
    if (await opts.sqlProbe(opts.port)) {
      verified = true;
      break;
    }
    if (i < attempts - 1) {
      await sleep(250);
    }
  }

  return { ok: verified, verified, label, bootstrapped };
}

// ── doltLiveCutover() orchestration (adj-182.1.6) ────────────────────────────
//
// Migrates a RUNNING project from a self-managed, random-ephemeral-port Dolt
// server to the supervised, pinned-port server with NO data loss. Order is
// load-bearing; the cutover ABORTS (no circuit-clear, no backend restart) if the
// supervised server fails its SQL probe, leaving the old topology intact rather
// than pointing the backend at a dead server.
//
// ALL effects are injected seams. This function never stops/starts a real server,
// never restarts a real backend, and never touches real /tmp circuit files — the
// REAL cutover is a separate operator step (specs/.../runbook-cutover.md),
// coordinated with the operator. This is pure, tested orchestration.

/** Install seam — given supervisor options, install + verify, returning the result. */
export type InstallSeam = (opts: InstallSupervisorOptions) => Promise<InstallSupervisorResult>;

/** Everything {@link doltLiveCutover} needs. All external effects are seams. */
export interface DoltLiveCutoverOptions {
  /** Project UUID. */
  projectId: string;
  /** Absolute path to the project's `.beads` directory. */
  beadsDir: string;
  /** The pinned Dolt port to cut over to. */
  port: number;
  /** Pause/settle in-flight bd writes so nothing is lost across the swap. */
  quiesce: () => Promise<void>;
  /** Stop the self-managed (lazy) server bd previously spawned. */
  stopLazyServer: () => Promise<void>;
  /** Install + verify the supervised server (wraps {@link installSupervisor}). */
  install: InstallSeam;
  /** Delete stale `/tmp/beads-dolt-circuit-*.json` breaker files; returns the paths cleared. */
  clearCircuitFiles: () => Promise<string[]>;
  /** Trigger backend re-init against the pinned endpoint. */
  restartBackend: () => Promise<void>;
  /**
   * Supervisor install options passed through to {@link install}, minus the fields
   * derived here (projectId/beadsDir/port). When omitted, a minimal stub-friendly
   * object is built; real callers supply the full seam set.
   */
  installOptions?: Omit<InstallSupervisorOptions, "projectId" | "beadsDir" | "port">;
}

/** Outcome of a live cutover. */
export interface DoltLiveCutoverResult {
  /** True iff the cutover completed all steps (install verified). */
  ok: boolean;
  /** The supervisor install result (the abort gate). */
  install: InstallSupervisorResult;
  /** Circuit-breaker files cleared (empty when the cutover aborted before clearing). */
  clearedCircuitFiles: string[];
}

/**
 * Perform the live cutover. Enforced order:
 *   quiesce → stopLazy → install(+verify) → clearCircuit → restartBackend.
 *
 * If `install` does not verify (`ok === false`), the cutover ABORTS immediately
 * after install: circuit files are NOT cleared and the backend is NOT restarted.
 */
export async function doltLiveCutover(
  opts: DoltLiveCutoverOptions,
): Promise<DoltLiveCutoverResult> {
  // 1. Quiesce in-flight writes so nothing is lost across the swap.
  await opts.quiesce();

  // 2. Stop the lazy/self-managed server BEFORE starting the supervised one — two
  //    servers on one data-dir risk double-open corruption.
  await opts.stopLazyServer();

  // 3. Install + verify the supervised server on the pinned port.
  const installOptions = {
    ...(opts.installOptions ?? {}),
    projectId: opts.projectId,
    beadsDir: opts.beadsDir,
    port: opts.port,
  } as InstallSupervisorOptions;
  const install = await opts.install(installOptions);

  // SAFETY ABORT: if the supervised server did not verify, do NOT clear breaker
  // files and do NOT restart the backend. Leave the old topology in place.
  if (!install.ok) {
    return { ok: false, install, clearedCircuitFiles: [] };
  }

  // 4. Clear stale circuit-breaker files so bd/backend stop failing fast on the
  //    dead ephemeral port.
  const clearedCircuitFiles = await opts.clearCircuitFiles();

  // 5. Trigger backend re-init against the pinned endpoint (LAST).
  await opts.restartBackend();

  return { ok: true, install, clearedCircuitFiles };
}
