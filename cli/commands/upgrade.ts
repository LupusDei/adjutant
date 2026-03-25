/**
 * `adjutant upgrade` — Repair and upgrade local Adjutant files.
 *
 * Updates PRIME.md (local + global), refreshes .mcp.json config,
 * reinstalls the Claude Code plugin, and reports what changed.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
import { QUALITY_FILES, loadTemplate } from "../lib/quality-templates.js";

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

/** Sync all quality files from templates into the project. */
export function syncQualityFiles(projectRoot: string, force = false): CheckResult[] {
  const results: CheckResult[] = [];

  for (const qf of QUALITY_FILES) {
    const fullPath = join(projectRoot, qf.destPath);
    const templateContent = loadTemplate(qf.templateName);

    if (!fileExists(fullPath)) {
      // Missing file — always create, even for skipIfExists entries
      const dir = dirname(fullPath);
      if (!dirExists(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(fullPath, templateContent, "utf-8");
      if (qf.executable) {
        chmodSync(fullPath, 0o755);
      }
      results.push({ name: qf.destPath, status: "created", message: "did not exist — created" });
      continue;
    }

    // File exists — skipIfExists entries are never overwritten
    if (qf.skipIfExists) {
      results.push({ name: qf.destPath, status: "skipped", message: "existing file preserved" });
      continue;
    }

    const currentContent = readFileSync(fullPath, "utf-8");
    if (currentContent === templateContent) {
      results.push({ name: qf.destPath, status: "pass", message: "up to date" });
      continue;
    }

    // Content differs — only overwrite with --force, otherwise skip
    if (!force) {
      results.push({ name: qf.destPath, status: "skipped", message: "differs from package (use --force to overwrite)" });
      continue;
    }

    const currentLines = currentContent.split("\n").length;
    const newLines = templateContent.split("\n").length;
    writeFileSync(fullPath, templateContent, "utf-8");
    if (qf.executable) {
      chmodSync(fullPath, 0o755);
    }
    results.push({
      name: qf.destPath,
      status: "created",
      message: `updated (${currentLines} → ${newLines} lines)`,
    });
  }

  return results;
}

const MCP_CONFIG_ENTRY = {
  type: "http",
  url: "http://localhost:4201/mcp",
  headers: {
    "X-Agent-Id": "${ADJUTANT_AGENT_ID:-unknown}",
    "X-Project-Root": "${ADJUTANT_PROJECT_ROOT:-}",
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

  // Check if the adjutant config needs updating
  const existing = parseJsonFile<{ mcpServers?: { adjutant?: Record<string, unknown> } }>(mcpPath);
  const currentConfig = existing?.mcpServers?.adjutant;
  if (!currentConfig) {
    return { name: ".mcp.json", status: "pass", message: "up to date" };
  }

  const updates: string[] = [];

  // Add type field if missing
  if (!currentConfig.type) {
    currentConfig.type = "http";
    updates.push("type: http");
  }

  // adj-138: Add X-Project-Root header if missing — without this, agents
  // spawned for other projects resolve to Adjutant's project context
  const headers = (currentConfig.headers ?? {}) as Record<string, string>;
  if (!headers["X-Project-Root"]) {
    headers["X-Project-Root"] = "${ADJUTANT_PROJECT_ROOT:-}";
    currentConfig.headers = headers;
    updates.push("X-Project-Root header");
  }

  if (updates.length > 0) {
    writeJsonFile(mcpPath, existing);
    return { name: ".mcp.json", status: "created", message: `added ${updates.join(", ")}` };
  }

  return { name: ".mcp.json", status: "pass", message: "up to date" };
}

interface UpgradeOptions {
  force?: boolean;
}

export async function runUpgrade(options: UpgradeOptions = {}): Promise<number> {
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

  // 6. Sync quality files (testing rules, code review, CI config, etc.)
  results.push(...syncQualityFiles(projectRoot, options.force));

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
