/**
 * Tests for the agent_questions migration (adj-181.1.1 / adj-181.1.2).
 *
 * Verifies the migration creates the `agent_questions` table with the correct
 * columns, CHECK constraints, and four indexes after `runMigrations` runs.
 * Also verifies idempotency on a second invocation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-questions-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: string | null;
}

function tableExists(database: Database.Database, name: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return row !== undefined;
}

function columnNames(database: Database.Database, table: string): string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.map((r) => r.name);
}

function indexExists(database: Database.Database, name: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name);
  return row !== undefined;
}

describe("agent_questions migration", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create the agent_questions table", () => {
    expect(tableExists(db, "agent_questions")).toBe(true);
  });

  it("should create the agent_questions table with the expected columns", () => {
    const cols = columnNames(db, "agent_questions");
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "project_id",
        "agent_id",
        "body",
        "context",
        "category",
        "suggested_options",
        "urgency",
        "status",
        "answer_body",
        "chosen_option",
        "answered_by",
        "bead_id",
        "conversation_id",
        "created_at",
        "answered_at",
        "updated_at",
      ]),
    );
  });

  it("should enforce urgency CHECK constraint to low|normal|high|blocking", () => {
    // Valid urgencies should succeed
    expect(() =>
      db
        .prepare(
          "INSERT INTO agent_questions (id, project_id, agent_id, body, urgency, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("q-1", "proj-1", "agent-1", "Question body", "normal", "open"),
    ).not.toThrow();

    expect(() =>
      db
        .prepare(
          "INSERT INTO agent_questions (id, project_id, agent_id, body, urgency, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("q-2", "proj-1", "agent-1", "Question body", "blocking", "open"),
    ).not.toThrow();

    // Invalid urgency should be rejected
    expect(() =>
      db
        .prepare(
          "INSERT INTO agent_questions (id, project_id, agent_id, body, urgency, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("q-bad", "proj-1", "agent-1", "Question body", "critical", "open"),
    ).toThrow();
  });

  it("should enforce status CHECK constraint to open|answered|dismissed", () => {
    // Valid statuses should succeed
    expect(() =>
      db
        .prepare(
          "INSERT INTO agent_questions (id, project_id, agent_id, body, urgency, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("q-3", "proj-1", "agent-1", "Question body", "normal", "answered"),
    ).not.toThrow();

    expect(() =>
      db
        .prepare(
          "INSERT INTO agent_questions (id, project_id, agent_id, body, urgency, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("q-4", "proj-1", "agent-1", "Question body", "normal", "dismissed"),
    ).not.toThrow();

    // Invalid status should be rejected
    expect(() =>
      db
        .prepare(
          "INSERT INTO agent_questions (id, project_id, agent_id, body, urgency, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("q-bad2", "proj-1", "agent-1", "Question body", "normal", "closed"),
    ).toThrow();
  });

  it("should default urgency to normal and status to open", () => {
    db.prepare(
      "INSERT INTO agent_questions (id, project_id, agent_id, body) VALUES (?, ?, ?, ?)",
    ).run("q-defaults", "proj-1", "agent-1", "What should I do?");

    const row = db
      .prepare("SELECT urgency, status FROM agent_questions WHERE id = ?")
      .get("q-defaults") as { urgency: string; status: string };

    expect(row.urgency).toBe("normal");
    expect(row.status).toBe("open");
  });

  it("should require project_id, agent_id, and body (NOT NULL)", () => {
    expect(() =>
      db
        .prepare("INSERT INTO agent_questions (id, body, urgency, status) VALUES (?, ?, ?, ?)")
        .run("q-no-proj", "body", "normal", "open"),
    ).toThrow();

    expect(() =>
      db
        .prepare("INSERT INTO agent_questions (id, project_id, urgency, status) VALUES (?, ?, ?, ?)")
        .run("q-no-agent", "proj-1", "normal", "open"),
    ).toThrow();
  });

  it("should create the idx_agent_questions_status index", () => {
    expect(indexExists(db, "idx_agent_questions_status")).toBe(true);
  });

  it("should create the idx_agent_questions_project index", () => {
    expect(indexExists(db, "idx_agent_questions_project")).toBe(true);
  });

  it("should create the idx_agent_questions_category index", () => {
    expect(indexExists(db, "idx_agent_questions_category")).toBe(true);
  });

  it("should create the idx_agent_questions_agent index", () => {
    expect(indexExists(db, "idx_agent_questions_agent")).toBe(true);
  });

  it("should be idempotent when migrations run a second time", async () => {
    const { runMigrations } = await import("../../src/services/database.js");
    expect(() => {
      runMigrations(db);
    }).not.toThrow();

    expect(tableExists(db, "agent_questions")).toBe(true);
    expect(indexExists(db, "idx_agent_questions_status")).toBe(true);
  });
});
