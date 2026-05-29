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
});
