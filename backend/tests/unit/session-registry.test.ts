/**
 * Unit tests for SQL-backed SessionRegistry (adj-110.3.2).
 *
 * Uses an in-memory SQLite database with the managed_sessions table
 * to verify that SessionRegistry persists and loads correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Create in-memory database for each test
let testDb: Database.Database;

vi.mock("../../src/services/database.js", () => ({
  getDatabase: () => testDb,
  createDatabase: () => testDb,
  runMigrations: () => {},
}));

import {
  SessionRegistry,
  getSessionRegistry,
  resetSessionRegistry,
} from "../../src/services/session-registry.js";

/** Create an in-memory SQLite database with the managed_sessions table. */
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS managed_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      tmux_session TEXT NOT NULL,
      tmux_pane TEXT NOT NULL,
      project_path TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'swarm',
      status TEXT NOT NULL DEFAULT 'idle',
      workspace_type TEXT NOT NULL DEFAULT 'primary',
      pipe_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_activity TEXT NOT NULL
    )
  `);
  return db;
}

/** Insert a session row directly into the DB for load() tests. */
function insertSession(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    name: string;
    tmux_session: string;
    tmux_pane: string;
    project_path: string;
    mode: string;
    status: string;
    workspace_type: string;
    pipe_active: number;
    created_at: string;
    last_activity: string;
  }> = {},
): void {
  const defaults = {
    id: "sess-001",
    name: "agent-alpha",
    tmux_session: "adj_alpha",
    tmux_pane: "adj_alpha",
    project_path: "/home/user/project",
    mode: "swarm",
    status: "working",
    workspace_type: "primary",
    pipe_active: 0,
    created_at: "2026-03-15T10:00:00.000Z",
    last_activity: "2026-03-15T12:00:00.000Z",
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO managed_sessions (id, name, tmux_session, tmux_pane, project_path, mode, status, workspace_type, pipe_active, created_at, last_activity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.name,
    row.tmux_session,
    row.tmux_pane,
    row.project_path,
    row.mode,
    row.status,
    row.workspace_type,
    row.pipe_active,
    row.created_at,
    row.last_activity,
  );
}

describe("SessionRegistry (SQL-backed)", () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDb();
    registry = new SessionRegistry(testDb);
    resetSessionRegistry();
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe("singleton", () => {
    it("should return the same instance on subsequent calls", () => {
      const r1 = getSessionRegistry();
      const r2 = getSessionRegistry();
      expect(r1).toBe(r2);
    });

    it("should return a new instance after reset", () => {
      const r1 = getSessionRegistry();
      resetSessionRegistry();
      const r2 = getSessionRegistry();
      expect(r1).not.toBe(r2);
    });
  });

  // ==========================================================================
  // Create
  // ==========================================================================

  describe("create", () => {
    it("should create a session with required fields and insert into DB", () => {
      const session = registry.create({
        name: "test-agent",
        tmuxSession: "adj-test-agent",
        projectPath: "/home/user/project",
      });

      expect(session.id).toBeDefined();
      expect(session.name).toBe("test-agent");
      expect(session.tmuxSession).toBe("adj-test-agent");
      expect(session.projectPath).toBe("/home/user/project");
      expect(session.mode).toBe("swarm");
      expect(session.status).toBe("idle");
      expect(session.workspaceType).toBe("primary");
      expect(session.connectedClients.size).toBe(0);
      expect(session.outputBuffer).toEqual([]);
      expect(session.pipeActive).toBe(false);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);

      // Verify DB row was created
      const rows = testDb.prepare("SELECT * FROM managed_sessions").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(session.id);
      expect(rows[0].name).toBe("test-agent");
      expect(rows[0].tmux_session).toBe("adj-test-agent");
      expect(rows[0].status).toBe("idle");
    });

    it("should default tmuxPane to tmuxSession name when not provided", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "my-session",
        projectPath: "/tmp",
      });
      expect(session.tmuxPane).toBe("my-session");
    });

    it("should use provided optional fields", () => {
      const session = registry.create({
        name: "swarm-worker",
        tmuxSession: "adj-swarm-1",
        tmuxPane: "adj-swarm-1:1.2",
        projectPath: "/project",
        mode: "swarm",
        workspaceType: "worktree",
      });

      expect(session.tmuxPane).toBe("adj-swarm-1:1.2");
      expect(session.mode).toBe("swarm");
      expect(session.workspaceType).toBe("worktree");

      // Verify DB has the right workspace_type
      const row = testDb.prepare("SELECT workspace_type FROM managed_sessions WHERE id = ?").get(session.id) as { workspace_type: string };
      expect(row.workspace_type).toBe("worktree");
    });

    it("should assign unique IDs to different sessions", () => {
      const s1 = registry.create({
        name: "agent-1",
        tmuxSession: "adj-1",
        projectPath: "/tmp",
      });
      const s2 = registry.create({
        name: "agent-2",
        tmuxSession: "adj-2",
        projectPath: "/tmp",
      });
      expect(s1.id).not.toBe(s2.id);
    });

    it("should increment session count", () => {
      expect(registry.size).toBe(0);
      registry.create({ name: "a", tmuxSession: "adj-a", projectPath: "/tmp" });
      expect(registry.size).toBe(1);
      registry.create({ name: "b", tmuxSession: "adj-b", projectPath: "/tmp" });
      expect(registry.size).toBe(2);
    });
  });

  // ==========================================================================
  // Get / Lookup
  // ==========================================================================

  describe("get", () => {
    it("should return a session by ID", () => {
      const created = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      expect(registry.get(created.id)).toBe(created);
    });

    it("should return undefined for unknown ID", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return empty array when no sessions", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("should return all registered sessions", () => {
      registry.create({ name: "a", tmuxSession: "adj-a", projectPath: "/tmp" });
      registry.create({ name: "b", tmuxSession: "adj-b", projectPath: "/tmp" });
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.name).sort()).toEqual(["a", "b"]);
    });
  });

  describe("findByTmuxSession", () => {
    it("should find session by tmux session name", () => {
      const created = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      expect(registry.findByTmuxSession("adj-test")).toBe(created);
    });

    it("should return undefined when not found", () => {
      expect(registry.findByTmuxSession("nonexistent")).toBeUndefined();
    });
  });

  describe("findByName", () => {
    it("should find sessions matching name", () => {
      registry.create({ name: "agent", tmuxSession: "adj-1", projectPath: "/tmp" });
      // The UNIQUE constraint on name means we can't insert duplicate names.
      // findByName returns an array because the in-memory filter allows it,
      // but with SQL uniqueness we'll only ever get 0 or 1.
      const found = registry.findByName("agent");
      expect(found).toHaveLength(1);
    });

    it("should return empty array when no match", () => {
      expect(registry.findByName("ghost")).toEqual([]);
    });
  });

  // ==========================================================================
  // Update Status
  // ==========================================================================

  describe("updateStatus", () => {
    it("should update session status in Map and DB", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const updated = registry.updateStatus(session.id, "working");
      expect(updated).toBe(true);
      expect(registry.get(session.id)?.status).toBe("working");

      // Verify DB was updated
      const row = testDb.prepare("SELECT status FROM managed_sessions WHERE id = ?").get(session.id) as { status: string };
      expect(row.status).toBe("working");
    });

    it("should update lastActivity timestamp in DB", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      const beforeRow = testDb.prepare("SELECT last_activity FROM managed_sessions WHERE id = ?").get(session.id) as { last_activity: string };

      // Small delay to ensure time advances
      await new Promise((r) => setTimeout(r, 10));

      registry.updateStatus(session.id, "working");

      const afterRow = testDb.prepare("SELECT last_activity FROM managed_sessions WHERE id = ?").get(session.id) as { last_activity: string };
      expect(afterRow.last_activity).not.toBe(beforeRow.last_activity);
    });

    it("should return false for unknown session", () => {
      expect(registry.updateStatus("unknown", "idle")).toBe(false);
    });
  });

  // ==========================================================================
  // Client Management (runtime-only)
  // ==========================================================================

  describe("client management", () => {
    it("should add a client to a session", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      expect(registry.addClient(session.id, "client-1")).toBe(true);
      expect(session.connectedClients.has("client-1")).toBe(true);
    });

    it("should remove a client from a session", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.addClient(session.id, "client-1");
      expect(registry.removeClient(session.id, "client-1")).toBe(true);
      expect(session.connectedClients.has("client-1")).toBe(false);
    });

    it("should return false for unknown session", () => {
      expect(registry.addClient("unknown", "c1")).toBe(false);
      expect(registry.removeClient("unknown", "c1")).toBe(false);
    });
  });

  // ==========================================================================
  // Output Buffer (Ring Buffer)
  // ==========================================================================

  describe("output buffer", () => {
    it("should append lines to output buffer", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.appendOutput(session.id, "line 1");
      registry.appendOutput(session.id, "line 2");
      expect(registry.getOutputBuffer(session.id)).toEqual(["line 1", "line 2"]);
    });

    it("should cap buffer at 1000 lines", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      for (let i = 0; i < 1050; i++) {
        registry.appendOutput(session.id, `line ${i}`);
      }

      const buffer = registry.getOutputBuffer(session.id)!;
      expect(buffer).toHaveLength(1000);
      expect(buffer[0]).toBe("line 50");
      expect(buffer[999]).toBe("line 1049");
    });

    it("should return a copy of the buffer", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.appendOutput(session.id, "line 1");
      const buf1 = registry.getOutputBuffer(session.id)!;
      buf1.push("extra");
      expect(registry.getOutputBuffer(session.id)).toHaveLength(1);
    });

    it("should clear output buffer", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.appendOutput(session.id, "line 1");
      expect(registry.clearOutputBuffer(session.id)).toBe(true);
      expect(registry.getOutputBuffer(session.id)).toEqual([]);
    });

    it("should return undefined for unknown session", () => {
      expect(registry.getOutputBuffer("unknown")).toBeUndefined();
    });

    it("should return false when appending to unknown session", () => {
      expect(registry.appendOutput("unknown", "data")).toBe(false);
    });
  });

  // ==========================================================================
  // Remove
  // ==========================================================================

  describe("remove", () => {
    it("should remove from Map and delete from DB", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      expect(registry.remove(session.id)).toBe(true);
      expect(registry.get(session.id)).toBeUndefined();
      expect(registry.size).toBe(0);

      // Verify DB row was deleted
      const count = (testDb.prepare("SELECT COUNT(*) as cnt FROM managed_sessions").get() as { cnt: number }).cnt;
      expect(count).toBe(0);
    });

    it("should return false for unknown session", () => {
      expect(registry.remove("unknown")).toBe(false);
    });
  });

  // ==========================================================================
  // Persistence — save()
  // ==========================================================================

  describe("save()", () => {
    it("should persist current in-memory state to DB", async () => {
      const session = registry.create({
        name: "agent-save",
        tmuxSession: "adj-save",
        projectPath: "/home/user/project",
      });

      // Mutate in-memory state directly
      session.status = "working";
      session.pipeActive = true;

      await registry.save();

      // Verify DB reflects the mutations
      const row = testDb.prepare("SELECT * FROM managed_sessions WHERE id = ?").get(session.id) as Record<string, unknown>;
      expect(row.status).toBe("working");
      expect(row.pipe_active).toBe(1);
    });

    it("should handle empty registry (no crash)", async () => {
      await registry.save();
      const rows = testDb.prepare("SELECT * FROM managed_sessions").all();
      expect(rows).toHaveLength(0);
    });

    it("should remove stale DB rows not in memory", async () => {
      // Insert a row directly into DB (simulating leftover from previous run)
      insertSession(testDb, { id: "stale-1", name: "stale-agent" });

      // Create a fresh session in registry
      registry.create({
        name: "fresh-agent",
        tmuxSession: "adj-fresh",
        projectPath: "/tmp",
      });

      await registry.save();

      const rows = testDb.prepare("SELECT * FROM managed_sessions").all() as Array<{ name: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("fresh-agent");
    });
  });

  // ==========================================================================
  // Persistence — load()
  // ==========================================================================

  describe("load()", () => {
    it("should hydrate from DB with status set to 'offline'", async () => {
      insertSession(testDb, { id: "sess-001", name: "agent-alpha", status: "working" });
      insertSession(testDb, { id: "sess-002", name: "agent-beta", status: "idle" });

      const count = await registry.load();
      expect(count).toBe(2);
      expect(registry.size).toBe(2);

      for (const s of registry.getAll()) {
        expect(s.status).toBe("offline");
      }
    });

    it("should parse dates correctly from DB", async () => {
      insertSession(testDb, {
        id: "sess-dates",
        name: "agent-dates",
        created_at: "2026-03-15T10:00:00.000Z",
        last_activity: "2026-03-15T12:30:00.000Z",
      });

      await registry.load();
      const session = registry.get("sess-dates");
      expect(session).toBeDefined();
      expect(session!.createdAt).toBeInstanceOf(Date);
      expect(session!.createdAt.toISOString()).toBe("2026-03-15T10:00:00.000Z");
      expect(session!.lastActivity).toBeInstanceOf(Date);
      expect(session!.lastActivity.toISOString()).toBe("2026-03-15T12:30:00.000Z");
    });

    it("should map snake_case columns to camelCase fields", async () => {
      insertSession(testDb, {
        id: "sess-case",
        name: "agent-case",
        tmux_session: "adj_case_sess",
        tmux_pane: "adj_case_pane",
        project_path: "/path/to/project",
        workspace_type: "worktree",
      });

      await registry.load();
      const session = registry.get("sess-case")!;
      expect(session.tmuxSession).toBe("adj_case_sess");
      expect(session.tmuxPane).toBe("adj_case_pane");
      expect(session.projectPath).toBe("/path/to/project");
      expect(session.workspaceType).toBe("worktree");
    });

    it("should initialize runtime-only fields", async () => {
      insertSession(testDb, { id: "sess-runtime", name: "agent-runtime", pipe_active: 1 });

      await registry.load();
      const session = registry.get("sess-runtime")!;
      expect(session.connectedClients).toBeInstanceOf(Set);
      expect(session.connectedClients.size).toBe(0);
      expect(session.outputBuffer).toEqual([]);
      expect(session.pipeActive).toBe(false); // reset on load
    });

    it("should return 0 when DB has no sessions", async () => {
      const count = await registry.load();
      expect(count).toBe(0);
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Runtime-only fields NOT in DB
  // ==========================================================================

  describe("runtime-only fields", () => {
    it("connectedClients should not be stored in DB", () => {
      const session = registry.create({
        name: "test-runtime",
        tmuxSession: "adj-runtime",
        projectPath: "/tmp",
      });
      session.connectedClients.add("client-1");

      const row = testDb.prepare("SELECT * FROM managed_sessions WHERE id = ?").get(session.id) as Record<string, unknown>;
      expect(row).not.toHaveProperty("connected_clients");
      expect(row).not.toHaveProperty("connectedClients");
    });

    it("outputBuffer should not be stored in DB", () => {
      const session = registry.create({
        name: "test-buffer",
        tmuxSession: "adj-buffer",
        projectPath: "/tmp",
      });
      session.outputBuffer.push("line 1");

      const row = testDb.prepare("SELECT * FROM managed_sessions WHERE id = ?").get(session.id) as Record<string, unknown>;
      expect(row).not.toHaveProperty("output_buffer");
      expect(row).not.toHaveProperty("outputBuffer");
    });
  });

  // ==========================================================================
  // Round-trip: create → save → load
  // ==========================================================================

  describe("round-trip persistence", () => {
    it("should survive save + load into a new registry", async () => {
      registry.create({
        name: "persistent",
        tmuxSession: "adj-persistent",
        projectPath: "/project",
        workspaceType: "worktree",
      });

      await registry.save();

      // Create a new registry pointing at the same DB
      const newRegistry = new SessionRegistry(testDb);
      const loaded = await newRegistry.load();

      expect(loaded).toBe(1);
      const sessions = newRegistry.getAll();
      expect(sessions[0].name).toBe("persistent");
      expect(sessions[0].status).toBe("offline");
      expect(sessions[0].workspaceType).toBe("worktree");
      expect(sessions[0].connectedClients.size).toBe(0);
      expect(sessions[0].outputBuffer).toEqual([]);
      expect(sessions[0].createdAt).toBeInstanceOf(Date);
      expect(sessions[0].lastActivity).toBeInstanceOf(Date);
    });
  });
});
