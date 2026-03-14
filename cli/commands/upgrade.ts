/**
 * `adjutant upgrade` — Repair and upgrade local Adjutant files.
 *
 * Updates PRIME.md (local + global), refreshes .mcp.json config,
 * reinstalls the Claude Code plugin, and reports what changed.
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
  getGlobalAdjutantDir,
} from "../lib/checks.js";
import { installPlugin } from "../lib/plugin.js";
import {
  printHeader,
  printCheck,
  printSummary,
  printSuccess,
  printError,
  type CheckResult,
} from "../lib/output.js";

/** Resolve the adjutant package root from this module's location. */
function getPackageRoot(): string {
  // dist/cli/commands/upgrade.js -> project root is 3 levels up
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Read the canonical PRIME.md from the installed package. */
function getCanonicalPrimeContent(packageRoot: string): string {
  const primePath = join(packageRoot, ".adjutant", "PRIME.md");
  return readFileSync(primePath, "utf-8");
}

/** Compare and optionally update a PRIME.md file. Returns the check result. */
function upgradePrimeFile(
  targetPath: string,
  displayName: string,
  canonicalContent: string,
): CheckResult {
  if (!fileExists(targetPath)) {
    const targetDir = dirname(targetPath);
    if (!dirExists(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(targetPath, canonicalContent, "utf-8");
    return { name: displayName, status: "created", message: "did not exist — created" };
  }

  const currentContent = readFileSync(targetPath, "utf-8");
  if (currentContent === canonicalContent) {
    return { name: displayName, status: "pass", message: "up to date" };
  }

  // Content differs — update it
  const currentLines = currentContent.split("\n").length;
  const newLines = canonicalContent.split("\n").length;
  writeFileSync(targetPath, canonicalContent, "utf-8");
  return {
    name: displayName,
    status: "created",
    message: `updated (${currentLines} → ${newLines} lines)`,
  };
}

const MCP_CONFIG_ENTRY = {
  type: "http",
  url: "http://localhost:4201/mcp",
  headers: {
    "X-Agent-Id": "${ADJUTANT_AGENT_ID:-unknown}",
  },
};

/** Check and upgrade .mcp.json. */
function upgradeMcpJson(projectRoot: string): CheckResult {
  const { exists, hasAdjutant, malformed } = mcpJsonValid(projectRoot);
  const mcpPath = join(projectRoot, ".mcp.json");

  if (!exists) {
    writeJsonFile(mcpPath, { mcpServers: { adjutant: MCP_CONFIG_ENTRY } });
    return { name: ".mcp.json", status: "created" };
  }

  if (malformed) {
    return { name: ".mcp.json", status: "fail", message: "invalid JSON — fix manually" };
  }

  if (!hasAdjutant) {
    const existing = parseJsonFile<Record<string, unknown>>(mcpPath) ?? {};
    const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
    servers.adjutant = MCP_CONFIG_ENTRY;
    existing.mcpServers = servers;
    writeJsonFile(mcpPath, existing);
    return { name: ".mcp.json", status: "created", message: "added adjutant server entry" };
  }

  // Check if the adjutant config needs updating (e.g., type field added)
  const existing = parseJsonFile<{ mcpServers?: { adjutant?: Record<string, unknown> } }>(mcpPath);
  const currentConfig = existing?.mcpServers?.adjutant;
  if (currentConfig && !currentConfig.type) {
    currentConfig.type = "http";
    writeJsonFile(mcpPath, existing);
    return { name: ".mcp.json", status: "created", message: "added type: http to adjutant config" };
  }

  return { name: ".mcp.json", status: "pass", message: "up to date" };
}

export async function runUpgrade(): Promise<number> {
  const packageRoot = getPackageRoot();
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8"));
  const projectRoot = process.cwd();

  printHeader(`Adjutant Upgrade (v${pkg.version})`);
  const results: CheckResult[] = [];

  // 1. Read canonical PRIME.md from the package
  let canonicalContent: string;
  try {
    canonicalContent = getCanonicalPrimeContent(packageRoot);
  } catch {
    results.push({
      name: "Package PRIME.md",
      status: "fail",
      message: "could not read .adjutant/PRIME.md from package",
    });
    for (const r of results) printCheck(r);
    printSummary(results);
    return 1;
  }
  results.push({ name: "Package PRIME.md", status: "pass", message: `source: ${packageRoot}` });

  // 2. Upgrade local .adjutant/PRIME.md
  results.push(
    upgradePrimeFile(
      join(projectRoot, ".adjutant", "PRIME.md"),
      ".adjutant/PRIME.md",
      canonicalContent,
    ),
  );

  // 3. Upgrade global ~/.adjutant/PRIME.md
  results.push(
    upgradePrimeFile(
      join(getGlobalAdjutantDir(), "PRIME.md"),
      "~/.adjutant/PRIME.md",
      canonicalContent,
    ),
  );

  // 4. Upgrade .mcp.json
  results.push(upgradeMcpJson(projectRoot));

  // 5. Reinstall plugin (skip if running inside Claude Code — claude CLI hangs)
  if (process.env.CLAUDECODE) {
    results.push({
      name: "Plugin installation",
      status: "skip",
      message: "skipped inside Claude Code session — run adjutant upgrade from a regular terminal",
    });
  } else {
    results.push(...installPlugin(packageRoot, pkg.version));
  }

  // Print results
  for (const r of results) {
    printCheck(r);
  }
  printSummary(results);

  const hasFail = results.some((r) => r.status === "fail");
  if (hasFail) {
    printError("\nUpgrade completed with errors.");
    return 1;
  }
  printSuccess(`\nAdjutant v${pkg.version} upgrade complete.`);
  return 0;
}
