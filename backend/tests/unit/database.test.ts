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
        const result = db.pragma("journal_mode") as { journal_mode: string }[];
        expect(result[0]?.journal_mode).toBe("wal");
      } finally {
        db.close();
      }
    });

    it("should set synchronous to NORMAL", async () => {
      const { createDatabase } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        const result = db.pragma("synchronous") as { synchronous: number }[];
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
        const result = db.pragma("foreign_keys") as { foreign_keys: number }[];
        expect(result[0]?.foreign_keys).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  describe("migrations", () => {
    it("should create all expected tables after running migrations", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as { name: string }[];
        const tableNames = tables.map((t) => t.name);
        expect(tableNames).toContain("messages");
        expect(tableNames).toContain("agent_connections");
        expect(tableNames).toContain("messages_fts");
        expect(tableNames).toContain("agent_costs");
        expect(tableNames).toContain("cost_budgets");
      } finally {
        db.close();
      }
    });

    it("should track applied migrations and not rerun them", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);
        runMigrations(db); // should not throw

        const migrations = db
          .prepare("SELECT * FROM migrations")
          .all() as { name: string }[];
        expect(migrations).toHaveLength(27);
        expect(migrations[0]?.name).toBe("001-initial.sql");
      } finally {
        db.close();
      }
    });

    it("should create expected indexes and columns on messages table", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);

        // Check indexes
        const indexes = db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='messages'")
          .all() as { name: string }[];
        const indexNames = indexes.map((i) => i.name);
        expect(indexNames).toContain("idx_messages_agent");
        expect(indexNames).toContain("idx_messages_recipient");
        expect(indexNames).toContain("idx_messages_thread");
        expect(indexNames).toContain("idx_messages_session");
        expect(indexNames).toContain("idx_messages_status");

        // Check recipient column exists
        const columns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
        expect(columns.map((c) => c.name)).toContain("recipient");
      } finally {
        db.close();
      }
    });

    it("should handle delivery_status defaults and constraints", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);

        // Default should be 'pending'
        db.prepare(
          "INSERT INTO messages (id, agent_id, role, body) VALUES ('t1', 'a1', 'user', 'test')"
        ).run();
        const row1 = db.prepare("SELECT delivery_status FROM messages WHERE id = 't1'").get() as { delivery_status: string };
        expect(row1.delivery_status).toBe("pending");

        // 'failed' should be allowed
        db.prepare(
          "INSERT INTO messages (id, agent_id, role, body, delivery_status) VALUES ('t2', 'a1', 'user', 'test', 'failed')"
        ).run();
        const row2 = db.prepare("SELECT delivery_status FROM messages WHERE id = 't2'").get() as { delivery_status: string };
        expect(row2.delivery_status).toBe("failed");
      } finally {
        db.close();
      }
    });

    it("should create agent_costs and cost_budgets tables with correct schema", async () => {
      const { createDatabase, runMigrations } = await import("../../src/services/database.js");
      const db = createDatabase(join(testDir, "test.db"));
      try {
        runMigrations(db);

        // Verify agent_costs columns
        const costCols = db.prepare("PRAGMA table_info(agent_costs)").all() as { name: string }[];
        const costColNames = costCols.map((c) => c.name);
        for (const col of ["id", "session_id", "agent_id", "bead_id", "project_path", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_cost", "recorded_at"]) {
          expect(costColNames).toContain(col);
        }

        // Verify agent_costs indexes
        const costIndexes = db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_costs'")
          .all() as { name: string }[];
        const costIndexNames = costIndexes.map((i) => i.name);
        expect(costIndexNames).toContain("idx_agent_costs_session");
        expect(costIndexNames).toContain("idx_agent_costs_bead");
        expect(costIndexNames).toContain("idx_agent_costs_recorded");

        // Verify cost_budgets columns
        const budgetCols = db.prepare("PRAGMA table_info(cost_budgets)").all() as { name: string }[];
        const budgetColNames = budgetCols.map((c) => c.name);
        for (const col of ["id", "scope", "scope_id", "budget_amount", "warning_percent", "critical_percent", "created_at", "updated_at"]) {
          expect(budgetColNames).toContain(col);
        }

        // Verify insert works for both tables
        db.prepare(
          `INSERT INTO agent_costs (session_id, agent_id, bead_id, project_path, input_tokens, output_tokens, total_cost)
           VALUES ('sess-1', 'agent-1', 'adj-001', '/project', 1000, 500, 0.05)`
        ).run();
        const costRow = db.prepare("SELECT * FROM agent_costs WHERE session_id = 'sess-1'").get() as Record<string, unknown>;
        expect(costRow.total_cost).toBe(0.05);
        expect(costRow.recorded_at).toBeDefined();

        db.prepare(
          `INSERT INTO cost_budgets (scope, scope_id, budget_amount, warning_percent, critical_percent)
           VALUES ('session', 'sess-1', 10.0, 80, 100)`
        ).run();
        const budgetRow = db.prepare("SELECT * FROM cost_budgets WHERE scope_id = 'sess-1'").get() as Record<string, unknown>;
        expect(budgetRow.budget_amount).toBe(10.0);
      } finally {
        db.close();
      }
    });
  });
});
