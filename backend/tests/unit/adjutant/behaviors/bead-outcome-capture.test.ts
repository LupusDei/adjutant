import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { MemoryStore } from "../../../../src/services/adjutant/memory-store.js";
import type { AdjutantState } from "../../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../../src/services/adjutant/communication.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";

let testDir: string;
let db: Database.Database;
let memoryStore: MemoryStore;
let state: AdjutantState;
let comm: CommunicationManager;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-beadout-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

function createMockComm(): CommunicationManager {
  return {
    queueRoutine: vi.fn(),
    sendImportant: vi.fn().mockResolvedValue(undefined),
    escalate: vi.fn().mockResolvedValue(undefined),
    messageAgent: vi.fn().mockResolvedValue(undefined),
    flushRoutineQueue: vi.fn().mockReturnValue([]),
    getRoutineQueueLength: vi.fn().mockReturnValue(0),
  };
}

function makeBeadClosedEvent(beadId: string, title: string): BehaviorEvent {
  return {
    name: "bead:closed",
    data: {
      id: beadId,
      title,
      closedAt: new Date().toISOString(),
    },
    seq: 1,
  };
}

describe("Bead Outcome Capture (adj-053.2.2)", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createMemoryStore } = await import("../../../../src/services/adjutant/memory-store.js");
    const { createAdjutantState } = await import("../../../../src/services/adjutant/state-store.js");
    memoryStore = createMemoryStore(db);
    state = createAdjutantState(db);
    comm = createMockComm();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("successful bead closure", () => {
    it("should log bead outcome decision on normal closure", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeBeadClosedEvent("adj-001", "Complete feature X");

      await behavior.act(event, state, comm);

      const decisions = state.getRecentDecisions(5);
      const beadDecision = decisions.find((d) => d.action === "bead_outcome_noted");
      expect(beadDecision).toBeDefined();
      expect(beadDecision!.target).toBe("adj-001");
    });
  });

  describe("failure pattern detection", () => {
    it("should detect bead reopened pattern from decision log", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);

      // Simulate reopen pattern: bead was previously closed then reopened
      state.logDecision({
        behavior: "work-assigner",
        action: "bead_reopened",
        target: "adj-001",
        reason: "Bead was reopened after initial closure",
      });

      const event = makeBeadClosedEvent("adj-001", "Feature that was reopened");
      await behavior.act(event, state, comm);

      // Should create a learning about the failure pattern
      const learnings = memoryStore.queryLearnings({ category: "operational" });
      const failureLearning = learnings.find((l) => l.sourceType === "bead_outcome");
      expect(failureLearning).toBeDefined();
      expect(failureLearning!.content).toContain("adj-001");
    });

    it("should detect multiple assignment pattern", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);

      // Simulate multiple assignments (bead reassigned multiple times)
      state.logDecision({
        behavior: "work-assigner",
        action: "assign",
        target: "adj-002",
        reason: "Assigned to agent-1",
      });
      state.logDecision({
        behavior: "work-assigner",
        action: "assign",
        target: "adj-002",
        reason: "Reassigned to agent-2",
      });
      state.logDecision({
        behavior: "work-assigner",
        action: "assign",
        target: "adj-002",
        reason: "Reassigned to agent-3",
      });

      const event = makeBeadClosedEvent("adj-002", "Bead with multiple assignments");
      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      const multiAssign = learnings.find((l) =>
        l.content.includes("multiple") || l.content.includes("reassign")
      );
      expect(multiAssign).toBeDefined();
      expect(multiAssign!.sourceType).toBe("bead_outcome");
    });

    it("should NOT create failure learning for normal single-assignment closure", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);

      // Normal single assignment
      state.logDecision({
        behavior: "work-assigner",
        action: "assign",
        target: "adj-003",
        reason: "Assigned to agent-1",
      });

      const event = makeBeadClosedEvent("adj-003", "Normal bead closure");
      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      const failureLearning = learnings.find((l) => l.sourceType === "bead_outcome");
      expect(failureLearning).toBeUndefined();
    });
  });

  describe("outcome tracking", () => {
    it("should record bead outcome as decision with appropriate reason", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeBeadClosedEvent("adj-010", "Build the API endpoint");

      await behavior.act(event, state, comm);

      const decisions = state.getRecentDecisions(5);
      expect(decisions.some((d) => d.target === "adj-010")).toBe(true);
    });
  });
});
