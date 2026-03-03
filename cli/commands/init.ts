/**
 * `adjutant init` — Bootstrap a fresh Adjutant installation.
 *
 * Creates .adjutant/PRIME.md, .mcp.json, registers Claude Code hooks,
 * checks dependencies, and initializes the SQLite database.
 *
 * Idempotent: safe to run multiple times.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  fileExists,
  dirExists,
  mcpJsonValid,
  parseJsonFile,
  writeJsonFile,
  getAdjutantDbPath,
  getGlobalAdjutantDir,
} from "../lib/checks.js";
import { installPlugin } from "../lib/plugin.js";
import { printHeader, printCheck, printSummary, printSuccess, printError, type CheckResult } from "../lib/output.js";
import { PRIME_MD_CONTENT } from "../lib/prime.js";

interface InitOptions {
  force: boolean;
}

const MCP_CONFIG = {
  mcpServers: {
    adjutant: {
      type: "http",
      url: "http://localhost:4201/mcp",
      headers: {
        "X-Agent-Id": "${ADJUTANT_AGENT_ID:-unknown}",
      },
    },
  },
};

function initAdjutantDir(projectRoot: string, force: boolean): CheckResult {
  const adjDir = join(projectRoot, ".adjutant");
  const primePath = join(adjDir, "PRIME.md");

  if (!dirExists(adjDir)) {
    mkdirSync(adjDir, { recursive: true });
  }

  if (fileExists(primePath) && !force) {
    return { name: ".adjutant/PRIME.md", status: "skipped", message: "already exists" };
  }

  writeFileSync(primePath, PRIME_MD_CONTENT, "utf-8");
  return { name: ".adjutant/PRIME.md", status: "created" };
}

function initGlobalPrime(force: boolean): CheckResult {
  const globalDir = getGlobalAdjutantDir();
  const primePath = join(globalDir, "PRIME.md");

  if (!dirExists(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }

  if (fileExists(primePath) && !force) {
    return { name: "~/.adjutant/PRIME.md", status: "skipped", message: "already exists" };
  }

  writeFileSync(primePath, PRIME_MD_CONTENT, "utf-8");
  return { name: "~/.adjutant/PRIME.md", status: "created", message: "default global PRIME.md" };
}

function initMcpJson(projectRoot: string): CheckResult {
  const { exists, hasAdjutant, malformed } = mcpJsonValid(projectRoot);

  if (!exists) {
    writeJsonFile(join(projectRoot, ".mcp.json"), MCP_CONFIG);
    return { name: ".mcp.json", status: "created" };
  }

  if (malformed) {
    return { name: ".mcp.json", status: "fail", message: "file exists but contains invalid JSON — fix manually" };
  }

  if (hasAdjutant) {
    return { name: ".mcp.json", status: "skipped", message: "adjutant server already configured" };
  }

  // Exists but missing adjutant entry — merge without clobbering
  const mcpPath = join(projectRoot, ".mcp.json");
  const existing = parseJsonFile<Record<string, unknown>>(mcpPath) ?? {};
  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  servers.adjutant = MCP_CONFIG.mcpServers.adjutant;
  existing.mcpServers = servers;
  writeJsonFile(mcpPath, existing);

  return { name: ".mcp.json", status: "created", message: "merged adjutant into existing config" };
}

function checkDependencies(projectRoot: string): CheckResult[] {
  const results: CheckResult[] = [];

  const backendModules = dirExists(join(projectRoot, "backend", "node_modules"));
  const frontendModules = dirExists(join(projectRoot, "frontend", "node_modules"));

  if (backendModules && frontendModules) {
    results.push({ name: "Dependencies", status: "pass", message: "node_modules found" });
  } else {
    const missing: string[] = [];
    if (!backendModules) missing.push("backend");
    if (!frontendModules) missing.push("frontend");
    results.push({
      name: "Dependencies",
      status: "warn",
      message: `${missing.join(", ")} node_modules missing — run: npm run install:all`,
    });
  }

  return results;
}

function checkDatabase(): CheckResult {
  const dbPath = getAdjutantDbPath();
  if (fileExists(dbPath)) {
    return { name: "SQLite database", status: "pass", message: dbPath };
  }
  return {
    name: "SQLite database",
    status: "warn",
    message: "not found — created automatically on first npm run dev",
  };
}

export async function runInit(options: InitOptions): Promise<number> {
  printHeader("Adjutant Init");
  const projectRoot = process.cwd();
  const results: CheckResult[] = [];

  // Global default PRIME.md (~/.adjutant/PRIME.md)
  results.push(initGlobalPrime(options.force));

  // Local .adjutant/ dir + PRIME.md (repo-specific override)
  results.push(initAdjutantDir(projectRoot, options.force));

  // adj-013.2.3: .mcp.json creation/validation
  results.push(initMcpJson(projectRoot));

  // Plugin installation (symlink, registry, enable, legacy hook cleanup)
  // Resolve adjutant project root from this module's location (not cwd)
  // dist/cli/commands/init.js -> project root is 3 levels up
  const adjutantRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const pkg = JSON.parse(readFileSync(join(adjutantRoot, "package.json"), "utf-8"));
  results.push(...installPlugin(adjutantRoot, pkg.version));

  // Adjutant-project-specific checks (only when running inside the adjutant repo)
  const isAdjutantProject = fileExists(join(projectRoot, "package.json")) &&
    JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8")).name === "adjutant";
  if (isAdjutantProject) {
    results.push(...checkDependencies(projectRoot));
    results.push(checkDatabase());
  }

  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  if (hasFail) {
    printError("\nAdjutant init completed with errors.");
    return 1;
  }
  printSuccess("\nAdjutant init complete.");
  return 0;
}
