/**
 * Terminal output formatting for the Adjutant CLI.
 *
 * Provides colored PASS/FAIL/WARN/INFO/SKIP indicators
 * and a summary table formatter.
 */

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

export type CheckStatus = "pass" | "fail" | "warn" | "info" | "skip" | "created" | "skipped";

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: `${COLORS.green}PASS${COLORS.reset}`,
  fail: `${COLORS.red}FAIL${COLORS.reset}`,
  warn: `${COLORS.yellow}WARN${COLORS.reset}`,
  info: `${COLORS.blue}INFO${COLORS.reset}`,
  skip: `${COLORS.gray}SKIP${COLORS.reset}`,
  created: `${COLORS.green}CREATED${COLORS.reset}`,
  skipped: `${COLORS.gray}SKIPPED${COLORS.reset}`,
};

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message?: string;
}

export function printCheck(result: CheckResult): void {
  const label = STATUS_LABELS[result.status];
  const msg = result.message ? `  ${COLORS.dim}${result.message}${COLORS.reset}` : "";
  console.log(`  [${label}] ${result.name}${msg}`);
}

export function printHeader(text: string): void {
  console.log(`\n${COLORS.bold}${COLORS.cyan}${text}${COLORS.reset}`);
}

export function printSummary(results: CheckResult[]): void {
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  console.log(`\n${COLORS.bold}Summary${COLORS.reset}`);
  const parts: string[] = [];
  if (counts["pass"] ?? counts["created"]) {
    parts.push(`${COLORS.green}${(counts["pass"] ?? 0) + (counts["created"] ?? 0)} passed${COLORS.reset}`);
  }
  if (counts["fail"]) {
    parts.push(`${COLORS.red}${counts["fail"]} failed${COLORS.reset}`);
  }
  if (counts["warn"]) {
    parts.push(`${COLORS.yellow}${counts["warn"]} warnings${COLORS.reset}`);
  }
  if (counts["info"]) {
    parts.push(`${COLORS.blue}${counts["info"]} info${COLORS.reset}`);
  }
  if (counts["skip"] ?? counts["skipped"]) {
    parts.push(`${COLORS.gray}${(counts["skip"] ?? 0) + (counts["skipped"] ?? 0)} skipped${COLORS.reset}`);
  }
  console.log(`  ${parts.join(", ")}`);
}

export function printSuccess(message: string): void {
  console.log(`${COLORS.green}${message}${COLORS.reset}`);
}

export function printError(message: string): void {
  console.log(`${COLORS.red}${message}${COLORS.reset}`);
}
