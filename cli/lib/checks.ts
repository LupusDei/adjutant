/**
 * Shared check functions used by both `adjutant init` and `adjutant doctor`.
 *
 * Each check returns a boolean or a richer result. These are pure functions
 * that inspect the system state without modifying it.
 */

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { dirname, join } from "path";
import { homedir } from "os";

/** Check if a file exists at the given path. */
export function fileExists(path: string): boolean {
  return existsSync(path);
}

/** Check if a directory exists at the given path. */
export function dirExists(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/** Try to parse a JSON file. Returns the parsed object or null on failure. */
export function parseJsonFile<T = unknown>(path: string): T | null {
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** Safely write a JSON file, creating parent directories if needed. */
export function writeJsonFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** Check if a command is available on PATH. Uses POSIX `command -v` for portability. */
export function commandAvailable(command: string): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(command)) return false;
  try {
    execSync(`command -v ${command}`, { stdio: "ignore", shell: "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

/** Check if the current Node.js version meets the minimum requirement (>=20). */
export function nodeVersionOk(): { ok: boolean; version: string } {
  const version = process.versions.node;
  const major = parseInt(version.split(".")[0], 10);
  return { ok: major >= 20, version };
}

/** Check if an HTTP endpoint is reachable. Returns the status code or null. */
export async function httpReachable(url: string, timeoutMs = 3000): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.status;
  } catch {
    return null;
  }
}

/** Get the path to Claude Code settings file. */
export function getClaudeSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

/** Get the path to the adjutant database. */
export function getAdjutantDbPath(): string {
  return join(homedir(), ".adjutant", "adjutant.db");
}

/** Get the path to the API keys file. */
export function getApiKeysPath(): string {
  return join(homedir(), ".adjutant", "api-keys.json");
}

/** Check if .mcp.json has the adjutant MCP server configured. */
export function mcpJsonValid(projectRoot: string): { exists: boolean; hasAdjutant: boolean; malformed: boolean } {
  const mcpPath = join(projectRoot, ".mcp.json");
  if (!fileExists(mcpPath)) {
    return { exists: false, hasAdjutant: false, malformed: false };
  }

  const config = parseJsonFile<{ mcpServers?: { adjutant?: unknown } }>(mcpPath);
  if (!config) {
    return { exists: true, hasAdjutant: false, malformed: true };
  }

  return { exists: true, hasAdjutant: !!config.mcpServers?.adjutant, malformed: false };
}

export interface HookEntry {
  type: string;
  command: string;
}

export interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

export interface ClaudeSettings {
  hooks?: {
    SessionStart?: HookMatcher[];
    PreCompact?: HookMatcher[];
    [key: string]: HookMatcher[] | undefined;
  };
  [key: string]: unknown;
}

export const HOOK_COMMAND = "cat .adjutant/PRIME.md 2>/dev/null || true";

/** Check if adjutant-prime hook is registered in Claude Code settings. */
export function adjutantHookRegistered(): boolean {
  const settingsPath = getClaudeSettingsPath();
  const settings = parseJsonFile<ClaudeSettings>(settingsPath);
  if (!settings?.hooks) return false;

  function hasHook(matchers: HookMatcher[] | undefined): boolean {
    if (!matchers) return false;
    return matchers.some((m) =>
      m.hooks?.some((h) => h.command === HOOK_COMMAND)
    );
  }

  return hasHook(settings.hooks.SessionStart) && hasHook(settings.hooks.PreCompact);
}
