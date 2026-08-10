/**
 * Persona Hook Script Tests
 *
 * Tests the hook script behavior for persona context injection.
 * Covers:
 * - adj-033.4.2: SessionStart hook with compact matcher (re-injection after compaction)
 * - adj-033.4.3: SessionStart hook for initial persona context injection
 *
 * The hook script (adj-j0jpz: rewritten to be BACKEND-SOURCED, not file-sourced) is a bash
 * script that:
 * 1. Reads ADJUTANT_AGENT_ID from environment (exits silently if unset)
 * 2. Resolves the backend origin from .mcp.json (or ADJUTANT_BACKEND_URL / localhost)
 * 3. curls GET /api/agents/<id>/persona-prompt — the backend is the source of truth, so
 *    this works in ANY project/worktree, not just the adjutant repo
 * 4. On 200: outputs the rendered persona prompt to stdout
 * 5. On 404: exits silently (legitimate no-persona / generic agent)
 * 6. On failure while a persona IS assigned (ADJUTANT_PERSONA_ID set): prints a LOUD
 *    warning instead of the old silent exit 0 (RC3 — a no-op must never look like success)
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { statSync } = require("node:fs");
    const stats = statSync(HOOK_SCRIPT);
    // Check user execute bit
    const isExecutable = (stats.mode & 0o100) !== 0;
    expect(isExecutable).toBe(true);
  });

  it("should exit silently when ADJUTANT_AGENT_ID is not set", () => {
    const output = execSync(`bash "${HOOK_SCRIPT}"`, {
      encoding: "utf8",
      env: {
        ...process.env,
        ADJUTANT_AGENT_ID: "",
        ADJUTANT_PERSONA_ID: "",
      },
    });

    // Should produce no output (no-op for non-persona agents)
    expect(output.trim()).toBe("");
  });

  it("should fetch the persona from the backend by callsign (backend-sourced, adj-j0jpz)", () => {
    const content = readFileSync(HOOK_SCRIPT, "utf8");

    // Backend is the source of truth — works in any project/worktree, not just adjutant.
    expect(content).toContain("ADJUTANT_AGENT_ID");
    expect(content).toContain("curl");
    expect(content).toContain("/api/agents/");
    expect(content).toContain("persona-prompt");
  });

  it("should resolve the backend origin from .mcp.json (not hardcoded)", () => {
    const content = readFileSync(HOOK_SCRIPT, "utf8");

    expect(content).toContain(".mcp.json");
    expect(content).toContain("ADJUTANT_BACKEND_URL");
  });

  it("should be LOUD when a persona is assigned but delivery fails, not silent (RC3)", () => {
    const content = readFileSync(HOOK_SCRIPT, "utf8");

    // A persona-assigned-but-undeliverable case must warn into the session.
    expect(content).toContain("ADJUTANT_PERSONA_ID");
    expect(content).toContain("PERSONA NOT LOADED");
    // And a genuine 404 (no persona) stays silent.
    expect(content).toContain("404");
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

  it("should register two persona-inject SessionStart hooks", () => {
    const content = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));

    expect(content.hooks).toBeDefined();
    expect(content.hooks.SessionStart).toBeDefined();
    // Two persona-inject hooks (initial + compact). Other SessionStart hooks may
    // legitimately co-exist (e.g. the beads `bd prime` hook), so scope the count to
    // the persona-inject script rather than asserting the total SessionStart count.
    const personaHooks = content.hooks.SessionStart.filter(
      (h: { hooks: { command: string }[] }) =>
        h.hooks[0].command === "scripts/hooks/persona-inject.sh",
    );
    expect(personaHooks).toHaveLength(2);
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

  it("should point both persona hooks to the same script", () => {
    const content = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));

    const personaCommands = content.hooks.SessionStart
      .map((h: { hooks: { command: string }[] }) => h.hooks[0].command)
      .filter((c: string) => c === "scripts/hooks/persona-inject.sh");
    // Both persona hooks (initial + compact) reference the same script.
    expect(personaCommands).toHaveLength(2);
    expect(new Set(personaCommands).size).toBe(1);
  });
});
