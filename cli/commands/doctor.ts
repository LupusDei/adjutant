/**
 * `adjutant doctor` — Check system health and prerequisites.
 *
 * Validates file existence, network health, tool availability,
 * and hook registration. Returns exit code 0 on all pass, 1 on any fail.
 */

import { printHeader, printCheck, printSummary, type CheckResult } from "../lib/output.js";

export async function runDoctor(): Promise<number> {
  printHeader("Adjutant Doctor");
  const results: CheckResult[] = [];

  // TODO: adj-013.3.1 - File/directory existence checks
  // TODO: adj-013.3.2 - Network checks (health, MCP SSE)
  // TODO: adj-013.3.3 - Tool availability checks
  // TODO: adj-013.3.4 - Hook registration check

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  return hasFail ? 1 : 0;
}
