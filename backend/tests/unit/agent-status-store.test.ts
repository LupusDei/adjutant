/**
 * Tests for AgentStatusStore (adj-pyhm4).
 *
 * Persistent last-known agent status snapshot. Uses a real in-memory SQLite
 * database with real migrations applied (adj-067 rule — no hand-crafted mocks).
 *
 * Methods covered: upsert, getAll, get, remove (≥3 tests each).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import {
  createAgentStatusStore,
  type AgentStatusStore,
} from "../../src/services/agent-status-store.js";

let db: Database.Database;
let store: AgentStatusStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createAgentStatusStore(db);
});

afterEach(() => {
  db.close();
});

describe("AgentStatusStore.upsert", () => {
  it("should persist a new snapshot (happy path)", () => {
    store.upsert({
      agentId: "raynor",
      status: "working",
      currentTask: "Fixing adj-ibcy6",
      beadId: "adj-ibcy6",
      projectId: "proj-1",
      updatedAt: "2026-07-08T21:00:00.000Z",
    });
    const row = store.get("raynor");
    expect(row).not.toBeNull();
    expect(row?.status).toBe("working");
    expect(row?.currentTask).toBe("Fixing adj-ibcy6");
    expect(row?.beadId).toBe("adj-ibcy6");
    expect(row?.projectId).toBe("proj-1");
    expect(row?.updatedAt).toBe("2026-07-08T21:00:00.000Z");
  });

  it("should UPDATE in place on conflict (one row per agent)", () => {
    store.upsert({ agentId: "fenix", status: "working", updatedAt: "2026-07-08T20:00:00.000Z" });
    store.upsert({ agentId: "fenix", status: "idle", updatedAt: "2026-07-08T21:00:00.000Z" });
    expect(store.getAll()).toHaveLength(1);
    expect(store.get("fenix")?.status).toBe("idle");
    expect(store.get("fenix")?.updatedAt).toBe("2026-07-08T21:00:00.000Z");
  });

  it("should persist null optional fields when omitted (edge case)", () => {
    store.upsert({ agentId: "nova", status: "idle", updatedAt: "2026-07-08T21:00:00.000Z" });
    const row = store.get("nova");
    expect(row?.currentTask).toBeUndefined();
    expect(row?.beadId).toBeUndefined();
    expect(row?.projectId).toBeUndefined();
  });
});

describe("AgentStatusStore.getAll", () => {
  it("should return every persisted snapshot", () => {
    store.upsert({ agentId: "a", status: "working", updatedAt: "2026-07-08T21:00:00.000Z" });
    store.upsert({ agentId: "b", status: "blocked", updatedAt: "2026-07-08T21:00:00.000Z" });
    expect(store.getAll().map((r) => r.agentId).sort()).toEqual(["a", "b"]);
  });

  it("should return an empty array when nothing is persisted (edge case)", () => {
    expect(store.getAll()).toEqual([]);
  });

  it("should round-trip all fields for hydration", () => {
    store.upsert({
      agentId: "swann",
      status: "blocked",
      currentTask: "waiting on review",
      beadId: "adj-1",
      projectId: "p",
      updatedAt: "2026-07-08T21:00:00.000Z",
    });
    const [row] = store.getAll();
    expect(row).toEqual({
      agentId: "swann",
      status: "blocked",
      currentTask: "waiting on review",
      beadId: "adj-1",
      projectId: "p",
      updatedAt: "2026-07-08T21:00:00.000Z",
    });
  });
});

describe("AgentStatusStore.get", () => {
  it("should return the snapshot for a known agent", () => {
    store.upsert({ agentId: "mengsk", status: "idle", updatedAt: "2026-07-08T21:00:00.000Z" });
    expect(store.get("mengsk")?.agentId).toBe("mengsk");
  });

  it("should return null for an unknown agent (edge case)", () => {
    expect(store.get("ghost")).toBeNull();
  });

  it("should reflect the latest upsert", () => {
    store.upsert({ agentId: "valerian", status: "working", updatedAt: "2026-07-08T20:00:00.000Z" });
    store.upsert({ agentId: "valerian", status: "done", updatedAt: "2026-07-08T21:00:00.000Z" });
    expect(store.get("valerian")?.status).toBe("done");
  });
});

describe("AgentStatusStore.remove", () => {
  it("should delete a persisted snapshot", () => {
    store.upsert({ agentId: "overmind", status: "idle", updatedAt: "2026-07-08T21:00:00.000Z" });
    store.remove("overmind");
    expect(store.get("overmind")).toBeNull();
  });

  it("should be a no-op for an unknown agent (edge case — never throws)", () => {
    expect(() => {
      store.remove("nobody");
    }).not.toThrow();
  });

  it("should only remove the targeted agent", () => {
    store.upsert({ agentId: "keep", status: "working", updatedAt: "2026-07-08T21:00:00.000Z" });
    store.upsert({ agentId: "drop", status: "idle", updatedAt: "2026-07-08T21:00:00.000Z" });
    store.remove("drop");
    expect(store.getAll().map((r) => r.agentId)).toEqual(["keep"]);
  });
});
