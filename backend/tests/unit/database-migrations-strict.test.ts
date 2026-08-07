/**
 * Regression tests for adj-sh3pg.
 *
 * The production build (`tsc`) emits only .js — it never copied
 * `src/services/migrations/*.sql` into `dist/`. `runMigrations` caught the
 * resulting ENOENT, logged a WARN and RETURNED, so `npm start` applied ZERO
 * migrations. A fresh DB came up with only the `migrations` +
 * `sqlite_sequence` tables and the first real query threw
 * "no such table: messages" -> server flaps, agents crash-loop.
 *
 * A silent skip is never correct here: if the migrations directory is missing
 * or empty, the build is broken and the process MUST fail loudly at startup
 * rather than serve an empty schema.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;

function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-migrations-strict-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("runMigrations (fail-loud contract, adj-sh3pg)", () => {
  beforeEach(() => {
    testDir = freshTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should throw when the migrations directory does not exist", async () => {
    const { createDatabase, runMigrations } = await import("../../src/services/database.js");
    const db = createDatabase(join(testDir, "test.db"));

    try {
      const missingDir = join(testDir, "does-not-exist");

      // This is the exact production failure: dist/services/migrations was never emitted.
      expect(() => { runMigrations(db, missingDir); }).toThrow(/migration/i);
    } finally {
      db.close();
    }
  });

  it("should throw when the migrations directory exists but contains no .sql files", async () => {
    const { createDatabase, runMigrations } = await import("../../src/services/database.js");
    const db = createDatabase(join(testDir, "test.db"));

    try {
      // A copy step that runs but silently copies nothing is just as broken
      // as no copy step at all — it must not be mistaken for "0 migrations to apply".
      const emptyDir = join(testDir, "empty-migrations");
      mkdirSync(emptyDir, { recursive: true });

      expect(() => { runMigrations(db, emptyDir); }).toThrow(/migration/i);
    } finally {
      db.close();
    }
  });

  it("should NOT leave an empty schema behind when the migrations directory is missing", async () => {
    const { createDatabase, runMigrations } = await import("../../src/services/database.js");
    const db = createDatabase(join(testDir, "test.db"));

    try {
      expect(() => { runMigrations(db, join(testDir, "nope")); }).toThrow();

      // The regression signature: previously this returned cleanly and the
      // server carried on with only bookkeeping tables present.
      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as { name: string }[]
      ).map((r) => r.name);

      expect(tables).not.toContain("messages");
    } finally {
      db.close();
    }
  });

  it("should apply migrations from an explicit directory when .sql files are present", async () => {
    const { createDatabase, runMigrations } = await import("../../src/services/database.js");
    const db = createDatabase(join(testDir, "test.db"));

    try {
      const dir = join(testDir, "migrations");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "001-a.sql"), "CREATE TABLE alpha (id INTEGER PRIMARY KEY);");
      writeFileSync(join(dir, "002-b.sql"), "CREATE TABLE beta (id INTEGER PRIMARY KEY);");

      runMigrations(db, dir);

      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as { name: string }[]
      ).map((r) => r.name);

      expect(tables).toContain("alpha");
      expect(tables).toContain("beta");

      const applied = (
        db.prepare("SELECT name FROM migrations ORDER BY name").all() as { name: string }[]
      ).map((r) => r.name);
      expect(applied).toEqual(["001-a.sql", "002-b.sql"]);
    } finally {
      db.close();
    }
  });

  it("should default to the bundled migrations directory when none is supplied", async () => {
    const { createDatabase, runMigrations } = await import("../../src/services/database.js");
    const db = createDatabase(join(testDir, "test.db"));

    try {
      // No explicit dir -> resolves next to the module, which must exist in
      // BOTH src (dev/tsx) and dist (prod) for the server to boot.
      expect(() => { runMigrations(db); }).not.toThrow();

      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as { name: string }[]
      ).map((r) => r.name);

      expect(tables).toContain("messages");
    } finally {
      db.close();
    }
  });
});
