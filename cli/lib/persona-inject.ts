/**
 * Persona-injection wiring (adj-j0jpz).
 *
 * Single source of truth for making a project "persona-ready" and for detecting whether it
 * is. Both `adjutant init` (install/repair) and `adjutant doctor` (diagnose) use this module,
 * so doctor detects exactly what init installs.
 *
 * Why this exists: the persona-inject SessionStart hook was registered ONLY in the adjutant
 * repo's own .claude/settings.json, via a relative-path command pointing at a script that
 * exists ONLY in the adjutant checkout. So agents spawned into any other project (e.g. syl)
 * got no persona re-injection, and nothing reported the gap. init now copies the hook script
 * into the project and registers it under BOTH the "" and "compact" SessionStart matchers;
 * because .claude/settings.json and scripts/ are git-tracked, worktrees inherit both.
 *
 * The turn-1 persona delivery is handled separately by injecting the persona prompt into the
 * spawn prompt (backend, agent-spawner-service). This hook is the COMPACTION-survival path:
 * it re-fetches the persona from the backend (source of truth) after a compaction clears it.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

import { parseJsonFile, writeJsonFile, type ClaudeSettings, type HookMatcher } from "./checks.js";
import type { CheckResult } from "./output.js";

/** The command string registered in settings.json (forward slashes — a shell path). */
export const PERSONA_INJECT_COMMAND = "scripts/hooks/persona-inject.sh";

/** Relative path (OS-joined) of the hook script within a project / the adjutant install. */
export const PERSONA_INJECT_SCRIPT_REL = join("scripts", "hooks", "persona-inject.sh");

const SETTINGS_REL = join(".claude", "settings.json");

/** The two SessionStart matchers the hook must be registered under: initial load + compaction. */
export const PERSONA_INJECT_MATCHERS = ["", "compact"] as const;

export interface PersonaInjectStatus {
  /** The hook script exists in the project. */
  scriptPresent: boolean;
  /** matcher string -> whether the persona-inject command is registered under it. */
  registered: Record<string, boolean>;
  /** Script present AND registered under every required matcher. */
  fullyWired: boolean;
}

/** Inspect a project's persona-injection wiring. Pure (read-only). */
export function personaInjectStatus(projectRoot: string): PersonaInjectStatus {
  const scriptPresent = existsSync(join(projectRoot, PERSONA_INJECT_SCRIPT_REL));
  const settings = parseJsonFile<ClaudeSettings>(join(projectRoot, SETTINGS_REL));
  const sessionStart = settings?.hooks?.SessionStart ?? [];
  const registered: Record<string, boolean> = {};
  for (const m of PERSONA_INJECT_MATCHERS) {
    registered[m] = sessionStart.some(
      (mm) => mm.matcher === m && (mm.hooks ?? []).some((h) => h.command === PERSONA_INJECT_COMMAND),
    );
  }
  const fullyWired = scriptPresent && PERSONA_INJECT_MATCHERS.every((m) => registered[m]);
  return { scriptPresent, registered, fullyWired };
}

/**
 * Register the persona-inject command under the "" and "compact" SessionStart matchers,
 * MERGING into existing settings (never clobbering other hooks like `bd prime`). Idempotent.
 * Returns true if it changed anything.
 */
export function registerPersonaInjectHook(projectRoot: string): boolean {
  const settingsPath = join(projectRoot, SETTINGS_REL);
  const settings: ClaudeSettings = parseJsonFile<ClaudeSettings>(settingsPath) ?? {};
  settings.hooks = settings.hooks ?? {};
  const sessionStart: HookMatcher[] = settings.hooks.SessionStart ?? [];
  let changed = false;
  for (const matcher of PERSONA_INJECT_MATCHERS) {
    let entry = sessionStart.find((x) => x.matcher === matcher);
    if (!entry) {
      entry = { matcher, hooks: [] };
      sessionStart.push(entry);
    }
    if (!entry.hooks.some((h) => h.command === PERSONA_INJECT_COMMAND)) {
      entry.hooks.push({ type: "command", command: PERSONA_INJECT_COMMAND });
      changed = true;
    }
  }
  settings.hooks.SessionStart = sessionStart;
  if (changed) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeJsonFile(settingsPath, settings);
  }
  return changed;
}

/**
 * Install persona-injection wiring into a project: copy the canonical hook script from the
 * adjutant install and register it under both matchers. `adjutantRoot` is the adjutant
 * install directory (the single source of the script — no template duplication).
 */
export function installPersonaInjectHook(projectRoot: string, adjutantRoot: string): CheckResult {
  const src = join(adjutantRoot, PERSONA_INJECT_SCRIPT_REL);
  if (!existsSync(src)) {
    return {
      name: "Persona injection",
      status: "warn",
      message: `hook script missing in adjutant install (${src}) — cannot wire`,
    };
  }
  const dest = join(projectRoot, PERSONA_INJECT_SCRIPT_REL);
  try {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    chmodSync(dest, 0o755);
  } catch (err) {
    return {
      name: "Persona injection",
      status: "fail",
      message: `could not install hook script: ${(err as Error).message}`,
    };
  }
  const changed = registerPersonaInjectHook(projectRoot);
  return {
    name: "Persona injection",
    status: "created",
    message: changed
      ? "hook installed + registered (SessionStart initial + compact)"
      : "hook present + registered (idempotent)",
  };
}

/**
 * Doctor check: is this project wired so a spawned agent's persona survives compaction?
 * `pass` when fully wired; `warn` (actionable) otherwise — never silently green.
 */
export function checkPersonaInjectWiring(projectRoot: string): CheckResult {
  const st = personaInjectStatus(projectRoot);
  if (st.fullyWired) {
    return {
      name: "Persona injection",
      status: "pass",
      message: "hook present + registered (SessionStart + compact)",
    };
  }
  const missing: string[] = [];
  if (!st.scriptPresent) missing.push(`${PERSONA_INJECT_COMMAND} missing`);
  if (!st.registered[""]) missing.push('not registered on SessionStart ""');
  if (!st.registered["compact"]) missing.push("not registered on compact (persona won't survive compaction)");
  return {
    name: "Persona injection",
    status: "warn",
    message: `${missing.join("; ")} — run 'adjutant init' to repair`,
  };
}
