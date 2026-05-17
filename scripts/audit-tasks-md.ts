#!/usr/bin/env tsx
/**
 * tasks.md TDD-shape auditor.
 *
 * Walks `specs/*\/tasks.md` and flags implementation tasks that lack the
 * test-first phrasing required by `.claude/rules/03-testing.md` ("Task
 * Structure in tasks.md (TDD-shaped)") and the epic-planner skill.
 *
 * WARN-ONLY: this script does NOT fail CI. It prints findings to stdout
 * and always exits 0. Existing specs predate the rule; backfill is
 * explicitly out of scope.
 *
 * Two acceptable shapes:
 *   A. Split task — Ta-tests + Tb-impl pair (e.g. T012a / T012b)
 *   B. Single task with explicit "write failing tests first" + "GREEN" phrasing
 *
 * Exemptions (skip lines containing the marker):
 *   - [setup]     scaffolding tasks
 *   - [docs]      documentation-only tasks
 *   - [scaffold]  empty file / directory creation
 *
 * Usage (from repo root):
 *   npx tsx scripts/audit-tasks-md.ts            # full report, all specs
 *   npx tsx scripts/audit-tasks-md.ts --quiet    # exit code only
 *   npx tsx scripts/audit-tasks-md.ts --json     # machine-readable output
 *
 * `tsx` lives in backend/node_modules — invoke via the project's npm scripts
 * or `npx --prefix backend tsx ../scripts/audit-tasks-md.ts` if not installed
 * at the repo root.
 */

/* eslint-disable no-console -- CLI script; stdout is the deliverable. */

import fs from "node:fs";
import path from "node:path";

const SPECS_ROOT = path.resolve(process.cwd(), "specs");

interface Finding {
  spec: string;
  file: string;
  lineNumber: number;
  line: string;
  reason: string;
}

interface AuditReport {
  scannedSpecs: number;
  scannedTasks: number;
  exemptTasks: number;
  flaggedTasks: number;
  findings: Finding[];
}

/**
 * Phrases that, if present in a task line, satisfy the test-first rule.
 * Case-insensitive matching. Any ONE present satisfies the "write tests
 * first" half; the GREEN phase is checked separately.
 */
const TEST_FIRST_PHRASES = [
  "failing tests first",
  "write failing tests",
  "write tests first",
  "red first",
  "tests before impl",
  "tests before implementation",
  "regression test first",
  "confirm red",
];

const GREEN_PHRASES = [
  "until green",
  "confirm green",
  "make tests pass",
  "make the tests pass",
  "make it green",
  "pass green",
  "green phase",
];

const EXEMPTION_MARKERS = ["[setup]", "[docs]", "[scaffold]"];

/**
 * Detects "Ta-style" task IDs that are part of a split pair (e.g. T012a).
 * The corresponding Tb partner is the impl; together they satisfy the rule.
 */
function extractTaskId(line: string): string | null {
  const match = line.match(/^\s*-\s*\[\s*[ x]?\s*\]\s+(T\d+[a-z]?)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function isTaskLine(line: string): boolean {
  return /^\s*-\s*\[\s*[ x]?\s*\]\s+T\d+/i.test(line);
}

function hasTestFirstPhrase(line: string): boolean {
  const lower = line.toLowerCase();
  return TEST_FIRST_PHRASES.some((p) => lower.includes(p));
}

function hasGreenPhrase(line: string): boolean {
  const lower = line.toLowerCase();
  return GREEN_PHRASES.some((p) => lower.includes(p));
}

function isExempt(line: string): boolean {
  const lower = line.toLowerCase();
  return EXEMPTION_MARKERS.some((m) => lower.includes(m));
}

/**
 * Pairs of split tasks: T012a (tests) + T012b (impl).
 * Returns the set of base IDs whose `a`-half exists in the same file.
 */
function collectSplitPairs(lines: string[]): Set<string> {
  const aIds = new Set<string>();
  const bIds = new Set<string>();
  const pairs = new Set<string>();
  for (const line of lines) {
    const id = extractTaskId(line);
    if (!id) continue;
    const match = id.match(/^(T\d+)([A-Z])$/);
    if (!match) continue;
    if (match[2] === "A") aIds.add(match[1]);
    if (match[2] === "B") bIds.add(match[1]);
  }
  for (const base of aIds) {
    if (bIds.has(base)) pairs.add(base);
  }
  return pairs;
}

function auditFile(specName: string, filePath: string): {
  findings: Finding[];
  scanned: number;
  exempt: number;
} {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const splitPairs = collectSplitPairs(lines);
  const findings: Finding[] = [];
  let scanned = 0;
  let exempt = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isTaskLine(line)) continue;
    scanned++;

    if (isExempt(line)) {
      exempt++;
      continue;
    }

    const id = extractTaskId(line);
    if (id) {
      // Shape A: split pair — Ta and Tb together satisfy the rule.
      const splitMatch = id.match(/^(T\d+)([A-Z])$/);
      if (splitMatch && splitPairs.has(splitMatch[1])) {
        // The line is part of a known Ta/Tb pair — accept.
        continue;
      }
    }

    // Shape B: single task — must contain BOTH test-first AND GREEN phrasing.
    const hasTestFirst = hasTestFirstPhrase(line);
    const hasGreen = hasGreenPhrase(line);

    if (hasTestFirst && hasGreen) continue;

    const missing: string[] = [];
    if (!hasTestFirst) missing.push("test-first phrase");
    if (!hasGreen) missing.push("GREEN phase phrase");

    findings.push({
      spec: specName,
      file: filePath,
      lineNumber: i + 1,
      line: line.trim(),
      reason: `missing ${missing.join(" + ")}`,
    });
  }

  return { findings, scanned, exempt };
}

function findSpecs(root: string): Array<{ name: string; tasksFile: string }> {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const result: Array<{ name: string; tasksFile: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const tasksPath = path.join(root, entry.name, "tasks.md");
    if (fs.existsSync(tasksPath)) {
      result.push({ name: entry.name, tasksFile: tasksPath });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const quiet = args.has("--quiet");
  const asJson = args.has("--json");

  const specs = findSpecs(SPECS_ROOT);
  const report: AuditReport = {
    scannedSpecs: 0,
    scannedTasks: 0,
    exemptTasks: 0,
    flaggedTasks: 0,
    findings: [],
  };

  for (const spec of specs) {
    const result = auditFile(spec.name, spec.tasksFile);
    report.scannedSpecs++;
    report.scannedTasks += result.scanned;
    report.exemptTasks += result.exempt;
    report.flaggedTasks += result.findings.length;
    report.findings.push(...result.findings);
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (quiet) {
    // exit 0 always (warn-only)
    return;
  }

  console.log(`tasks.md TDD-shape audit — ${new Date().toISOString().slice(0, 10)}`);
  console.log("");
  console.log(`Scanned ${report.scannedSpecs} specs, ${report.scannedTasks} task lines.`);
  console.log(`Exempt:  ${report.exemptTasks} ([setup] / [docs] / [scaffold])`);
  console.log(`Flagged: ${report.flaggedTasks}`);
  console.log("");

  if (report.flaggedTasks === 0) {
    console.log("All scanned tasks satisfy the TDD-shape rule.");
    return;
  }

  console.log("Findings (warn-only — does NOT fail CI):");
  console.log("");
  const bySpec = new Map<string, Finding[]>();
  for (const f of report.findings) {
    if (!bySpec.has(f.spec)) bySpec.set(f.spec, []);
    bySpec.get(f.spec)!.push(f);
  }
  for (const [spec, findings] of bySpec) {
    console.log(`  ${spec}/tasks.md  (${findings.length} flagged)`);
    for (const f of findings) {
      console.log(`    L${f.lineNumber}: ${f.reason}`);
      console.log(`      > ${f.line}`);
    }
    console.log("");
  }

  console.log(
    "See .claude/rules/03-testing.md → 'Task Structure in tasks.md (TDD-shaped)' for the rule.",
  );
  console.log("Backfill of pre-rule tasks is out of scope — this is warn-only.");
}

main();
