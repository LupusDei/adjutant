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
        expect(migrations).toHaveLength(18);
        expect(migrations[0]?.name).toBe("001-initial.sql");
        expect(migrations[1]?.name).toBe("002-device-tokens.sql");
        expect(migrations[2]?.name).toBe("003-proposals.sql");
        expect(migrations[3]?.name).toBe("004-proposals-project.sql");
        expect(migrations[4]?.name).toBe("005-proposal-completed-status.sql");
        expect(migrations[5]?.name).toBe("006-events.sql");
        expect(migrations[6]?.name).toBe("007-personas.sql");
        expect(migrations[7]?.name).toBe("008-callsign-settings.sql");
        expect(migrations[8]?.name).toBe("009-adjutant-state.sql");
        expect(migrations[9]?.name).toBe("010-work-assignment.sql");
        expect(migrations[10]?.name).toBe("011-memory-store.sql");
        expect(migrations[11]?.name).toBe("012-spawn-history.sql");
        expect(migrations[12]?.name).toBe("013-memory-store-constraints.sql");
        expect(migrations[13]?.name).toBe("014-decision-outcomes.sql");
        expect(migrations[14]?.name).toBe("015-agent-role.sql");
        expect(migrations[15]?.name).toBe("016-agent-costs.sql");
        expect(migrations[16]?.name).toBe("017-cost-finalized.sql");
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

    it("should create agent_costs table with correct columns", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const columns = db.prepare("PRAGMA table_info(agent_costs)").all() as Array<{ name: string }>;
        const colNames = columns.map((c) => c.name);
        expect(colNames).toContain("id");
        expect(colNames).toContain("session_id");
        expect(colNames).toContain("agent_id");
        expect(colNames).toContain("bead_id");
        expect(colNames).toContain("project_path");
        expect(colNames).toContain("input_tokens");
        expect(colNames).toContain("output_tokens");
        expect(colNames).toContain("cache_read_tokens");
        expect(colNames).toContain("cache_write_tokens");
        expect(colNames).toContain("total_cost");
        expect(colNames).toContain("recorded_at");
      } finally {
        db.close();
      }
    });

    it("should create agent_costs indexes", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const indexes = db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_costs'")
          .all() as Array<{ name: string }>;
        const indexNames = indexes.map((i) => i.name);
        expect(indexNames).toContain("idx_agent_costs_session");
        expect(indexNames).toContain("idx_agent_costs_bead");
        expect(indexNames).toContain("idx_agent_costs_recorded");
      } finally {
        db.close();
      }
    });

    it("should create cost_budgets table with correct columns", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const columns = db.prepare("PRAGMA table_info(cost_budgets)").all() as Array<{ name: string }>;
        const colNames = columns.map((c) => c.name);
        expect(colNames).toContain("id");
        expect(colNames).toContain("scope");
        expect(colNames).toContain("scope_id");
        expect(colNames).toContain("budget_amount");
        expect(colNames).toContain("warning_percent");
        expect(colNames).toContain("critical_percent");
        expect(colNames).toContain("created_at");
        expect(colNames).toContain("updated_at");
      } finally {
        db.close();
      }
    });

    it("should allow inserting into agent_costs table", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        db.prepare(
          `INSERT INTO agent_costs (session_id, agent_id, bead_id, project_path, input_tokens, output_tokens, total_cost)
           VALUES ('sess-1', 'agent-1', 'adj-001', '/project', 1000, 500, 0.05)`
        ).run();
        const row = db.prepare("SELECT * FROM agent_costs WHERE session_id = 'sess-1'").get() as Record<string, unknown>;
        expect(row.session_id).toBe("sess-1");
        expect(row.agent_id).toBe("agent-1");
        expect(row.total_cost).toBe(0.05);
        expect(row.recorded_at).toBeDefined();
      } finally {
        db.close();
      }
    });

    it("should allow inserting into cost_budgets table", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        db.prepare(
          `INSERT INTO cost_budgets (scope, scope_id, budget_amount, warning_percent, critical_percent)
           VALUES ('session', 'sess-1', 10.0, 80, 100)`
        ).run();
        const row = db.prepare("SELECT * FROM cost_budgets WHERE scope_id = 'sess-1'").get() as Record<string, unknown>;
        expect(row.scope).toBe("session");
        expect(row.budget_amount).toBe(10.0);
        expect(row.warning_percent).toBe(80);
      } finally {
        db.close();
      }
    });
  });
});
