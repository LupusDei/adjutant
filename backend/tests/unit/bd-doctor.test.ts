import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  accessSync,
  constants,
} from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';

const SOURCE_SCRIPT = resolve(__dirname, '../../../scripts/bd-doctor.sh');

/**
 * bd-doctor.sh is the adj-zrr1c recovery tool: it diagnoses + auto-repairs the
 * stale `.beads/dolt-server.{port,pid}` files that leave `bd` CLI talking to a
 * dead/wrong dolt server ("circuit breaker open").
 *
 * The real script discovers the live dolt server via `ps`/`lsof` and probes the
 * `bd` CLI. Those are external dependencies (per the testing rules, external deps
 * are mocked), so the script exposes test seams used ONLY by this suite:
 *   - BD_DOCTOR_DOLT_OVERRIDE="<pid> <port> <cwd>"  → inject discovered dolt
 *   - BD_DOCTOR_INITIAL_BD_OK=0|1                   → force the initial bd health gate
 *   - BD_DOCTOR_SKIP_BD_VERIFY=1                    → skip the post-repair `bd list`
 * Production runs set none, so behavior is unchanged in the field.
 *
 * Repair/diagnose scenarios pass BD_DOCTOR_INITIAL_BD_OK=0 to simulate a broken
 * bd (otherwise the doctor short-circuits to "healthy" before doing anything).
 */
const BROKEN = { BD_DOCTOR_INITIAL_BD_OK: '0', BD_DOCTOR_SKIP_BD_VERIFY: '1' };
describe('bd-doctor.sh', () => {
  let tmp: string;
  let scriptPath: string;
  let beadsDir: string;

  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [scriptPath, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });

  const writePortPid = (port: string, pid: string) => {
    writeFileSync(join(beadsDir, 'dolt-server.port'), port);
    writeFileSync(join(beadsDir, 'dolt-server.pid'), pid);
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bd-doctor-'));
    const scriptsDir = join(tmp, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    scriptPath = join(scriptsDir, 'bd-doctor.sh');
    copyFileSync(SOURCE_SCRIPT, scriptPath);
    chmodSync(scriptPath, 0o755);
    beadsDir = join(tmp, '.beads');
    mkdirSync(beadsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── Static / structural guards ────────────────────────────────────────────
  it('should exist and be executable', () => {
    accessSync(SOURCE_SCRIPT, constants.F_OK);
    accessSync(SOURCE_SCRIPT, constants.X_OK);
  });

  it('should print usage and exit 0 for --help', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/bd-doctor/i);
  });

  it('should reject an unknown argument with exit 2', () => {
    const r = run(['--bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown arg/i);
  });

  it('should fail clearly when there is no .beads directory', () => {
    rmSync(beadsDir, { recursive: true, force: true });
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/no \.beads/i);
  });

  // ── Core regression: stale port/pid auto-repair (adj-zrr1c) ───────────────
  it('should report healthy and touch nothing when bd already works', () => {
    // Even with stale files, if bd actually responds (e.g. embedded mode) the
    // doctor must NOT cry wolf — it short-circuits to healthy and repairs nothing.
    writePortPid('11111', '99999');
    const r = run([], { BD_DOCTOR_INITIAL_BD_OK: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/healthy/i);
    // Stale files left untouched — bd works, so there's nothing to fix.
    expect(readFileSync(join(beadsDir, 'dolt-server.port'), 'utf-8').trim()).toBe('11111');
    expect(readFileSync(join(beadsDir, 'dolt-server.pid'), 'utf-8').trim()).toBe('99999');
  });

  it('should repair stale port/pid files to match the live dolt server', () => {
    // Stale files point at a dead process / wrong port.
    writePortPid('11111', '99999');
    // Inject a live adjutant dolt: pid 54321 on port 22222 with cwd under .beads.
    const r = run([], { ...BROKEN, BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 ${beadsDir}` });
    expect(r.status).toBe(0);
    expect(readFileSync(join(beadsDir, 'dolt-server.port'), 'utf-8').trim()).toBe('22222');
    expect(readFileSync(join(beadsDir, 'dolt-server.pid'), 'utf-8').trim()).toBe('54321');
  });

  it('should be a no-op when port/pid files already match reality', () => {
    writePortPid('22222', '54321');
    const r = run([], { ...BROKEN, BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 ${beadsDir}` });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/nothing to fix/i);
    // Files unchanged.
    expect(readFileSync(join(beadsDir, 'dolt-server.port'), 'utf-8').trim()).toBe('22222');
    expect(readFileSync(join(beadsDir, 'dolt-server.pid'), 'utf-8').trim()).toBe('54321');
  });

  it('should detect stale files but NOT modify them under --check', () => {
    writePortPid('11111', '99999');
    const r = run(['--check'], { ...BROKEN, BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 ${beadsDir}` });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/stale/i);
    // Diagnose-only: files must be untouched.
    expect(readFileSync(join(beadsDir, 'dolt-server.port'), 'utf-8').trim()).toBe('11111');
    expect(readFileSync(join(beadsDir, 'dolt-server.pid'), 'utf-8').trim()).toBe('99999');
  });

  it('should report no adjutant dolt server when none serves the .beads dir', () => {
    writePortPid('11111', '99999');
    // Override points at a dolt whose cwd is NOT under this .beads dir.
    const r = run([], { ...BROKEN, BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 /some/other/project/.beads` });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/no dolt server is serving the adjutant database/i);
  });

  it('should auto-restart and report success when --restart recovers bd', () => {
    writePortPid('11111', '99999');
    const r = run(['--restart'], {
      BD_DOCTOR_INITIAL_BD_OK: '0', // bd broken initially
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 /some/other/project/.beads`, // no adjutant dolt
      BD_DOCTOR_RESTART_CMD: 'true', // stub the restart so no real dolt is spawned
      BD_DOCTOR_SKIP_BD_VERIFY: '1', // post-restart probe succeeds
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/restart succeeded/i);
  });

  it('should exit 1 when the --restart command itself fails', () => {
    writePortPid('11111', '99999');
    const r = run(['--restart'], {
      BD_DOCTOR_INITIAL_BD_OK: '0',
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 /some/other/project/.beads`,
      BD_DOCTOR_RESTART_CMD: 'false', // simulate a failing restart
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/restart command failed/i);
  });

  // ── adj-182.1.5: externally-managed kickstart restart + rogue-dolt kill ─────
  //
  // Under externally-managed mode (`.beads/metadata.json` carries `dolt_server_port`),
  // beads connects to a launchd-supervised server and NEVER spawns/kills it. So the
  // doctor's `--restart` must NOT run `bd dolt start` (which would race the supervisor
  // and risk a second server on one data-dir). Instead it must kickstart the launchd
  // agent: `launchctl kickstart -k gui/<uid>/com.adjutant.dolt.<projectId>`.
  //
  // New test seams (production-inert; unset in the field):
  //   - BD_DOCTOR_LAUNCHCTL    → substitutes the `launchctl` binary (tests use `echo`)
  //   - BD_DOCTOR_KILL         → substitutes the `kill` binary (tests use `echo`)
  //   - BD_DOCTOR_SUPERVISED_PID → the legitimate launchd-supervised dolt PID; any
  //                                cwd-under-.beads dolt with a different PID is rogue
  //   - BD_DOCTOR_DOLT_OVERRIDE now accepts MULTIPLE `;`-separated "<pid> <port> <cwd>"
  //                                entries so a supervised + a rogue dolt can coexist
  const writeMetadata = (obj: Record<string, unknown>) => {
    writeFileSync(join(beadsDir, 'metadata.json'), JSON.stringify(obj, null, 2));
  };

  it('should kickstart the launchd agent (NOT bd dolt start) under externally-managed --restart', () => {
    // Externally-managed: metadata.json carries dolt_server_port + project_id.
    writeMetadata({ project_id: 'proj-uuid-abc', dolt_server_port: 17042 });
    writePortPid('11111', '99999');
    const r = run(['--restart'], {
      BD_DOCTOR_INITIAL_BD_OK: '0', // bd broken initially
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 /some/other/project/.beads`, // no adjutant dolt found
      BD_DOCTOR_LAUNCHCTL: 'echo LAUNCHCTL', // capture instead of executing
      BD_DOCTOR_SKIP_BD_VERIFY: '1', // post-restart probe succeeds
    });
    expect(r.status).toBe(0);
    // The chosen restart command is a launchctl kickstart -k against the project label,
    // NOT `bd dolt start`.
    expect(r.stdout).toMatch(/LAUNCHCTL kickstart -k gui\/\d+\/com\.adjutant\.dolt\.proj-uuid-abc/);
    expect(r.stdout).not.toMatch(/bd dolt start/);
    expect(r.stdout).toMatch(/restart succeeded/i);
  });

  it('should fall back to bd dolt start when NOT externally-managed (no dolt_server_port)', () => {
    // metadata.json absent (or lacking dolt_server_port) → legacy self-managed mode.
    // No RESTART_CMD override here: this proves the script COMPUTES `bd dolt start`
    // (via the BD_DOCTOR_BD binary seam) rather than the launchctl kickstart path.
    writePortPid('11111', '99999');
    const r = run(['--restart'], {
      BD_DOCTOR_INITIAL_BD_OK: '0',
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 /some/other/project/.beads`,
      BD_DOCTOR_LAUNCHCTL: 'echo LAUNCHCTL', // must NOT be invoked
      BD_DOCTOR_BD: 'echo BD_BIN', // substitute the `bd` binary so no real dolt spawns
      BD_DOCTOR_SKIP_BD_VERIFY: '1',
    });
    expect(r.status).toBe(0);
    // The chosen recovery command is `bd dolt start`, not a launchctl kickstart.
    expect(r.stdout).toMatch(/BD_BIN dolt start/);
    expect(r.stdout).not.toMatch(/LAUNCHCTL kickstart/);
  });

  it('should detect and kill a rogue dolt whose cwd is under .beads but is not the supervised PID', () => {
    // Externally-managed. Supervised PID is 54321 (the launchd instance). A SECOND dolt
    // (pid 88888) has cwd under THIS .beads data-dir — a rogue orphan holding breaker-open
    // state and risking data-dir double-open corruption → must be killed.
    writeMetadata({ project_id: 'proj-uuid-abc', dolt_server_port: 17042 });
    writePortPid('11111', '99999');
    const r = run([], {
      ...BROKEN,
      // Two cwd-under-.beads dolts: 54321 (supervised) and 88888 (rogue).
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 ${beadsDir};88888 33333 ${beadsDir}`,
      BD_DOCTOR_SUPERVISED_PID: '54321',
      BD_DOCTOR_KILL: 'echo KILLED', // capture the kill target instead of signalling
    });
    // The rogue PID (88888) is targeted for kill; the supervised PID (54321) is NOT.
    expect(r.stdout).toMatch(/KILLED 88888/);
    expect(r.stdout).not.toMatch(/KILLED 54321/);
    expect(r.stdout).toMatch(/rogue/i);
  });

  it('should NOT kill any dolt when the only cwd-under-.beads dolt is the supervised PID', () => {
    // Single supervised dolt under .beads, matching the supervised PID → no rogue, no kill.
    writeMetadata({ project_id: 'proj-uuid-abc', dolt_server_port: 17042 });
    writePortPid('22222', '54321');
    const r = run([], {
      ...BROKEN,
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 ${beadsDir}`,
      BD_DOCTOR_SUPERVISED_PID: '54321',
      BD_DOCTOR_KILL: 'echo KILLED', // must NOT fire
    });
    expect(r.stdout).not.toMatch(/KILLED/);
  });

  it('should not treat a cwd-under-.beads dolt as rogue when no supervised PID is known', () => {
    // Without a known supervised PID (e.g. not externally-managed / launchd not loaded),
    // the doctor must NOT guess and kill — killing the wrong process is worse than a stale
    // file. Only an explicitly-identified non-supervised PID is a kill target.
    writePortPid('22222', '54321');
    const r = run([], {
      ...BROKEN,
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 ${beadsDir}`,
      BD_DOCTOR_KILL: 'echo KILLED', // must NOT fire (no supervised PID seam set)
    });
    expect(r.stdout).not.toMatch(/KILLED/);
  });

  // ── adj-182.1.5.1: rogue-kill cwd match must be a path BOUNDARY, not a glob prefix ──
  //
  // The classify_dolt cwd test used `[[ "$_cwd" == "$BD_DIR"* ]]`, a glob PREFIX match.
  // A SIBLING directory that merely shares the .beads prefix (`<BD_DIR>-backup`,
  // `<BD_DIR>2`, `<BD_DIR>.bak`) is NOT under our data-dir, yet the prefix match
  // claimed it — so a *different* project's healthy dolt got classified rogue and
  // KILLED. That is the exact "server appears down" outage adj-182 fixes, inverted.
  // The fix is a path-boundary match: `$_cwd == $BD_DIR || $_cwd == $BD_DIR/*`.
  it('should NOT classify/kill a sibling-dir dolt that merely shares the .beads prefix (.beads-backup)', () => {
    // Externally-managed with a known supervised PID, so the rogue path is ARMED.
    writeMetadata({ project_id: 'proj-uuid-abc', dolt_server_port: 17042 });
    writePortPid('22222', '54321');
    // The injected dolt's cwd is a SIBLING dir sharing the prefix — a DIFFERENT project.
    const siblingCwd = `${beadsDir}-backup`;
    const r = run([], {
      ...BROKEN,
      BD_DOCTOR_DOLT_OVERRIDE: `88888 33333 ${siblingCwd}`,
      BD_DOCTOR_SUPERVISED_PID: '54321',
      BD_DOCTOR_KILL: 'echo KILLED', // must NOT fire — sibling is not under our data-dir
    });
    // The sibling-dir dolt is another project's server: never killed, never flagged rogue.
    expect(r.stdout).not.toMatch(/KILLED/);
    expect(r.stdout).not.toMatch(/rogue/i);
  });

  it('should still classify/kill a rogue dolt whose cwd is a subdir of .beads (<BD_DIR>/dolt)', () => {
    // Boundary match must still catch a TRUE child path (cwd = <BD_DIR>/dolt). dolt
    // commonly chdirs into its data-dir subdir, so this is the realistic rogue shape.
    writeMetadata({ project_id: 'proj-uuid-abc', dolt_server_port: 17042 });
    writePortPid('22222', '54321');
    const r = run([], {
      ...BROKEN,
      BD_DOCTOR_DOLT_OVERRIDE: `88888 33333 ${join(beadsDir, 'dolt')}`,
      BD_DOCTOR_SUPERVISED_PID: '54321',
      BD_DOCTOR_KILL: 'echo KILLED',
    });
    expect(r.stdout).toMatch(/KILLED 88888/);
    expect(r.stdout).toMatch(/rogue/i);
  });

  // ── adj-182.1.review.2: guard empty PROJECT_ID before building the kickstart label ──
  //
  // When metadata.json carries `dolt_server_port` but NO `project_id`, the script is in
  // externally-managed mode yet has no id to build `com.adjutant.dolt.<projectId>`. The
  // old code emitted `...com.adjutant.dolt.` (trailing dot, no id) and ran a launchctl
  // kickstart that fails with a confusing runtime error. The doctor must instead refuse:
  // print a clear diagnosis and exit non-zero BEFORE invoking launchctl.
  it('should refuse (clear error, no launchctl) under --restart when externally-managed but project_id is missing', () => {
    // Externally-managed (has dolt_server_port) but project_id ABSENT → cannot derive label.
    writeMetadata({ dolt_server_port: 17042 });
    writePortPid('11111', '99999');
    const r = run(['--restart'], {
      BD_DOCTOR_INITIAL_BD_OK: '0', // bd broken initially
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 /some/other/project/.beads`, // no adjutant dolt found
      BD_DOCTOR_LAUNCHCTL: 'echo LAUNCHCTL', // must NOT be invoked
      BD_DOCTOR_SKIP_BD_VERIFY: '1',
    });
    expect(r.status).not.toBe(0);
    // Clear diagnosis mentioning the missing project_id — not a raw launchctl failure.
    expect(r.stdout + r.stderr).toMatch(/project_id/i);
    // The malformed kickstart must never run, and no trailing-dot label leaks out.
    expect(r.stdout).not.toMatch(/LAUNCHCTL kickstart/);
    expect(r.stdout + r.stderr).not.toMatch(/com\.adjutant\.dolt\.(\s|$)/m);
  });

  it('should still classify a dolt whose cwd is EXACTLY .beads as the adjutant server (boundary equal case)', () => {
    // The exact-equal case (`cwd == BD_DIR`) is the supervised server itself: it must
    // be recognized as the adjutant dolt (and its port/pid trusted), not skipped by the
    // boundary match. Here pid matches the supervised PID → recognized, not rogue.
    writeMetadata({ project_id: 'proj-uuid-abc', dolt_server_port: 17042 });
    writePortPid('11111', '99999'); // stale → forces repair so we see the recognized server
    const r = run([], {
      ...BROKEN,
      BD_DOCTOR_DOLT_OVERRIDE: `54321 22222 ${beadsDir}`,
      BD_DOCTOR_SUPERVISED_PID: '54321',
      BD_DOCTOR_KILL: 'echo KILLED', // must NOT fire — this IS the supervised server
    });
    expect(r.stdout).not.toMatch(/KILLED/);
    // Recognized as the live adjutant dolt → stale files repaired to its port/pid.
    expect(readFileSync(join(beadsDir, 'dolt-server.port'), 'utf-8').trim()).toBe('22222');
    expect(readFileSync(join(beadsDir, 'dolt-server.pid'), 'utf-8').trim()).toBe('54321');
  });
});
