/**
 * `adjutant doctor` — Check system health and prerequisites.
 *
 * Validates file existence, network health, tool availability,
 * and plugin registration. Returns exit code 0 on all pass, 1 on any fail.
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";

import { join } from "path";

import { printHeader, printCheck, printSummary, type CheckResult } from "../lib/output.js";
import {
  fileExists,
  dirExists,
  mcpJsonValid,
  getAdjutantDbPath,
  getApiKeysPath,
  httpReachable,
  commandAvailable,
  nodeVersionOk,
  parseJsonFile,
  getClaudeSettingsPath,
  type ClaudeSettings,
} from "../lib/checks.js";
import { PLUGIN_KEY, LEGACY_HOOK_COMMANDS } from "../lib/plugin.js";
import { getQualityFilePaths, QUALITY_FILES, loadTemplate } from "../lib/quality-templates.js";

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

  // Plugin health checks
  results.push(...checkPlugin());

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

  // MCP Streamable HTTP endpoint (POST returns a response means reachable)
  const mcpStatus = await httpReachable("http://localhost:4201/mcp");
  results.push(
    mcpStatus !== null
      ? { name: "MCP endpoint", status: "pass" }
      : { name: "MCP endpoint", status: "fail", message: "backend not serving MCP" },
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

/** Check plugin installation via claude CLI. */
function checkPlugin(): CheckResult[] {
  const results: CheckResult[] = [];

  if (!commandAvailable("claude")) {
    results.push({ name: "Adjutant plugin", status: "warn", message: "claude CLI not found" });
    return results;
  }

  // Check if plugin is installed and enabled via claude plugin list
  try {
    const output = execSync("claude plugin list", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
      encoding: "utf-8",
    });
    if (output.includes(PLUGIN_KEY) || output.includes("adjutant-agent")) {
      results.push({ name: "Adjutant plugin", status: "pass" });
    } else {
      results.push({ name: "Adjutant plugin", status: "fail", message: "run adjutant init" });
    }
  } catch {
    results.push({ name: "Adjutant plugin", status: "fail", message: "claude plugin list failed" });
  }

  // Check for stale legacy hooks
  const settings = parseJsonFile<ClaudeSettings>(getClaudeSettingsPath());
  let hasLegacy = false;
  if (settings?.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      const matchers = settings.hooks[event];
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        if (matcher.hooks?.some((h: { command: string }) => LEGACY_HOOK_COMMANDS.includes(h.command))) {
          hasLegacy = true;
          break;
        }
      }
      if (hasLegacy) break;
    }
  }
  results.push(
    hasLegacy
      ? { name: "No stale legacy hooks", status: "warn", message: "run adjutant init to clean up" }
      : { name: "No stale legacy hooks", status: "pass" },
  );

  return results;
}

/** Check presence and freshness of quality gate files (testing rules, CI config, etc.). */
export function checkQualityFiles(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  for (const qf of QUALITY_FILES) {
    const fullPath = join(cwd, qf.destPath);
    if (!fileExists(fullPath)) {
      results.push({ name: qf.destPath, status: "fail", message: "run adjutant upgrade" });
      continue;
    }
    // Compare content against template to detect outdated files
    try {
      const currentContent = readFileSync(fullPath, "utf-8");
      const templateContent = loadTemplate(qf.templateName);
      if (currentContent !== templateContent) {
        results.push({ name: qf.destPath, status: "warn", message: "outdated — run adjutant upgrade" });
      } else {
        results.push({ name: qf.destPath, status: "pass" });
      }
    } catch {
      // Template loading failed — just report existence
      results.push({ name: qf.destPath, status: "pass" });
    }
  }
  return results;
}

export async function runDoctor(): Promise<number> {
  printHeader("Adjutant Doctor");
  const cwd = process.cwd();
  const results: CheckResult[] = [];

  // adj-013.3.1 - File/directory existence checks
  results.push(...checkFiles(cwd));

  // Quality gate file checks
  results.push(...checkQualityFiles(cwd));

  // adj-013.3.2 - Network checks (health, MCP SSE)
  results.push(...(await checkNetwork()));

  // adj-013.3.3 - Tool availability checks
  results.push(...checkTools());

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  return hasFail ? 1 : 0;
}
