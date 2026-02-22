/**
 * `adjutant init` — Bootstrap a fresh Adjutant installation.
 *
 * Creates .adjutant/PRIME.md, .mcp.json, registers Claude Code hooks,
 * checks dependencies, and initializes the SQLite database.
 *
 * Idempotent: safe to run multiple times.
 */

import { printHeader, printCheck, printSummary, printSuccess, type CheckResult } from "../lib/output.js";

interface InitOptions {
  force: boolean;
}

export async function runInit(_options: InitOptions): Promise<void> {
  printHeader("Adjutant Init");
  const results: CheckResult[] = [];

  // TODO: adj-013.2.2 - .adjutant/ dir + PRIME.md creation
  // TODO: adj-013.2.3 - .mcp.json creation/validation
  // TODO: adj-013.2.4 - Claude Code hook registration
  // TODO: adj-013.2.5 - Dependency installation check
  // TODO: adj-013.2.6 - SQLite database init check

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);
  printSuccess("\nAdjutant init complete.");
}
