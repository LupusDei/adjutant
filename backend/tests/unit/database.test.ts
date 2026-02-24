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
        // Should have one entry per migration file, each applied exactly once
        expect(migrations).toHaveLength(3);
        expect(migrations[0]?.name).toBe("001-initial.sql");
        expect(migrations[1]?.name).toBe("002-device-tokens.sql");
        expect(migrations[2]?.name).toBe("003-proposals.sql");
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
        expect(indexNames).toContain("idx_messages_recipient");
        expect(indexNames).toContain("idx_messages_thread");
        expect(indexNames).toContain("idx_messages_session");
        expect(indexNames).toContain("idx_messages_status");
      } finally {
        db.close();
      }
    });

    it("should include recipient column in messages table", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const columns = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
        const colNames = columns.map((c) => c.name);
        expect(colNames).toContain("recipient");
      } finally {
        db.close();
      }
    });

    it("should allow failed delivery_status", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        // Insert a message and update to failed - should not violate CHECK constraint
        db.prepare(
          "INSERT INTO messages (id, agent_id, role, body, delivery_status) VALUES ('t1', 'a1', 'user', 'test', 'failed')"
        ).run();
        const row = db.prepare("SELECT delivery_status FROM messages WHERE id = 't1'").get() as { delivery_status: string };
        expect(row.delivery_status).toBe("failed");
      } finally {
        db.close();
      }
    });

    it("should default delivery_status to pending", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        db.prepare(
          "INSERT INTO messages (id, agent_id, role, body) VALUES ('t2', 'a1', 'user', 'test')"
        ).run();
        const row = db.prepare("SELECT delivery_status FROM messages WHERE id = 't2'").get() as { delivery_status: string };
        expect(row.delivery_status).toBe("pending");
      } finally {
        db.close();
      }
    });
  });
});
