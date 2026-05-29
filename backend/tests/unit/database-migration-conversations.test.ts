/**
 * Tests for the unified conversation model migration (adj-164.1.1).
 *
 * Verifies the migration creates the `conversations` and `conversation_members`
 * tables, adds `messages.conversation_id`, creates the expected indices, and is
 * idempotent across repeated `runMigrations` invocations.
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
    `adjutant-conv-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("conversations migration", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create the conversations table with the expected columns", () => {
    expect(tableExists(db, "conversations")).toBe(true);

    const cols = columnNames(db, "conversations");
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "kind",
        "title",
        "archived",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("should enforce the kind discriminator to dm or channel", () => {
    db.prepare(
      "INSERT INTO conversations (id, kind, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))",
    ).run("c-dm", "dm");
    db.prepare(
      "INSERT INTO conversations (id, kind, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))",
    ).run("c-ch", "channel");

    expect(() =>
      db
        .prepare(
          "INSERT INTO conversations (id, kind, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))",
        )
        .run("c-bad", "group"),
    ).toThrow();
  });

  it("should create the conversation_members table with a composite primary key", () => {
    expect(tableExists(db, "conversation_members")).toBe(true);

    const cols = columnNames(db, "conversation_members");
    expect(cols).toEqual(
      expect.arrayContaining([
        "conversation_id",
        "member_id",
        "member_kind",
        "role",
        "joined_at",
        "last_read_at",
      ]),
    );

    // Composite PK on (conversation_id, member_id): a duplicate pair must fail.
    db.prepare(
      "INSERT INTO conversations (id, kind, created_at, updated_at) VALUES ('c1', 'dm', datetime('now'), datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO conversation_members (conversation_id, member_id, member_kind, role, joined_at) VALUES (?, ?, ?, ?, datetime('now'))",
    ).run("c1", "user", "user", "member");

    expect(() =>
      db
        .prepare(
          "INSERT INTO conversation_members (conversation_id, member_id, member_kind, role, joined_at) VALUES (?, ?, ?, ?, datetime('now'))",
        )
        .run("c1", "user", "user", "member"),
    ).toThrow();
  });

  it("should add the conversation_id column to the messages table", () => {
    const cols = columnNames(db, "messages");
    expect(cols).toContain("conversation_id");
  });

  it("should create indices for conversation lookups", () => {
    expect(indexExists(db, "idx_messages_conversation")).toBe(true);
    expect(indexExists(db, "idx_conversation_members_member")).toBe(true);
  });

  it("should be idempotent when migrations run a second time", async () => {
    const { runMigrations } = await import("../../src/services/database.js");
    // Re-running must not throw and must leave the schema intact.
    expect(() => {
      runMigrations(db);
    }).not.toThrow();

    expect(tableExists(db, "conversations")).toBe(true);
    expect(tableExists(db, "conversation_members")).toBe(true);
    expect(columnNames(db, "messages")).toContain("conversation_id");
  });
});
