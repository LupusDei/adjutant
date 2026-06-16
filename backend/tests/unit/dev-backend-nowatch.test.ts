/**
 * adj-8mmyd — Backend restart loop fix: a stable (non-watch) backend run mode.
 *
 * Root cause: `tsx watch src/index.ts` hot-reloads on ANY change to index.ts's import
 * graph. In a multi-agent session, an agent saving a watched backend source file in
 * the canonical checkout restarts the server and bounces EVERY MCP session at once.
 * The fix: ADJUTANT_NO_WATCH=1 runs the backend WITHOUT `tsx watch`, so edits to the
 * watched tree no longer reload the live server while a squad is active.
 *
 * These assert the launch script's contract (content checks, mirroring
 * verify-before-push.test.ts) — they do NOT spawn a server.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const DEV_BACKEND = resolve(__dirname, "../../../scripts/dev-backend.sh");
const DEV = resolve(__dirname, "../../../scripts/dev.sh");

describe("dev-backend.sh — ADJUTANT_NO_WATCH stable mode (adj-8mmyd)", () => {
  it("should branch on the ADJUTANT_NO_WATCH env var", () => {
    const s = readFileSync(DEV_BACKEND, "utf-8");
    expect(s).toMatch(/ADJUTANT_NO_WATCH/);
  });

  it("should run WITHOUT `watch` when ADJUTANT_NO_WATCH is set (no reload-on-edit)", () => {
    const s = readFileSync(DEV_BACKEND, "utf-8");
    // The stable branch runs plain `tsx src/index.ts` — tsx without `watch` does not
    // watch files, so an agent's save cannot restart the server.
    expect(s).toMatch(/npx tsx src\/index\.ts/);
  });

  it("should still default to `tsx watch` when the flag is unset (human dev hot-reload)", () => {
    const s = readFileSync(DEV_BACKEND, "utf-8");
    expect(s).toMatch(/npx tsx watch src\/index\.ts/);
  });

  it("should reference adj-8mmyd so the rationale is discoverable", () => {
    const s = readFileSync(DEV_BACKEND, "utf-8");
    expect(s).toMatch(/adj-8mmyd/);
  });
});

describe("dev.sh — documents the stable mode (adj-8mmyd)", () => {
  it("should document ADJUTANT_NO_WATCH in the script header", () => {
    const s = readFileSync(DEV, "utf-8");
    expect(s).toMatch(/ADJUTANT_NO_WATCH/);
  });
});
