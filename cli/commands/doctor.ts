/**
 * `adjutant doctor` — Check system health and prerequisites.
 *
 * Validates file existence, network health, tool availability,
 * and hook registration. Returns exit code 0 on all pass, 1 on any fail.
 */

import { printHeader, printCheck, printSummary, type CheckResult } from "../lib/output.js";
import {
  fileExists,
  dirExists,
  mcpJsonValid,
  getAdjutantDbPath,
  getApiKeysPath,
  httpReachable,
  commandAvailable,
  adjutantHookRegistered,
  nodeVersionOk,
} from "../lib/checks.js";

/** adj-013.3.1: File/directory existence checks. */
function checkFiles(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];

  // .adjutant/PRIME.md
  results.push(
    fileExists(`${cwd}/.adjutant/PRIME.md`)
      ? { name: ".adjutant/PRIME.md", status: "pass" }
      : { name: ".adjutant/PRIME.md", status: "fail", message: "run adjutant init" },
  );

  // .mcp.json existence and adjutant entry
  const mcp = mcpJsonValid(cwd);
  if (!mcp.exists) {
    results.push({ name: ".mcp.json", status: "fail", message: "run adjutant init" });
  } else if (mcp.malformed) {
    results.push({ name: ".mcp.json", status: "fail", message: "invalid JSON — fix manually" });
  } else if (!mcp.hasAdjutant) {
    results.push({ name: ".mcp.json has adjutant", status: "fail", message: "run adjutant init" });
  } else {
    results.push({ name: ".mcp.json", status: "pass" });
    results.push({ name: ".mcp.json has adjutant", status: "pass" });
  }

  // SQLite database
  results.push(
    fileExists(getAdjutantDbPath())
      ? { name: "SQLite database", status: "pass" }
      : { name: "SQLite database", status: "warn", message: "start backend first" },
  );

  // Backend deps
  results.push(
    dirExists(`${cwd}/backend/node_modules`)
      ? { name: "Backend dependencies", status: "pass" }
      : { name: "Backend dependencies", status: "fail", message: "run npm run install:all" },
  );

  // Frontend deps
  results.push(
    dirExists(`${cwd}/frontend/node_modules`)
      ? { name: "Frontend dependencies", status: "pass" }
      : { name: "Frontend dependencies", status: "fail", message: "run npm run install:all" },
  );

  // Plugin skills
  results.push(
    fileExists(`${cwd}/skills/mcp-tools/SKILL.md`)
      ? { name: "Adjutant agent plugin", status: "pass" }
      : { name: "Adjutant agent plugin", status: "warn" },
  );

  // API keys
  results.push(
    fileExists(getApiKeysPath())
      ? { name: "API keys", status: "pass" }
      : { name: "API keys", status: "info", message: "open mode (no API keys)" },
  );

  return results;
}

/** adj-013.3.2: Network checks. */
async function checkNetwork(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Backend health
  const healthStatus = await httpReachable("http://localhost:4201/health");
  results.push(
    healthStatus !== null
      ? { name: "Backend health", status: "pass" }
      : { name: "Backend health", status: "fail", message: "run npm run dev" },
  );

  // MCP SSE endpoint (any response means reachable)
  const mcpStatus = await httpReachable("http://localhost:4201/mcp/sse");
  results.push(
    mcpStatus !== null
      ? { name: "MCP SSE endpoint", status: "pass" }
      : { name: "MCP SSE endpoint", status: "fail", message: "backend not serving MCP" },
  );

  return results;
}

/** adj-013.3.3: Tool availability checks. */
function checkTools(): CheckResult[] {
  const results: CheckResult[] = [];

  // Node.js version check
  const nodeCheck = nodeVersionOk();
  results.push(
    nodeCheck.ok
      ? { name: `Node.js (v${nodeCheck.version})`, status: "pass" }
      : { name: `Node.js (v${nodeCheck.version})`, status: "fail", message: "requires >= 20" },
  );

  // bd CLI
  results.push(
    commandAvailable("bd")
      ? { name: "bd CLI", status: "pass" }
      : { name: "bd CLI", status: "warn", message: "beads not available" },
  );

  return results;
}

/** adj-013.3.4: Hook registration check. */
function checkHooks(): CheckResult[] {
  return [
    adjutantHookRegistered()
      ? { name: "Claude hooks registered", status: "pass" }
      : { name: "Claude hooks registered", status: "warn", message: "run adjutant init" },
  ];
}

export async function runDoctor(): Promise<number> {
  printHeader("Adjutant Doctor");
  const cwd = process.cwd();
  const results: CheckResult[] = [];

  // adj-013.3.1 - File/directory existence checks
  results.push(...checkFiles(cwd));

  // adj-013.3.2 - Network checks (health, MCP SSE)
  results.push(...(await checkNetwork()));

  // adj-013.3.3 - Tool availability checks
  results.push(...checkTools());

  // adj-013.3.4 - Hook registration check
  results.push(...checkHooks());

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  return hasFail ? 1 : 0;
}
