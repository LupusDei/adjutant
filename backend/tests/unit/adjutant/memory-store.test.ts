import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("Memory Store Migration (011-memory-store.sql)", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("adjutant_learnings table", () => {
    it("should exist after migration", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='adjutant_learnings'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe("adjutant_learnings");
    });

    it("should have all required columns", () => {
      const columns = db.prepare("PRAGMA table_info(adjutant_learnings)").all() as { name: string; type: string; notnull: number }[];
      const colNames = columns.map((c) => c.name);

      expect(colNames).toContain("id");
      expect(colNames).toContain("category");
      expect(colNames).toContain("topic");
      expect(colNames).toContain("content");
      expect(colNames).toContain("source_type");
      expect(colNames).toContain("source_ref");
      expect(colNames).toContain("confidence");
      expect(colNames).toContain("reinforcement_count");
      expect(colNames).toContain("last_applied_at");
      expect(colNames).toContain("last_validated_at");
      expect(colNames).toContain("superseded_by");
      expect(colNames).toContain("created_at");
      expect(colNames).toContain("updated_at");
    });

    it("should enforce NOT NULL on required columns", () => {
      const columns = db.prepare("PRAGMA table_info(adjutant_learnings)").all() as { name: string; notnull: number }[];
      const colMap = new Map(columns.map((c) => [c.name, c.notnull]));

      expect(colMap.get("category")).toBe(1);
      expect(colMap.get("topic")).toBe(1);
      expect(colMap.get("content")).toBe(1);
      expect(colMap.get("source_type")).toBe(1);
      expect(colMap.get("confidence")).toBe(1);
      expect(colMap.get("reinforcement_count")).toBe(1);
      expect(colMap.get("created_at")).toBe(1);
      expect(colMap.get("updated_at")).toBe(1);
    });

    it("should default confidence to 0.5", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("operational", "test-topic", "test content", "user_correction");
      const row = db.prepare("SELECT confidence FROM adjutant_learnings WHERE id = 1").get() as { confidence: number };
      expect(row.confidence).toBe(0.5);
    });

    it("should default reinforcement_count to 1", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("operational", "test-topic", "test content", "user_correction");
      const row = db.prepare("SELECT reinforcement_count FROM adjutant_learnings WHERE id = 1").get() as { reinforcement_count: number };
      expect(row.reinforcement_count).toBe(1);
    });

    it("should auto-set created_at and updated_at", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("operational", "test-topic", "test content", "user_correction");
      const row = db.prepare("SELECT created_at, updated_at FROM adjutant_learnings WHERE id = 1").get() as { created_at: string; updated_at: string };
      expect(row.created_at).toBeTruthy();
      expect(row.updated_at).toBeTruthy();
      expect(new Date(row.created_at).getTime()).not.toBeNaN();
      expect(new Date(row.updated_at).getTime()).not.toBeNaN();
    });

    it("should support self-referential superseded_by FK", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("operational", "topic-a", "old content", "user_correction");
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, superseded_by) VALUES (?, ?, ?, ?, ?)"
      ).run("operational", "topic-a", "new content", "user_correction", null);
      // Update the first row to point to the second
      db.prepare("UPDATE adjutant_learnings SET superseded_by = 2 WHERE id = 1").run();
      const row = db.prepare("SELECT superseded_by FROM adjutant_learnings WHERE id = 1").get() as { superseded_by: number };
      expect(row.superseded_by).toBe(2);
    });
  });

  describe("adjutant_retrospectives table", () => {
    it("should exist after migration", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='adjutant_retrospectives'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe("adjutant_retrospectives");
    });

    it("should have all required columns", () => {
      const columns = db.prepare("PRAGMA table_info(adjutant_retrospectives)").all() as { name: string }[];
      const colNames = columns.map((c) => c.name);

      expect(colNames).toContain("id");
      expect(colNames).toContain("session_date");
      expect(colNames).toContain("beads_closed");
      expect(colNames).toContain("beads_failed");
      expect(colNames).toContain("corrections_received");
      expect(colNames).toContain("agents_used");
      expect(colNames).toContain("avg_bead_time_mins");
      expect(colNames).toContain("went_well");
      expect(colNames).toContain("went_wrong");
      expect(colNames).toContain("action_items");
      expect(colNames).toContain("metrics");
      expect(colNames).toContain("created_at");
    });

    it("should default integer counters to 0", () => {
      db.prepare(
        "INSERT INTO adjutant_retrospectives (session_date) VALUES (?)"
      ).run("2026-03-08");
      const row = db.prepare("SELECT beads_closed, beads_failed, corrections_received, agents_used FROM adjutant_retrospectives WHERE id = 1").get() as {
        beads_closed: number;
        beads_failed: number;
        corrections_received: number;
        agents_used: number;
      };
      expect(row.beads_closed).toBe(0);
      expect(row.beads_failed).toBe(0);
      expect(row.corrections_received).toBe(0);
      expect(row.agents_used).toBe(0);
    });
  });

  describe("adjutant_corrections table", () => {
    it("should exist after migration", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='adjutant_corrections'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe("adjutant_corrections");
    });

    it("should have all required columns", () => {
      const columns = db.prepare("PRAGMA table_info(adjutant_corrections)").all() as { name: string }[];
      const colNames = columns.map((c) => c.name);

      expect(colNames).toContain("id");
      expect(colNames).toContain("message_id");
      expect(colNames).toContain("correction_type");
      expect(colNames).toContain("pattern");
      expect(colNames).toContain("description");
      expect(colNames).toContain("learning_id");
      expect(colNames).toContain("recurrence_count");
      expect(colNames).toContain("last_recurrence_at");
      expect(colNames).toContain("resolved");
      expect(colNames).toContain("created_at");
    });

    it("should default recurrence_count to 0", () => {
      db.prepare(
        "INSERT INTO adjutant_corrections (correction_type, pattern, description) VALUES (?, ?, ?)"
      ).run("prohibition", "dont use any", "Stop using any types");
      const row = db.prepare("SELECT recurrence_count, resolved FROM adjutant_corrections WHERE id = 1").get() as {
        recurrence_count: number;
        resolved: number;
      };
      expect(row.recurrence_count).toBe(0);
      expect(row.resolved).toBe(0);
    });

    it("should support FK to adjutant_learnings", () => {
      // Insert a learning first
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("operational", "topic", "content", "user_correction");

      // Insert a correction referencing it
      db.prepare(
        "INSERT INTO adjutant_corrections (correction_type, pattern, description, learning_id) VALUES (?, ?, ?, ?)"
      ).run("prohibition", "dont use any", "Stop using any types", 1);

      const row = db.prepare("SELECT learning_id FROM adjutant_corrections WHERE id = 1").get() as { learning_id: number };
      expect(row.learning_id).toBe(1);
    });
  });

  describe("FTS5 virtual table", () => {
    it("should create adjutant_learnings_fts virtual table", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='adjutant_learnings_fts'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe("adjutant_learnings_fts");
    });

    it("should sync FTS on INSERT", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("technical", "typescript-strict", "Always use strict mode in TypeScript", "user_correction");

      const ftsResult = db.prepare(
        "SELECT rowid FROM adjutant_learnings_fts WHERE adjutant_learnings_fts MATCH ?"
      ).all("strict mode") as { rowid: number }[];

      expect(ftsResult.length).toBeGreaterThan(0);
      expect(ftsResult[0].rowid).toBe(1);
    });

    it("should sync FTS on UPDATE", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("technical", "old-topic", "old content", "user_correction");

      db.prepare(
        "UPDATE adjutant_learnings SET content = ?, topic = ? WHERE id = 1"
      ).run("updated content about testing", "testing");

      // Old content should not match
      const oldResult = db.prepare(
        "SELECT rowid FROM adjutant_learnings_fts WHERE adjutant_learnings_fts MATCH ?"
      ).all("old content") as { rowid: number }[];
      expect(oldResult.length).toBe(0);

      // New content should match
      const newResult = db.prepare(
        "SELECT rowid FROM adjutant_learnings_fts WHERE adjutant_learnings_fts MATCH ?"
      ).all("testing") as { rowid: number }[];
      expect(newResult.length).toBeGreaterThan(0);
    });

    it("should sync FTS on DELETE", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("technical", "delete-test", "content to be deleted", "user_correction");

      db.prepare("DELETE FROM adjutant_learnings WHERE id = 1").run();

      const result = db.prepare(
        "SELECT rowid FROM adjutant_learnings_fts WHERE adjutant_learnings_fts MATCH ?"
      ).all("deleted") as { rowid: number }[];
      expect(result.length).toBe(0);
    });
  });

  describe("FTS5 content-sync read behavior (adj-obbm)", () => {
    it("should return full learning data through FTS5 join", () => {
      // Insert a learning
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("technical", "typescript-strict", "Always use strict mode in TypeScript", "user_correction");

      // Query via FTS5 join and verify we get full learning data back
      const rows = db.prepare(`
        SELECT l.* FROM adjutant_learnings l
        INNER JOIN adjutant_learnings_fts fts ON l.id = fts.rowid
        WHERE adjutant_learnings_fts MATCH ?
        AND l.superseded_by IS NULL
        ORDER BY rank
        LIMIT 10
      `).all("strict mode") as { id: number; category: string; topic: string; content: string; source_type: string; confidence: number }[];

      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(1);
      expect(rows[0].category).toBe("technical");
      expect(rows[0].topic).toBe("typescript-strict");
      expect(rows[0].content).toBe("Always use strict mode in TypeScript");
      expect(rows[0].source_type).toBe("user_correction");
      expect(rows[0].confidence).toBe(0.5);
    });

    it("should return multiple matches ranked by relevance", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("technical", "typescript", "Use strict mode always", "user_correction");
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("operational", "workflow", "Check status before work", "user_correction");
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("technical", "strict-rules", "Strict typing prevents bugs", "user_correction");

      const rows = db.prepare(`
        SELECT l.id FROM adjutant_learnings l
        INNER JOIN adjutant_learnings_fts fts ON l.id = fts.rowid
        WHERE adjutant_learnings_fts MATCH ?
        ORDER BY rank
      `).all("strict") as { id: number }[];

      // Should find the two entries mentioning "strict"
      expect(rows.length).toBe(2);
    });

    it("should not return data from deleted learnings via FTS5", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("technical", "deleted-test", "unique searchable content xyz", "user_correction");

      // Verify it's found
      let found = db.prepare(
        "SELECT rowid FROM adjutant_learnings_fts WHERE adjutant_learnings_fts MATCH ?"
      ).all("xyz") as { rowid: number }[];
      expect(found.length).toBe(1);

      // Delete and verify it's gone from FTS
      db.prepare("DELETE FROM adjutant_learnings WHERE id = 1").run();
      found = db.prepare(
        "SELECT rowid FROM adjutant_learnings_fts WHERE adjutant_learnings_fts MATCH ?"
      ).all("xyz") as { rowid: number }[];
      expect(found.length).toBe(0);
    });
  });

  describe("schema constraints (migration 013)", () => {
    it("should reject empty category (adj-3kyx)", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
        ).run("", "topic", "content", "user_correction");
      }).toThrow();
    });

    it("should reject empty topic (adj-3kyx)", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
        ).run("operational", "", "content", "user_correction");
      }).toThrow();
    });

    it("should reject empty content (adj-3kyx)", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
        ).run("operational", "topic", "", "user_correction");
      }).toThrow();
    });

    it("should reject confidence below 0 (adj-fz5d)", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence) VALUES (?, ?, ?, ?, ?)"
        ).run("operational", "topic", "content", "user_correction", -0.1);
      }).toThrow();
    });

    it("should reject confidence above 1 (adj-fz5d)", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence) VALUES (?, ?, ?, ?, ?)"
        ).run("operational", "topic", "content", "user_correction", 1.5);
      }).toThrow();
    });

    it("should allow confidence at boundaries 0 and 1 (adj-fz5d)", () => {
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence) VALUES (?, ?, ?, ?, ?)"
      ).run("operational", "topic-zero", "content zero", "user_correction", 0.0);
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type, confidence) VALUES (?, ?, ?, ?, ?)"
      ).run("operational", "topic-one", "content one", "user_correction", 1.0);

      const rows = db.prepare("SELECT confidence FROM adjutant_learnings ORDER BY id").all() as { confidence: number }[];
      expect(rows[0].confidence).toBe(0.0);
      expect(rows[1].confidence).toBe(1.0);
    });

    it("should reject duplicate session_date in retrospectives (adj-bcsy)", () => {
      db.prepare(
        "INSERT INTO adjutant_retrospectives (session_date) VALUES (?)"
      ).run("2026-03-08");

      expect(() => {
        db.prepare(
          "INSERT INTO adjutant_retrospectives (session_date) VALUES (?)"
        ).run("2026-03-08");
      }).toThrow();
    });

    it("should allow different session_dates in retrospectives (adj-bcsy)", () => {
      db.prepare(
        "INSERT INTO adjutant_retrospectives (session_date) VALUES (?)"
      ).run("2026-03-08");
      db.prepare(
        "INSERT INTO adjutant_retrospectives (session_date) VALUES (?)"
      ).run("2026-03-09");

      const count = db.prepare("SELECT COUNT(*) as cnt FROM adjutant_retrospectives").get() as { cnt: number };
      expect(count.cnt).toBe(2);
    });

    it("should SET NULL on superseded_by when referenced learning is deleted (adj-hw2m)", () => {
      // Insert two learnings
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("operational", "old", "old content", "user_correction");
      db.prepare(
        "INSERT INTO adjutant_learnings (category, topic, content, source_type) VALUES (?, ?, ?, ?)"
      ).run("operational", "new", "new content", "user_correction");

      // Set superseded_by on learning 1 -> 2
      db.prepare("UPDATE adjutant_learnings SET superseded_by = 2 WHERE id = 1").run();

      // Verify FK is set
      const before = db.prepare("SELECT superseded_by FROM adjutant_learnings WHERE id = 1").get() as { superseded_by: number | null };
      expect(before.superseded_by).toBe(2);

      // Delete learning 2 (the target of superseded_by)
      db.prepare("DELETE FROM adjutant_learnings WHERE id = 2").run();

      // superseded_by should be NULL now
      const after = db.prepare("SELECT superseded_by FROM adjutant_learnings WHERE id = 1").get() as { superseded_by: number | null };
      expect(after.superseded_by).toBeNull();
    });
  });

  describe("indexes", () => {
    it("should create index on learnings.category", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_adjutant_learnings_category'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
    });

    it("should create index on learnings.topic", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_adjutant_learnings_topic'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
    });

    it("should create index on learnings.confidence", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_adjutant_learnings_confidence'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
    });

    it("should create index on corrections.learning_id", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_adjutant_corrections_learning_id'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
    });

    it("should create index on retrospectives.session_date", () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_adjutant_retrospectives_session_date'"
      ).get() as { name: string } | undefined;
      expect(row).toBeDefined();
    });
  });
});
