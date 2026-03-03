/**
 * `adjutant unhook` — Remove Adjutant plugin hooks from Claude Code.
 *
 * Disables and uninstalls the adjutant-agent plugin, then removes
 * any legacy manual hook entries from settings.json.
 *
 * Idempotent: safe to run multiple times.
 */

import { execSync } from "child_process";

import { commandAvailable } from "../lib/checks.js";
import { removeOldManualHooks, PLUGIN_KEY } from "../lib/plugin.js";
import { printHeader, printCheck, printSummary, printSuccess, type CheckResult } from "../lib/output.js";

/** Run a claude CLI command, returning stdout or null on failure. */
function runClaude(args: string): string | null {
  try {
    return execSync(`claude ${args}`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function disablePlugin(): CheckResult {
  const output = runClaude("plugin list");
  if (!output || !output.includes(PLUGIN_KEY)) {
    return { name: "Plugin disable", status: "skipped", message: "not installed" };
  }

  // Check if already disabled
  const lines = output.split("\n");
  const pluginLine = lines.find((l) => l.includes(PLUGIN_KEY));
  if (pluginLine && !pluginLine.includes("enabled")) {
    return { name: "Plugin disable", status: "skipped", message: "already disabled" };
  }

  const result = runClaude(`plugin disable ${PLUGIN_KEY}`);
  if (result !== null) {
    return { name: "Plugin disable", status: "pass", message: PLUGIN_KEY };
  }
  return { name: "Plugin disable", status: "fail", message: "claude plugin disable failed" };
}

function uninstallPlugin(): CheckResult {
  const output = runClaude("plugin list");
  if (!output || !output.includes(PLUGIN_KEY)) {
    return { name: "Plugin uninstall", status: "skipped", message: "not installed" };
  }

  const result = runClaude(`plugin uninstall ${PLUGIN_KEY}`);
  if (result !== null) {
    return { name: "Plugin uninstall", status: "pass", message: PLUGIN_KEY };
  }
  return { name: "Plugin uninstall", status: "fail", message: "claude plugin uninstall failed" };
}

export async function runUnhook(): Promise<number> {
  printHeader("Adjutant Unhook");
  const results: CheckResult[] = [];

  if (!commandAvailable("claude")) {
    results.push({
      name: "Plugin removal",
      status: "warn",
      message: "claude CLI not found — only cleaning up legacy hooks",
    });
    results.push(removeOldManualHooks());
    for (const r of results) printCheck(r);
    printSummary(results);
    return 0;
  }

  results.push(disablePlugin());
  results.push(uninstallPlugin());
  results.push(removeOldManualHooks());

  for (const r of results) printCheck(r);
  printSummary(results);
  printSuccess("\nAdjutant hooks removed. Run `adjutant init` to re-enable.");
  return 0;
}
