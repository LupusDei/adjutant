/**
 * Integration test: Full memory pipeline
 *
 * Verifies the end-to-end flow:
 *   1. Bead closure → memory-collector → learning created (failure patterns)
 *   2. Trigger retro → session-retrospective → retrospective with metrics
 *   3. 5+ topic learnings → self-improver → proposal created
 *
 * Bead: adj-053.5.3
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { MemoryStore } from "../../../src/services/adjutant/memory-store.js";
import type { AdjutantState } from "../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../src/services/adjutant/communication.js";
import type { ProposalStore } from "../../../src/services/proposal-store.js";
import type { BehaviorEvent } from "../../../src/services/adjutant/behavior-registry.js";

let testDir: string;
let db: Database.Database;
let memoryStore: MemoryStore;
let proposalStore: ProposalStore;
let state: AdjutantState;
let comm: CommunicationManager;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../src/services/database.js");
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

describe("Memory System Integration (adj-053.5.3)", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createMemoryStore } = await import("../../../src/services/adjutant/memory-store.js");
    const { createAdjutantState } = await import("../../../src/services/adjutant/state-store.js");
    const { createProposalStore } = await import("../../../src/services/proposal-store.js");
    memoryStore = createMemoryStore(db);
    proposalStore = createProposalStore(db);
    state = createAdjutantState(db);
    comm = createMockComm();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create retrospective from bead closure events", async () => {
    const { createSessionRetrospective } = await import("../../../src/services/adjutant/behaviors/session-retrospective.js");
    const retro = createSessionRetrospective(memoryStore);

    // Simulate some bead closures to build history
    state.logDecision({
      behavior: "memory-collector",
      action: "bead_outcome_noted",
      target: "bead-1",
      reason: "Bead closed",
    });
    state.logDecision({
      behavior: "memory-collector",
      action: "bead_outcome_noted",
      target: "bead-2",
      reason: "Bead closed",
    });

    // Trigger the retrospective via cron tick
    const event: BehaviorEvent = {
      name: "cron:tick",
      data: { cronTick: true, behavior: "session-retrospective" },
      seq: 0,
    };

    await retro.act(event, state, comm);

    // Verify a retrospective was created
    const retros = memoryStore.getRecentRetrospectives(5);
    expect(retros.length).toBeGreaterThanOrEqual(1);
  });

  it("should create proposal when topic accumulates 5+ high-confidence learnings", async () => {
    const { createSelfImprover } = await import("../../../src/services/adjutant/behaviors/self-improver.js");
    const improver = createSelfImprover(memoryStore, proposalStore);

    // Insert 5 learnings for the same topic with high confidence
    for (let i = 0; i < 5; i++) {
      memoryStore.insertLearning({
        category: "operational",
        topic: "testing-workflow",
        content: `Testing workflow learning ${i}: always verify before closing`,
        sourceType: "user_correction",
        confidence: 0.75,
      });
    }

    // Trigger self-improver with learning:created event
    const event: BehaviorEvent = {
      name: "learning:created",
      data: {
        learningId: 5,
        category: "operational",
        topic: "testing-workflow",
        sourceType: "user_correction",
      },
      seq: 5,
    };

    await improver.act(event, state, comm);

    // Verify proposal was created
    const proposals = proposalStore.getProposals();
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0]!.title).toContain("testing-workflow");
  });

  it("should capture bead outcome patterns in learning", async () => {
    const { createMemoryCollector } = await import("../../../src/services/adjutant/behaviors/memory-collector.js");
    const collector = createMemoryCollector(memoryStore);

    // Create decision log entries simulating a bead that was reopened
    state.logDecision({
      behavior: "work-assigner",
      action: "bead_reopened",
      target: "bead-test-1",
      reason: "Failed quality check",
    });

    // Simulate bead:closed event
    const event: BehaviorEvent = {
      name: "bead:closed",
      data: {
        id: "bead-test-1",
        title: "Test bead for reopened pattern",
        closedAt: new Date().toISOString(),
      },
      seq: 10,
    };

    await collector.act(event, state, comm);

    // Should have created a learning about the reopened pattern
    const learnings = memoryStore.queryLearnings({ topic: "bead-quality" });
    expect(learnings.length).toBeGreaterThanOrEqual(1);
    expect(learnings[0]!.content).toContain("reopened");
  });

  it("should have all new behaviors registered correctly (structure check)", async () => {
    const { createMemoryCollector } = await import("../../../src/services/adjutant/behaviors/memory-collector.js");
    const { createSessionRetrospective } = await import("../../../src/services/adjutant/behaviors/session-retrospective.js");
    const { createMemoryReviewer } = await import("../../../src/services/adjutant/behaviors/memory-reviewer.js");
    const { createSelfImprover } = await import("../../../src/services/adjutant/behaviors/self-improver.js");

    const collector = createMemoryCollector(memoryStore);
    const retro = createSessionRetrospective(memoryStore);
    const reviewer = createMemoryReviewer(memoryStore);
    const improver = createSelfImprover(memoryStore, proposalStore);

    // Verify names
    expect(collector.name).toBe("memory-collector");
    expect(retro.name).toBe("session-retrospective");
    expect(reviewer.name).toBe("memory-reviewer");
    expect(improver.name).toBe("self-improver");

    // Verify triggers
    expect(collector.triggers).toContain("bead:closed");
    expect(collector.triggers).toContain("agent:status_changed");
    expect(improver.triggers).toContain("learning:created");

    // Verify shouldAct returns true for generic events
    const genericEvent: BehaviorEvent = { name: "test", data: {}, seq: 0 };
    expect(collector.shouldAct(genericEvent, state)).toBe(true);
    expect(improver.shouldAct(genericEvent, state)).toBe(true);
  });

  it("should register all behaviors in BehaviorRegistry without conflicts", async () => {
    const { BehaviorRegistry } = await import("../../../src/services/adjutant/behavior-registry.js");
    const { createMemoryCollector } = await import("../../../src/services/adjutant/behaviors/memory-collector.js");
    const { createSessionRetrospective } = await import("../../../src/services/adjutant/behaviors/session-retrospective.js");
    const { createMemoryReviewer } = await import("../../../src/services/adjutant/behaviors/memory-reviewer.js");
    const { createSelfImprover } = await import("../../../src/services/adjutant/behaviors/self-improver.js");

    const registry = new BehaviorRegistry();

    // Register all new behaviors
    registry.register(createMemoryCollector(memoryStore));
    registry.register(createSessionRetrospective(memoryStore));
    registry.register(createMemoryReviewer(memoryStore));
    registry.register(createSelfImprover(memoryStore, proposalStore));

    // Should be able to get behaviors for relevant events
    const beadClosedBehaviors = registry.getBehaviorsForEvent("bead:closed");
    expect(beadClosedBehaviors.some((b) => b.name === "memory-collector")).toBe(true);

    const learningBehaviors = registry.getBehaviorsForEvent("learning:created");
    expect(learningBehaviors.some((b) => b.name === "self-improver")).toBe(true);

    const beadBehaviors = registry.getBehaviorsForEvent("bead:closed");
    expect(beadBehaviors.some((b) => b.name === "memory-collector")).toBe(true);
  });

  it("should track confidence decay and reinforcement across the pipeline", async () => {
    // Insert a learning and verify reinforcement mechanics
    const learning = memoryStore.insertLearning({
      category: "operational",
      topic: "decay-test",
      content: "Test learning for decay verification",
      sourceType: "user_correction",
      confidence: 0.5,
    });

    // Reinforce 5 times
    for (let i = 0; i < 5; i++) {
      memoryStore.reinforceLearning(learning.id);
    }

    const reinforced = memoryStore.getLearning(learning.id)!;
    expect(reinforced.reinforcementCount).toBe(6); // 1 initial + 5
    expect(reinforced.confidence).toBeGreaterThan(0.5);
    expect(reinforced.confidence).toBeLessThanOrEqual(1.0);

    // Verify pruneStale doesn't affect fresh learnings
    const pruned = memoryStore.pruneStale(7);
    expect(pruned).toBe(0);

    // Verify the learning is still intact
    const afterPrune = memoryStore.getLearning(learning.id)!;
    expect(afterPrune.confidence).toBe(reinforced.confidence);
  });
});
