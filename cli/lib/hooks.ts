/**
 * Claude Code hook registration for Adjutant.
 *
 * Merges adjutant-prime hooks into ~/.claude/settings.json
 * without clobbering existing user hooks.
 */

import { mkdirSync } from "fs";
import { dirname } from "path";

import {
  getClaudeSettingsPath,
  parseJsonFile,
  writeJsonFile,
  adjutantHookRegistered,
  HOOK_COMMAND,
  type ClaudeSettings,
  type HookMatcher,
} from "./checks.js";
import type { CheckResult } from "./output.js";

const ADJUTANT_HOOK_MATCHER: HookMatcher = {
  matcher: "",
  hooks: [{ type: "command", command: HOOK_COMMAND }],
};

const HOOK_EVENTS = ["SessionStart", "PreCompact"] as const;

function hasAdjutantHook(matchers: HookMatcher[] | undefined): boolean {
  if (!matchers) return false;
  return matchers.some((m) =>
    m.hooks?.some((h) => h.command === HOOK_COMMAND)
  );
}

/** Register adjutant-prime hooks in Claude Code settings. Returns a CheckResult. */
export function registerHooks(): CheckResult {
  if (adjutantHookRegistered()) {
    return { name: "Claude Code hooks", status: "skipped", message: "already registered" };
  }

  const settingsPath = getClaudeSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });

  const settings: ClaudeSettings = parseJsonFile<ClaudeSettings>(settingsPath) ?? {};

  if (!settings.hooks) {
    settings.hooks = {};
  }

  for (const event of HOOK_EVENTS) {
    const existing = settings.hooks[event];
    if (!hasAdjutantHook(existing)) {
      settings.hooks[event] = [...(existing ?? []), ADJUTANT_HOOK_MATCHER];
    }
  }

  writeJsonFile(settingsPath, settings);

  if (adjutantHookRegistered()) {
    return { name: "Claude Code hooks", status: "created", message: "registered SessionStart + PreCompact" };
  }

  return { name: "Claude Code hooks", status: "fail", message: "failed to write hooks" };
}
