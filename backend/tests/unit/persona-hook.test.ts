/**
 * Persona Hook Script Tests
 *
 * Tests the hook script behavior for persona context injection.
 * Covers:
 * - adj-033.4.2: SessionStart hook with compact matcher (re-injection after compaction)
 * - adj-033.4.3: SessionStart hook for initial persona context injection
 *
 * The hook script is a bash script that:
 * 1. Reads ADJUTANT_PERSONA_ID from environment
 * 2. Calls GET /api/personas/:id/prompt on the Adjutant API
 * 3. Outputs the prompt to stdout (Claude Code injects into context)
 * 4. Exits silently when no persona is configured (non-persona agents)
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Path to the hook script (in scripts/hooks, NOT .claude/hooks — .claude is gitignored)
const HOOK_SCRIPT = resolve(
  import.meta.dirname,
  "../../..",
  "scripts/hooks/persona-inject.sh",
);

describe("persona-inject.sh hook script", () => {
  it("should exist and be executable", () => {
    expect(existsSync(HOOK_SCRIPT)).toBe(true);

    // Check executable permission
    const { statSync } = require("node:fs");
    const stats = statSync(HOOK_SCRIPT);
    // Check user execute bit
    const isExecutable = (stats.mode & 0o100) !== 0;
    expect(isExecutable).toBe(true);
  });

  it("should exit silently when ADJUTANT_PERSONA_ID is not set", () => {
    const output = execSync(`bash "${HOOK_SCRIPT}"`, {
      encoding: "utf8",
      env: {
        ...process.env,
        ADJUTANT_PERSONA_ID: "",
      },
    });

    // Should produce no output (no-op for non-persona agents)
    expect(output.trim()).toBe("");
  });

  it("should exit silently when API is unreachable", () => {
    const output = execSync(`bash "${HOOK_SCRIPT}"`, {
      encoding: "utf8",
      env: {
        ...process.env,
        ADJUTANT_PERSONA_ID: "some-persona-id",
        // Use a port that's almost certainly not running anything
        ADJUTANT_API_BASE: "http://localhost:59999",
      },
      timeout: 10000,
    });

    // Should produce no output (graceful failure)
    expect(output.trim()).toBe("");
  });

  it("should contain proper curl command for API call", () => {
    const content = readFileSync(HOOK_SCRIPT, "utf8");

    // Should call the personas API endpoint
    expect(content).toContain("/api/personas/");
    expect(content).toContain("/prompt");
    expect(content).toContain("curl");
    expect(content).toContain("ADJUTANT_PERSONA_ID");
    expect(content).toContain("ADJUTANT_API_BASE");
  });

  it("should use jq to extract prompt from JSON response", () => {
    const content = readFileSync(HOOK_SCRIPT, "utf8");

    // Should use jq to parse the response
    expect(content).toContain("jq");
    expect(content).toContain(".data.prompt");
  });

  it("should default API base to localhost:4201", () => {
    const content = readFileSync(HOOK_SCRIPT, "utf8");

    expect(content).toContain("http://localhost:4201");
  });
});

describe(".claude/settings.json hook registration", () => {
  // NOTE: .claude/ is gitignored in this project. The settings.json is
  // force-added or managed locally. Tests verify the structure is correct.
  const SETTINGS_PATH = resolve(
    import.meta.dirname,
    "../../..",
    ".claude/settings.json",
  );

  it("should exist", () => {
    expect(existsSync(SETTINGS_PATH)).toBe(true);
  });

  it("should register two SessionStart hooks", () => {
    const content = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));

    expect(content.hooks).toBeDefined();
    expect(content.hooks.SessionStart).toBeDefined();
    expect(content.hooks.SessionStart).toHaveLength(2);
  });

  it("should have a hook without matcher for initial injection", () => {
    const content = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    const hooks = content.hooks.SessionStart;

    const initialHook = hooks.find(
      (h: { matcher?: string }) => !h.matcher || h.matcher === "",
    );

    expect(initialHook).toBeDefined();
    expect(initialHook.hooks[0].command).toBe("scripts/hooks/persona-inject.sh");
  });

  it("should have a hook with 'compact' matcher for post-compaction re-injection", () => {
    const content = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    const hooks = content.hooks.SessionStart;

    const compactHook = hooks.find(
      (h: { matcher?: string }) => h.matcher === "compact",
    );

    expect(compactHook).toBeDefined();
    expect(compactHook.hooks[0].command).toBe("scripts/hooks/persona-inject.sh");
  });

  it("should point both hooks to the same script", () => {
    const content = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    const hooks = content.hooks.SessionStart;

    const commands = hooks.map((h: { hooks: Array<{ command: string }> }) => h.hooks[0].command);
    // Both should reference the same script
    expect(new Set(commands).size).toBe(1);
  });
});
