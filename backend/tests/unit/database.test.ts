import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the database module by using its exported functions with a temp directory
// so we don't pollute the real ~/.adjutant path.

let testDir: string;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("database", () => {
  beforeEach(() => {
    testDir = freshTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("WAL mode", () => {
    it("should enable WAL journal mode", async () => {
      // Use the createDatabase helper to get a configured DB
      const { createDatabase } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        const result = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
        expect(result[0]?.journal_mode).toBe("wal");
      } finally {
        db.close();
      }
    });

    it("should set synchronous to NORMAL", async () => {
      const { createDatabase } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        const result = db.pragma("synchronous") as Array<{ synchronous: number }>;
        // NORMAL = 1
        expect(result[0]?.synchronous).toBe(1);
      } finally {
        db.close();
      }
    });

    it("should enable foreign keys", async () => {
      const { createDatabase } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        const result = db.pragma("foreign_keys") as Array<{ foreign_keys: number }>;
        expect(result[0]?.foreign_keys).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  describe("migrations", () => {
    it("should create messages table after running migrations", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
          .all() as Array<{ name: string }>;
        expect(tables).toHaveLength(1);
        expect(tables[0]?.name).toBe("messages");
      } finally {
        db.close();
      }
    });

    it("should create agent_connections table after running migrations", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_connections'")
          .all() as Array<{ name: string }>;
        expect(tables).toHaveLength(1);
      } finally {
        db.close();
      }
    });

    it("should create FTS virtual table after running migrations", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
          .all() as Array<{ name: string }>;
        expect(tables).toHaveLength(1);
      } finally {
        db.close();
      }
    });

    it("should track applied migrations and not rerun them", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        // Run again - should not throw
        runMigrations(db);

        const migrations = db
          .prepare("SELECT * FROM migrations")
          .all() as Array<{ name: string }>;
        // Should only have one entry for 001-initial.sql
        expect(migrations).toHaveLength(1);
        expect(migrations[0]?.name).toBe("001-initial.sql");
      } finally {
        db.close();
      }
    });

    it("should create indexes on messages table", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const indexes = db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='messages'")
          .all() as Array<{ name: string }>;
        const indexNames = indexes.map((i) => i.name);
        expect(indexNames).toContain("idx_messages_agent");
        expect(indexNames).toContain("idx_messages_thread");
        expect(indexNames).toContain("idx_messages_session");
        expect(indexNames).toContain("idx_messages_status");
      } finally {
        db.close();
      }
    });
  });
});
