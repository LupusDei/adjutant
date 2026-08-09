/**
 * Tests for cli/lib/persona-inject.ts (adj-j0jpz).
 *
 * The persona-inject SessionStart hook must be installable into ANY project and detectable
 * by doctor, without clobbering existing hooks (e.g. `bd prime`). These tests pin the
 * merge/idempotency of registration, the status probe, install (copy + register), and the
 * doctor check — the exact wiring that was missing for agents spawned outside the adjutant
 * repo.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  PERSONA_INJECT_COMMAND,
  PERSONA_INJECT_SCRIPT_REL,
  personaInjectStatus,
  registerPersonaInjectHook,
  installPersonaInjectHook,
  checkPersonaInjectWiring,
} from "../lib/persona-inject.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "adj-persona-"));
}

function writeSettings(root: string, obj: unknown): void {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(obj), "utf-8");
}

function readSettings(root: string): any {
  return JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf-8"));
}

/** A fake adjutant install with the canonical hook script present. */
function fakeAdjutantRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "adj-install-"));
  const dir = join(root, "scripts", "hooks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "persona-inject.sh"), "#!/bin/bash\necho hi\n", "utf-8");
  return root;
}

describe("registerPersonaInjectHook (adj-j0jpz)", () => {
  it("registers the hook under both '' and 'compact' matchers, preserving existing hooks", () => {
    const root = tmpProject();
    // Pre-existing settings with only `bd prime` — the real syl starting state.
    writeSettings(root, {
      hooks: { SessionStart: [{ matcher: "", hooks: [{ command: "bd prime --hook-json", type: "command" }] }] },
    });
    try {
      const changed = registerPersonaInjectHook(root);
      expect(changed).toBe(true);
      const s = readSettings(root);
      const ss = s.hooks.SessionStart as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
      const initial = ss.find((m) => m.matcher === "")!;
      const compact = ss.find((m) => m.matcher === "compact")!;
      // bd prime preserved AND persona-inject added under "".
      expect(initial.hooks.map((h) => h.command)).toContain("bd prime --hook-json");
      expect(initial.hooks.map((h) => h.command)).toContain(PERSONA_INJECT_COMMAND);
      // compact matcher created with the persona-inject command.
      expect(compact.hooks.map((h) => h.command)).toContain(PERSONA_INJECT_COMMAND);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent — a second run makes no change and does not duplicate", () => {
    const root = tmpProject();
    writeSettings(root, {});
    try {
      expect(registerPersonaInjectHook(root)).toBe(true);
      expect(registerPersonaInjectHook(root)).toBe(false);
      const s = readSettings(root);
      const initial = s.hooks.SessionStart.find((m: { matcher: string }) => m.matcher === "");
      const count = initial.hooks.filter((h: { command: string }) => h.command === PERSONA_INJECT_COMMAND).length;
      expect(count).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates settings.json from scratch when none exists", () => {
    const root = tmpProject();
    try {
      expect(registerPersonaInjectHook(root)).toBe(true);
      expect(existsSync(join(root, ".claude", "settings.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("personaInjectStatus (adj-j0jpz)", () => {
  it("reports fully wired only when script present AND registered under both matchers", () => {
    const root = tmpProject();
    const adj = fakeAdjutantRoot();
    try {
      // Nothing yet.
      expect(personaInjectStatus(root).fullyWired).toBe(false);
      // Install the whole wiring.
      installPersonaInjectHook(root, adj);
      const st = personaInjectStatus(root);
      expect(st.scriptPresent).toBe(true);
      expect(st.registered[""]).toBe(true);
      expect(st.registered["compact"]).toBe(true);
      expect(st.fullyWired).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(adj, { recursive: true, force: true });
    }
  });

  it("is not fully wired when the script is registered but missing on disk", () => {
    const root = tmpProject();
    try {
      registerPersonaInjectHook(root); // registers but does NOT create the script
      const st = personaInjectStatus(root);
      expect(st.registered[""]).toBe(true);
      expect(st.scriptPresent).toBe(false);
      expect(st.fullyWired).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("installPersonaInjectHook (adj-j0jpz)", () => {
  it("copies the executable script and registers it", () => {
    const root = tmpProject();
    const adj = fakeAdjutantRoot();
    try {
      const result = installPersonaInjectHook(root, adj);
      expect(result.status).toBe("created");
      const dest = join(root, PERSONA_INJECT_SCRIPT_REL);
      expect(existsSync(dest)).toBe(true);
      // Executable bit set (owner execute).
      expect(statSync(dest).mode & 0o100).toBe(0o100);
      expect(personaInjectStatus(root).fullyWired).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(adj, { recursive: true, force: true });
    }
  });

  it("warns (does not throw) when the adjutant install has no hook script", () => {
    const root = tmpProject();
    const emptyAdj = mkdtempSync(join(tmpdir(), "adj-empty-"));
    try {
      const result = installPersonaInjectHook(root, emptyAdj);
      expect(result.status).toBe("warn");
      expect(result.message).toMatch(/missing/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(emptyAdj, { recursive: true, force: true });
    }
  });
});

describe("checkPersonaInjectWiring (adj-j0jpz doctor)", () => {
  it("passes when fully wired", () => {
    const root = tmpProject();
    const adj = fakeAdjutantRoot();
    try {
      installPersonaInjectHook(root, adj);
      expect(checkPersonaInjectWiring(root).status).toBe("pass");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(adj, { recursive: true, force: true });
    }
  });

  it("warns with an actionable message when unwired (the syl state)", () => {
    const root = tmpProject();
    writeSettings(root, {
      hooks: { SessionStart: [{ matcher: "", hooks: [{ command: "bd prime --hook-json", type: "command" }] }] },
    });
    try {
      const result = checkPersonaInjectWiring(root);
      expect(result.status).toBe("warn");
      expect(result.message).toMatch(/adjutant init/);
      expect(result.message).toMatch(/compact/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
