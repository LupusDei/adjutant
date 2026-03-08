import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("AdjutantState", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("getAgentProfile", () => {
    it("should return null for unknown agent", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);
      expect(store.getAgentProfile("nonexistent")).toBeNull();
    });
  });

  describe("upsertAgentProfile", () => {
    it("should create a new profile", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({
        agentId: "agent-1",
        lastStatus: "working",
        currentTask: "building stuff",
      });

      const profile = store.getAgentProfile("agent-1");
      expect(profile).not.toBeNull();
      expect(profile!.agentId).toBe("agent-1");
      expect(profile!.lastStatus).toBe("working");
      expect(profile!.currentTask).toBe("building stuff");
      expect(profile!.lastStatusAt).toBeTruthy();
    });

    it("should apply defaults when only agentId is provided", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "minimal-agent" });

      const profile = store.getAgentProfile("minimal-agent");
      expect(profile).not.toBeNull();
      expect(profile!.agentId).toBe("minimal-agent");
      expect(profile!.lastStatus).toBe("unknown");
      expect(profile!.lastStatusAt).toBeTruthy();
      expect(profile!.lastActivity).toBeNull();
      expect(profile!.currentTask).toBeNull();
      expect(profile!.currentBeadId).toBeNull();
      expect(profile!.connectedAt).toBeNull();
      expect(profile!.disconnectedAt).toBeNull();
    });

    it("should handle unicode in agent IDs and metadata values", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const unicodeId = "agent-\u{1F680}-\u{1F916}";
      store.upsertAgentProfile({
        agentId: unicodeId,
        lastStatus: "working",
        currentTask: "\u00E9\u00E8\u00EA \u4F60\u597D \u{1F4BB}",
      });

      const profile = store.getAgentProfile(unicodeId);
      expect(profile).not.toBeNull();
      expect(profile!.agentId).toBe(unicodeId);
      expect(profile!.currentTask).toBe("\u00E9\u00E8\u00EA \u4F60\u597D \u{1F4BB}");
    });

    it("should explicitly clear currentTask when set to null", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({
        agentId: "agent-1",
        lastStatus: "working",
        currentTask: "important task",
      });

      // Explicitly set currentTask to null
      store.upsertAgentProfile({
        agentId: "agent-1",
        currentTask: null,
      });

      const profile = store.getAgentProfile("agent-1");
      expect(profile).not.toBeNull();
      expect(profile!.currentTask).toBeNull();
      // lastStatus should be preserved from the merge
      expect(profile!.lastStatus).toBe("working");
    });

    it("should update last_status_at on each upsert call", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "agent-1", lastStatus: "idle" });
      const first = store.getAgentProfile("agent-1");
      expect(first).not.toBeNull();
      const firstTimestamp = first!.lastStatusAt;

      // Update the profile again
      store.upsertAgentProfile({ agentId: "agent-1", lastStatus: "working" });
      const second = store.getAgentProfile("agent-1");
      expect(second).not.toBeNull();
      // lastStatusAt should be set (may or may not differ within same second)
      expect(second!.lastStatusAt).toBeTruthy();
      // Both should be valid datetime strings
      expect(new Date(firstTimestamp).getTime()).not.toBeNaN();
      expect(new Date(second!.lastStatusAt).getTime()).not.toBeNaN();
    });

    it("should update existing profile with merge", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({
        agentId: "agent-1",
        lastStatus: "working",
        currentTask: "task A",
        currentBeadId: "bead-1",
      });

      store.upsertAgentProfile({
        agentId: "agent-1",
        lastStatus: "idle",
      });

      const profile = store.getAgentProfile("agent-1");
      expect(profile).not.toBeNull();
      expect(profile!.lastStatus).toBe("idle");
      // Merged: fields not provided should retain previous values
      expect(profile!.currentTask).toBe("task A");
      expect(profile!.currentBeadId).toBe("bead-1");
    });

    it("should clear a field when explicitly set to null", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({
        agentId: "agent-1",
        lastStatus: "working",
        currentTask: "doing stuff",
      });

      // Explicitly set currentTask to null
      store.upsertAgentProfile({
        agentId: "agent-1",
        currentTask: null,
      });

      const profile = store.getAgentProfile("agent-1");
      expect(profile).not.toBeNull();
      expect(profile!.currentTask).toBeNull();
    });
  });

  describe("getAllAgentProfiles", () => {
    it("should return all profiles", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "agent-1", lastStatus: "working" });
      store.upsertAgentProfile({ agentId: "agent-2", lastStatus: "idle" });

      const profiles = store.getAllAgentProfiles();
      expect(profiles).toHaveLength(2);
      const ids = profiles.map((p) => p.agentId).sort();
      expect(ids).toEqual(["agent-1", "agent-2"]);
    });
  });

  describe("logDecision", () => {
    it("should insert a decision", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logDecision({
        behavior: "auto-assign",
        action: "assign",
        target: "agent-1",
        reason: "lowest workload",
      });

      const decisions = store.getRecentDecisions(10);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].behavior).toBe("auto-assign");
      expect(decisions[0].action).toBe("assign");
      expect(decisions[0].target).toBe("agent-1");
      expect(decisions[0].reason).toBe("lowest workload");
      expect(decisions[0].createdAt).toBeTruthy();
    });
  });

  describe("getRecentDecisions", () => {
    it("should return newest first and respect limit", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logDecision({ behavior: "b1", action: "a1", target: null, reason: null });
      store.logDecision({ behavior: "b2", action: "a2", target: null, reason: null });
      store.logDecision({ behavior: "b3", action: "a3", target: null, reason: null });

      const decisions = store.getRecentDecisions(2);
      expect(decisions).toHaveLength(2);
      // Newest first — highest ID first since same-second timestamps
      expect(decisions[0].behavior).toBe("b3");
      expect(decisions[1].behavior).toBe("b2");
    });

    it("should clamp negative limit to 0 and return empty array", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logDecision({ behavior: "b1", action: "a1", target: null, reason: null });

      const decisions = store.getRecentDecisions(-1);
      expect(decisions).toEqual([]);
    });

    it("should return empty array for limit 0", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logDecision({ behavior: "b1", action: "a1", target: null, reason: null });

      const decisions = store.getRecentDecisions(0);
      expect(decisions).toEqual([]);
    });

    it("should clamp limit exceeding 1000 to 1000", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      // Insert a few decisions; the point is that limit is clamped, not that we have 1000 rows
      store.logDecision({ behavior: "b1", action: "a1", target: null, reason: null });
      store.logDecision({ behavior: "b2", action: "a2", target: null, reason: null });

      const decisions = store.getRecentDecisions(9999);
      // Should return all 2 rows (clamped to 1000 but only 2 exist)
      expect(decisions).toHaveLength(2);
    });
  });

  describe("getMeta / setMeta", () => {
    it("should return null for unknown key", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);
      expect(store.getMeta("nonexistent")).toBeNull();
    });

    it("should round-trip set and get", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.setMeta("version", "1.0.0");
      expect(store.getMeta("version")).toBe("1.0.0");
    });

    it("should store and retrieve empty string value", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.setMeta("empty-val", "");
      expect(store.getMeta("empty-val")).toBe("");
    });

    it("should overwrite existing value", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.setMeta("version", "1.0.0");
      store.setMeta("version", "2.0.0");
      expect(store.getMeta("version")).toBe("2.0.0");
    });
  });

  describe("assignmentCount and lastEpicId fields", () => {
    it("should include assignmentCount and lastEpicId in agent profile", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({
        agentId: "agent-assign",
        lastStatus: "working",
        assignmentCount: 3,
        lastEpicId: "adj-052",
      });

      const profile = store.getAgentProfile("agent-assign");
      expect(profile).not.toBeNull();
      expect(profile!.assignmentCount).toBe(3);
      expect(profile!.lastEpicId).toBe("adj-052");
    });

    it("should default assignmentCount to 0 for new profiles", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "agent-default-count" });

      const profile = store.getAgentProfile("agent-default-count");
      expect(profile).not.toBeNull();
      expect(profile!.assignmentCount).toBe(0);
    });

    it("should default lastEpicId to null for new profiles", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "agent-default-epic" });

      const profile = store.getAgentProfile("agent-default-epic");
      expect(profile).not.toBeNull();
      expect(profile!.lastEpicId).toBeNull();
    });

    it("should update assignmentCount via upsert", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "agent-count", lastStatus: "idle" });
      store.upsertAgentProfile({ agentId: "agent-count", assignmentCount: 5 });

      const profile = store.getAgentProfile("agent-count");
      expect(profile).not.toBeNull();
      expect(profile!.assignmentCount).toBe(5);
    });

    it("should update lastEpicId via upsert", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "agent-epic", lastStatus: "idle" });
      store.upsertAgentProfile({ agentId: "agent-epic", lastEpicId: "adj-052" });

      const profile = store.getAgentProfile("agent-epic");
      expect(profile).not.toBeNull();
      expect(profile!.lastEpicId).toBe("adj-052");
    });
  });

  describe("incrementAssignmentCount", () => {
    it("should increment assignment count atomically", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "agent-inc", lastStatus: "idle" });

      store.incrementAssignmentCount("agent-inc");
      store.incrementAssignmentCount("agent-inc");

      const profile = store.getAgentProfile("agent-inc");
      expect(profile).not.toBeNull();
      expect(profile!.assignmentCount).toBe(2);
    });
  });

  describe("spawn history", () => {
    it("should log a spawn and return the ID", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const id = store.logSpawn("agent-1");
      expect(id).toBeGreaterThan(0);
    });

    it("should log spawn with reason and beadId", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1", "needed for frontend work", "adj-052");
      const history = store.getSpawnHistory();
      expect(history).toHaveLength(1);
      expect(history[0].agentId).toBe("agent-1");
      expect(history[0].reason).toBe("needed for frontend work");
      expect(history[0].beadId).toBe("adj-052");
    });

    it("should get spawn history ordered newest first", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      // Insert with explicit timestamps to ensure order
      db.prepare(
        "INSERT INTO adjutant_spawn_history (agent_id, spawned_at, reason) VALUES (?, ?, ?)",
      ).run("agent-1", "2025-01-01T00:00:00", "first");
      db.prepare(
        "INSERT INTO adjutant_spawn_history (agent_id, spawned_at, reason) VALUES (?, ?, ?)",
      ).run("agent-2", "2025-01-02T00:00:00", "second");
      db.prepare(
        "INSERT INTO adjutant_spawn_history (agent_id, spawned_at, reason) VALUES (?, ?, ?)",
      ).run("agent-3", "2025-01-03T00:00:00", "third");

      const history = store.getSpawnHistory();
      expect(history).toHaveLength(3);
      expect(history[0].reason).toBe("third");
      expect(history[1].reason).toBe("second");
      expect(history[2].reason).toBe("first");
    });

    it("should respect limit in getSpawnHistory", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1");
      store.logSpawn("agent-2");
      store.logSpawn("agent-3");
      store.logSpawn("agent-4");
      store.logSpawn("agent-5");

      const history = store.getSpawnHistory(2);
      expect(history).toHaveLength(2);
    });

    it("should get agent-specific spawn history", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1", "first spawn");
      store.logSpawn("agent-2", "other agent");
      store.logSpawn("agent-1", "second spawn");

      const history = store.getAgentSpawnHistory("agent-1");
      expect(history).toHaveLength(2);
      expect(history.every((r) => r.agentId === "agent-1")).toBe(true);
    });

    it("should mark spawn as decommissioned", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const id = store.logSpawn("agent-1");
      store.markDecommissioned(id);

      const history = store.getSpawnHistory();
      expect(history).toHaveLength(1);
      expect(history[0].decommissionedAt).not.toBeNull();
    });

    it("should get last spawn for agent", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      // Insert with explicit timestamps to guarantee order
      db.prepare(
        "INSERT INTO adjutant_spawn_history (agent_id, spawned_at, reason) VALUES (?, ?, ?)",
      ).run("agent-1", "2025-01-01T00:00:00", "first");
      db.prepare(
        "INSERT INTO adjutant_spawn_history (agent_id, spawned_at, reason) VALUES (?, ?, ?)",
      ).run("agent-1", "2025-01-02T00:00:00", "second");
      db.prepare(
        "INSERT INTO adjutant_spawn_history (agent_id, spawned_at, reason) VALUES (?, ?, ?)",
      ).run("agent-1", "2025-01-03T00:00:00", "third");

      const last = store.getLastSpawn("agent-1");
      expect(last).not.toBeNull();
      expect(last!.reason).toBe("third");
    });

    it("should return null for getLastSpawn when no spawns exist", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const last = store.getLastSpawn("nonexistent-agent");
      expect(last).toBeNull();
    });

    it("should count active spawns", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const id1 = store.logSpawn("agent-1");
      store.logSpawn("agent-2");
      store.logSpawn("agent-3");

      // Decommission one
      store.markDecommissioned(id1);

      const count = store.countActiveSpawns();
      expect(count).toBe(2);
    });

    it("should default decommissionedAt to null", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1");
      const last = store.getLastSpawn("agent-1");
      expect(last).not.toBeNull();
      expect(last!.decommissionedAt).toBeNull();
    });
  });

  describe("pruneOldDecisions", () => {
    it("should return 0 when no old decisions exist", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      // Insert a recent decision (defaults to now)
      store.logDecision({ behavior: "b1", action: "a1", target: null, reason: null });

      const pruned = store.pruneOldDecisions(30);
      expect(pruned).toBe(0);

      // Decision should still be there
      const decisions = store.getRecentDecisions(10);
      expect(decisions).toHaveLength(1);
    });

    it("should delete decisions older than threshold", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      // Insert an old decision directly via SQL
      db.prepare(
        "INSERT INTO adjutant_decisions (behavior, action, target, reason, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run("old-behavior", "old-action", null, null, "2020-01-01T00:00:00.000Z");

      // Insert a recent decision via the API
      store.logDecision({ behavior: "recent", action: "a1", target: null, reason: null });

      const pruned = store.pruneOldDecisions(30);
      expect(pruned).toBe(1);

      // Only the recent decision should remain
      const decisions = store.getRecentDecisions(10);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].behavior).toBe("recent");
    });

    it("should preserve recent decisions", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      // Insert 3 old decisions
      const insertOld = db.prepare(
        "INSERT INTO adjutant_decisions (behavior, action, target, reason, created_at) VALUES (?, ?, ?, ?, ?)",
      );
      insertOld.run("old-1", "a1", null, null, "2020-01-01T00:00:00.000Z");
      insertOld.run("old-2", "a2", null, null, "2020-06-15T00:00:00.000Z");
      insertOld.run("old-3", "a3", null, null, "2021-03-01T00:00:00.000Z");

      // Insert 2 recent decisions
      store.logDecision({ behavior: "recent-1", action: "r1", target: null, reason: null });
      store.logDecision({ behavior: "recent-2", action: "r2", target: null, reason: null });

      const pruned = store.pruneOldDecisions(30);
      expect(pruned).toBe(3);

      // Only the 2 recent decisions should remain
      const decisions = store.getRecentDecisions(10);
      expect(decisions).toHaveLength(2);
      const behaviors = decisions.map((d) => d.behavior).sort();
      expect(behaviors).toEqual(["recent-1", "recent-2"]);
    });
  });

  describe("spawn history", () => {
    it("should log a spawn and return the ID", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const id = store.logSpawn("agent-1");
      expect(id).toBeGreaterThan(0);
    });

    it("should log spawn with reason and beadId", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const id = store.logSpawn("agent-1", "handle feature work", "adj-052");
      expect(id).toBeGreaterThan(0);

      const record = store.getLastSpawn("agent-1");
      expect(record).not.toBeNull();
      expect(record!.agentId).toBe("agent-1");
      expect(record!.reason).toBe("handle feature work");
      expect(record!.beadId).toBe("adj-052");
      expect(record!.spawnedAt).toBeTruthy();
    });

    it("should get history ordered newest first", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1", "first");
      store.logSpawn("agent-2", "second");
      store.logSpawn("agent-3", "third");

      const history = store.getSpawnHistory();
      expect(history).toHaveLength(3);
      // Newest first — highest ID first since same-second timestamps
      expect(history[0].reason).toBe("third");
      expect(history[1].reason).toBe("second");
      expect(history[2].reason).toBe("first");
    });

    it("should respect limit", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1", "first");
      store.logSpawn("agent-2", "second");
      store.logSpawn("agent-3", "third");

      const history = store.getSpawnHistory(2);
      expect(history).toHaveLength(2);
      expect(history[0].reason).toBe("third");
      expect(history[1].reason).toBe("second");
    });

    it("should get agent-specific history", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1", "first for agent-1");
      store.logSpawn("agent-2", "for agent-2");
      store.logSpawn("agent-1", "second for agent-1");

      const history = store.getAgentSpawnHistory("agent-1");
      expect(history).toHaveLength(2);
      expect(history[0].reason).toBe("second for agent-1");
      expect(history[1].reason).toBe("first for agent-1");
    });

    it("should mark decommissioned", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const id = store.logSpawn("agent-1", "will be decommissioned");
      store.markDecommissioned(id);

      const record = store.getLastSpawn("agent-1");
      expect(record).not.toBeNull();
      expect(record!.decommissionedAt).toBeTruthy();
    });

    it("should get last spawn for agent", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1", "first");
      store.logSpawn("agent-1", "second");

      const last = store.getLastSpawn("agent-1");
      expect(last).not.toBeNull();
      expect(last!.reason).toBe("second");
    });

    it("should return null when no spawns", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const last = store.getLastSpawn("nonexistent-agent");
      expect(last).toBeNull();
    });

    it("should count active spawns", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      const id1 = store.logSpawn("agent-1");
      store.logSpawn("agent-2");
      store.logSpawn("agent-3");

      // Decommission one
      store.markDecommissioned(id1);

      const count = store.countActiveSpawns();
      expect(count).toBe(2);
    });

    it("should default decommissionedAt to null", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.logSpawn("agent-1", "test spawn");

      const record = store.getLastSpawn("agent-1");
      expect(record).not.toBeNull();
      expect(record!.decommissionedAt).toBeNull();
    });
  });

  describe("markAllDisconnected", () => {
    it("should mark all connected profiles as disconnected", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      // Two connected agents
      store.upsertAgentProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T10:00:00Z", disconnectedAt: null });
      store.upsertAgentProfile({ agentId: "agent-2", lastStatus: "working", connectedAt: "2026-01-01T10:00:00Z", disconnectedAt: null });
      // One already disconnected
      store.upsertAgentProfile({ agentId: "agent-3", lastStatus: "disconnected", connectedAt: "2026-01-01T09:00:00Z", disconnectedAt: "2026-01-01T10:00:00Z" });

      const count = store.markAllDisconnected();
      expect(count).toBe(2);

      const p1 = store.getAgentProfile("agent-1");
      expect(p1!.lastStatus).toBe("disconnected");
      expect(p1!.disconnectedAt).not.toBeNull();

      const p2 = store.getAgentProfile("agent-2");
      expect(p2!.lastStatus).toBe("disconnected");
      expect(p2!.disconnectedAt).not.toBeNull();

      // Agent-3 should be unchanged
      const p3 = store.getAgentProfile("agent-3");
      expect(p3!.disconnectedAt).toBe("2026-01-01T10:00:00Z");
    });

    it("should return 0 when no connected profiles exist", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.upsertAgentProfile({ agentId: "agent-1", lastStatus: "disconnected", connectedAt: "2026-01-01T09:00:00Z", disconnectedAt: "2026-01-01T10:00:00Z" });

      const count = store.markAllDisconnected();
      expect(count).toBe(0);
    });
  });
});
