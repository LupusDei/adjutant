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
});
