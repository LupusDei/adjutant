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

    it("should overwrite existing value", async () => {
      const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
      const store = createAdjutantState(db);

      store.setMeta("version", "1.0.0");
      store.setMeta("version", "2.0.0");
      expect(store.getMeta("version")).toBe("2.0.0");
    });
  });
});
