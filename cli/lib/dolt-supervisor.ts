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
