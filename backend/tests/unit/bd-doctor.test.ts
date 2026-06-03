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
});
