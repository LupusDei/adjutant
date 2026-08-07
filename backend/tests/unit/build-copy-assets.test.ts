/**
 * Regression tests for adj-sh3pg — the build must ship non-TS runtime assets.
 *
 * `tsc` only emits .js/.d.ts. Every non-TS file the server reads at runtime
 * relative to its own module path therefore vanished from `dist/`:
 *   - src/services/migrations/*.sql  -> ZERO migrations applied on `npm start`
 *   - src/data/starcraft-heroes.md   -> agent lore silently resolved to ""
 *
 * `scripts/copy-assets.mjs` is the build step that closes that gap. These tests
 * pin the behaviour AND sweep the real `src/` tree, so a future asset added in a
 * new directory can't silently fail to ship.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// @ts-expect-error -- plain .mjs build script, intentionally untyped (no d.ts).
import { copyAssets } from "../../scripts/copy-assets.mjs";

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_SRC = join(BACKEND_ROOT, "src");

let testDir: string;

function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-copy-assets-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Recursively list files under `dir` as paths relative to it (posix-normalized). */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

function write(root: string, relPath: string, contents: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

describe("copyAssets (build step, adj-sh3pg)", () => {
  beforeEach(() => {
    testDir = freshTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should copy .sql files preserving their directory structure", () => {
    const src = join(testDir, "src");
    const out = join(testDir, "dist");
    write(src, "services/migrations/001-initial.sql", "CREATE TABLE messages (id TEXT);");
    write(src, "services/migrations/002-next.sql", "CREATE TABLE agents (id TEXT);");

    copyAssets({ srcDir: src, outDir: out });

    // The runtime resolves migrations via join(__dirname, "migrations"), so the
    // nesting must survive the copy exactly.
    expect(existsSync(join(out, "services/migrations/001-initial.sql"))).toBe(true);
    expect(existsSync(join(out, "services/migrations/002-next.sql"))).toBe(true);
    expect(readFileSync(join(out, "services/migrations/001-initial.sql"), "utf-8")).toBe(
      "CREATE TABLE messages (id TEXT);",
    );
  });

  it("should copy non-SQL runtime assets such as the lore markdown", () => {
    const src = join(testDir, "src");
    const out = join(testDir, "dist");
    write(src, "data/starcraft-heroes.md", "### Raynor\nMarshal turned squad leader.");

    copyAssets({ srcDir: src, outDir: out });

    expect(existsSync(join(out, "data/starcraft-heroes.md"))).toBe(true);
  });

  it("should NOT copy TypeScript sources (tsc already emits those)", () => {
    const src = join(testDir, "src");
    const out = join(testDir, "dist");
    write(src, "services/database.ts", "export const x = 1;");
    write(src, "types/personas.d.ts", "declare const y: number;");
    write(src, "services/migrations/001-initial.sql", "CREATE TABLE t (id TEXT);");

    copyAssets({ srcDir: src, outDir: out });

    expect(existsSync(join(out, "services/database.ts"))).toBe(false);
    expect(existsSync(join(out, "types/personas.d.ts"))).toBe(false);
    expect(listFiles(out)).toEqual(["services/migrations/001-initial.sql"]);
  });

  it("should report how many assets were copied", () => {
    const src = join(testDir, "src");
    const out = join(testDir, "dist");
    write(src, "a/one.sql", "-- 1");
    write(src, "b/two.sql", "-- 2");
    write(src, "b/ignored.ts", "export {};");

    const result = copyAssets({ srcDir: src, outDir: out });

    // The build uses this count to fail loudly if it ever copies nothing.
    expect(result.copied).toBe(2);
  });

  it("should overwrite a stale asset left from a previous build", () => {
    const src = join(testDir, "src");
    const out = join(testDir, "dist");
    write(src, "m/001.sql", "NEW");
    write(out, "m/001.sql", "STALE");

    copyAssets({ srcDir: src, outDir: out });

    expect(readFileSync(join(out, "m/001.sql"), "utf-8")).toBe("NEW");
  });

  it("should throw when the source directory does not exist", () => {
    expect(() =>
      copyAssets({ srcDir: join(testDir, "missing"), outDir: join(testDir, "dist") }),
    ).toThrow();
  });

  it("should ship EVERY non-TS asset in the real src/ tree (sweep)", () => {
    const out = join(testDir, "dist");

    copyAssets({ srcDir: REAL_SRC, outDir: out });

    const expected = listFiles(REAL_SRC).filter((f) => !f.endsWith(".ts"));
    // Guards against a future asset landing in a brand-new directory that a
    // hardcoded per-directory copy list would miss.
    expect(listFiles(out)).toEqual(expected);
  });

  it("should ship all 38+ real migrations so a fresh prod DB gets a full schema", () => {
    const out = join(testDir, "dist");

    copyAssets({ srcDir: REAL_SRC, outDir: out });

    const srcSql = readdirSync(join(REAL_SRC, "services", "migrations")).filter((f) =>
      f.endsWith(".sql"),
    );
    const outSql = readdirSync(join(out, "services", "migrations")).filter((f) =>
      f.endsWith(".sql"),
    );

    expect(srcSql.length).toBeGreaterThanOrEqual(38);
    expect(outSql.sort()).toEqual(srcSql.sort());
  });

  it("should ship the lore file at the path genesis-prompt resolves", () => {
    const out = join(testDir, "dist");

    copyAssets({ srcDir: REAL_SRC, outDir: out });

    // genesis-prompt.ts: join(__dirname, "..", "..", "data", "starcraft-heroes.md")
    // from dist/services/adjutant/ -> dist/data/starcraft-heroes.md
    expect(existsSync(join(out, "data", "starcraft-heroes.md"))).toBe(true);
  });
});
