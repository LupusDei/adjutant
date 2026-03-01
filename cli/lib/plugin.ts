/**
 * Plugin installation logic for Adjutant.
 *
 * Uses Claude Code's own CLI (`claude plugin ...`) to properly register
 * the marketplace, install the plugin, and enable it. Falls back to
 * manual legacy hook cleanup since there's no CLI command for that.
 */

import { execSync } from "child_process";

import {
  commandAvailable,
  getClaudeSettingsPath,
  parseJsonFile,
  writeJsonFile,
  type ClaudeSettings,
  type HookMatcher,
} from "./checks.js";
import type { CheckResult } from "./output.js";

/** GitHub repo for the adjutant marketplace. */
const GITHUB_REPO = "LupusDei/adjutant";

/** Marketplace and plugin share the same name. */
const MARKETPLACE_NAME = "adjutant-agent";
const PLUGIN_NAME = "adjutant-agent";
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/** Old hook commands that the plugin.json now handles. */
const LEGACY_HOOK_COMMANDS = [
  "cat .adjutant/PRIME.md 2>/dev/null || true",
  "adjutant prime",
];

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

/** Check if the plugin is already installed via `claude plugin list`. */
function isPluginInstalled(): boolean {
  const output = runClaude("plugin list");
  if (!output) return false;
  return output.includes(PLUGIN_KEY) || output.includes(PLUGIN_NAME);
}

/** Check if the marketplace is already registered. */
function isMarketplaceRegistered(): boolean {
  const output = runClaude("plugin marketplace list");
  if (!output) return false;
  return output.includes(MARKETPLACE_NAME);
}

/**
 * Register the adjutant marketplace via GitHub repo.
 * Uses `claude plugin marketplace add LupusDei/adjutant` which creates
 * a proper `"source": "github"` entry (local paths create invalid entries).
 */
function registerMarketplace(): CheckResult {
  if (isMarketplaceRegistered()) {
    return { name: "Plugin marketplace", status: "skipped", message: "already registered" };
  }

  const result = runClaude(`plugin marketplace add ${GITHUB_REPO}`);
  if (result !== null) {
    return { name: "Plugin marketplace", status: "created", message: MARKETPLACE_NAME };
  }
  return { name: "Plugin marketplace", status: "fail", message: "claude plugin marketplace add failed" };
}

/**
 * Install the plugin from the marketplace.
 */
function installFromMarketplace(): CheckResult {
  if (isPluginInstalled()) {
    return { name: "Plugin installed", status: "skipped", message: "already installed" };
  }

  const result = runClaude(`plugin install ${PLUGIN_KEY} --scope user`);
  if (result !== null) {
    return { name: "Plugin installed", status: "created", message: PLUGIN_KEY };
  }
  return { name: "Plugin installed", status: "fail", message: "claude plugin install failed" };
}

/**
 * Enable the plugin.
 */
function enablePluginViaCli(): CheckResult {
  // claude plugin enable exits 1 when already enabled, so check first
  const output = runClaude("plugin list");
  if (output?.includes(PLUGIN_KEY) && output?.includes("enabled")) {
    return { name: "Plugin enabled", status: "skipped", message: "already enabled" };
  }

  const result = runClaude(`plugin enable ${PLUGIN_KEY}`);
  if (result !== null) {
    return { name: "Plugin enabled", status: "created", message: PLUGIN_KEY };
  }
  return { name: "Plugin enabled", status: "fail", message: "claude plugin enable failed" };
}

/**
 * Remove old manual hook entries that the plugin.json now handles.
 * Preserves non-adjutant hooks (like bd prime).
 */
export function removeOldManualHooks(): CheckResult {
  const settingsPath = getClaudeSettingsPath();
  const settings = parseJsonFile<ClaudeSettings>(settingsPath);
  if (!settings?.hooks) {
    return { name: "Legacy hooks cleanup", status: "skipped", message: "no hooks found" };
  }

  let removedCount = 0;

  for (const event of Object.keys(settings.hooks)) {
    const matchers = settings.hooks[event];
    if (!Array.isArray(matchers)) continue;

    const filtered = matchers.filter((matcher: HookMatcher) => {
      // Keep matchers that have at least one non-legacy hook
      const nonLegacy = matcher.hooks?.filter(
        (h) => !LEGACY_HOOK_COMMANDS.includes(h.command)
      );
      if (!nonLegacy || nonLegacy.length === 0) {
        // All hooks in this matcher are legacy — remove entire matcher
        removedCount += matcher.hooks?.length ?? 0;
        return false;
      }
      if (nonLegacy.length < (matcher.hooks?.length ?? 0)) {
        // Some hooks are legacy — keep only non-legacy
        removedCount += (matcher.hooks?.length ?? 0) - nonLegacy.length;
        matcher.hooks = nonLegacy;
      }
      return true;
    });

    if (filtered.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = filtered;
    }
  }

  // Remove empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (removedCount === 0) {
    return { name: "Legacy hooks cleanup", status: "skipped", message: "no legacy hooks found" };
  }

  writeJsonFile(settingsPath, settings);
  return {
    name: "Legacy hooks cleanup",
    status: "created",
    message: `removed ${removedCount} legacy hook(s)`,
  };
}

/**
 * Orchestrate full plugin installation using Claude Code CLI.
 */
export function installPlugin(_projectRoot: string, _version: string): CheckResult[] {
  const results: CheckResult[] = [];

  // Check if claude CLI is available
  if (!commandAvailable("claude")) {
    results.push({
      name: "Plugin installation",
      status: "warn",
      message: "claude CLI not found — install Claude Code first, then re-run adjutant init",
    });
    // Still clean up legacy hooks even without claude CLI
    results.push(removeOldManualHooks());
    return results;
  }

  results.push(registerMarketplace());
  results.push(installFromMarketplace());
  results.push(enablePluginViaCli());
  results.push(removeOldManualHooks());

  return results;
}

/** Plugin key for use by doctor checks. */
export { PLUGIN_KEY, MARKETPLACE_NAME, PLUGIN_NAME, LEGACY_HOOK_COMMANDS };
