import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync, constants } from 'fs';
import { resolve } from 'path';

const SCRIPT_PATH = resolve(__dirname, '../../../scripts/verify-before-push.sh');

describe('verify-before-push.sh', () => {
  let scriptContent: string;

  it('should exist and be executable', () => {
    // File must exist
    accessSync(SCRIPT_PATH, constants.F_OK);
    // File must be executable
    accessSync(SCRIPT_PATH, constants.X_OK);
  });

  it('should use strict bash mode (set -euo pipefail)', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(scriptContent).toContain('set -euo pipefail');
  });

  it('should start with bash shebang', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(scriptContent.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('should bypass verification for wip/* branches', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(scriptContent).toContain('wip/*');
    expect(scriptContent).toMatch(/WIP branch.*skip/i);
  });

  it('should cd to monorepo root before doing anything else', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(scriptContent).toContain('git rev-parse --show-toplevel');
    // The root guard must appear before the branch detection
    const rootGuardPos = scriptContent.indexOf('--show-toplevel');
    const branchDetectPos = scriptContent.indexOf('--abbrev-ref HEAD');
    expect(rootGuardPos).toBeLessThan(branchDetectPos);
  });

  it('should detect current branch using git rev-parse', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(scriptContent).toContain('git rev-parse --abbrev-ref HEAD');
  });

  it('should run lint', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(scriptContent).toContain('npm run lint');
  });

  it('should run tests with vitest --changed for speed, with full suite fallback', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(scriptContent).toContain('vitest run --changed');
    // Should fall back to full suite if --changed fails
    expect(scriptContent).toContain('vitest run');
  });

  it('should run both backend and frontend tests', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(scriptContent).toContain('cd backend');
    expect(scriptContent).toContain('cd ../frontend');
  });

  it('should run the heavy steps (lint + tests) at lowered priority (nice) so concurrent agent runs do not grind the machine', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    // Lint (eslint with type-aware rules) is niced.
    expect(scriptContent).toMatch(/nice -n \d+ npm run lint/);
    // Every vitest invocation is niced.
    const vitestCalls = scriptContent.match(/(\S+ )*npx vitest run/g) ?? [];
    expect(vitestCalls.length).toBeGreaterThan(0);
    for (const call of vitestCalls) {
      expect(call).toMatch(/nice -n \d+ npx vitest run/);
    }
  });

  it('should have numbered step labels for clear failure reporting', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    // The script gained a dedicated Typecheck step (adj-181.3.8), so it is now 4 steps:
    // Lint, Typecheck, Backend tests, Frontend tests. Labels must stay consistent.
    expect(scriptContent).toContain('Step 1/4');
    expect(scriptContent).toContain('Step 2/4');
    expect(scriptContent).toContain('Step 3/4');
    expect(scriptContent).toContain('Step 4/4');
  });

  it('should not suppress stderr on any verification command', () => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
    // Intent: never hide failures of the verification STEPS (lint/typecheck/tests).
    // A benign `2>/dev/null` on the optional `.tsc-baseline` config read is allowed —
    // it has a `|| echo 0` fallback and runs no verification. Assert no other line
    // suppresses stderr.
    const offending = scriptContent
      .split('\n')
      .filter((l) => l.includes('2>/dev/null') && !l.includes('.tsc-baseline'));
    expect(offending).toEqual([]);
  });
});

describe('ci.yml', () => {
  const CI_PATH = resolve(__dirname, '../../../.github/workflows/ci.yml');
  let ciContent: string;

  it('should exist', () => {
    accessSync(CI_PATH, constants.F_OK);
    ciContent = readFileSync(CI_PATH, 'utf-8');
  });

  it('should NOT have continue-on-error on lint steps', () => {
    ciContent = readFileSync(CI_PATH, 'utf-8');
    const lines = ciContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Lint backend') || lines[i].includes('Lint frontend')) {
        // Check the next few lines for continue-on-error
        const block = lines.slice(i, i + 4).join('\n');
        expect(block).not.toContain('continue-on-error');
      }
    }
  });

  it('should have backend test step', () => {
    ciContent = readFileSync(CI_PATH, 'utf-8');
    expect(ciContent).toContain('Run backend tests');
    expect(ciContent).toMatch(/cd backend && npm test/);
  });

  it('should have frontend test step', () => {
    ciContent = readFileSync(CI_PATH, 'utf-8');
    expect(ciContent).toContain('Run frontend tests');
    expect(ciContent).toMatch(/cd frontend && npm test/);
  });

  it('should have coverage steps', () => {
    ciContent = readFileSync(CI_PATH, 'utf-8');
    expect(ciContent).toContain('Backend coverage');
    expect(ciContent).toContain('Frontend coverage');
    expect(ciContent).toContain('test:coverage');
  });

  it('should upload coverage artifacts', () => {
    ciContent = readFileSync(CI_PATH, 'utf-8');
    expect(ciContent).toContain('upload-artifact@v4');
    expect(ciContent).toContain('coverage-reports');
  });

  it('should have correct step ordering: build before lint before tests before coverage', () => {
    ciContent = readFileSync(CI_PATH, 'utf-8');
    const buildPos = ciContent.indexOf('Build backend');
    const lintPos = ciContent.indexOf('Lint backend');
    const testPos = ciContent.indexOf('Run backend tests');
    const coveragePos = ciContent.indexOf('Backend coverage');

    expect(buildPos).toBeLessThan(lintPos);
    expect(lintPos).toBeLessThan(testPos);
    expect(testPos).toBeLessThan(coveragePos);
  });
});
