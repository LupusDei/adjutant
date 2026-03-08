import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { MemoryStore } from "../../../../src/services/adjutant/memory-store.js";
import type { AdjutantState } from "../../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../../src/services/adjutant/communication.js";
import type { ProposalStore } from "../../../../src/services/proposal-store.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";

let testDir: string;
let db: Database.Database;
let memoryStore: MemoryStore;
let proposalStore: ProposalStore;
let state: AdjutantState;
let comm: CommunicationManager;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-selfimprove-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function makeLearningCreatedEvent(learningId: number, topic: string): BehaviorEvent {
  return {
    name: "learning:created",
    data: {
      learningId,
      category: "operational",
      topic,
      sourceType: "user_correction",
    },
    seq: 1,
  };
}

function makeCronEvent(): BehaviorEvent {
  return {
    name: "learning:created",
    data: { cronTick: true, behavior: "self-improver" },
    seq: 0,
  };
}

describe("Self-Improver Behavior (adj-053.5.1)", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createMemoryStore } = await import("../../../../src/services/adjutant/memory-store.js");
    const { createAdjutantState } = await import("../../../../src/services/adjutant/state-store.js");
    const { createProposalStore } = await import("../../../../src/services/proposal-store.js");
    memoryStore = createMemoryStore(db);
    proposalStore = createProposalStore(db);
    state = createAdjutantState(db);
    comm = createMockComm();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("structure", () => {
    it("should have correct name and triggers", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);
      expect(behavior.name).toBe("self-improver");
      expect(behavior.triggers).toContain("learning:created");
    });

    it("should have a weekly schedule", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);
      expect(behavior.schedule).toBeDefined();
    });
  });

  describe("on learning:created", () => {
    it("should NOT create proposal when topic has fewer than 5 learnings", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      // Insert only 3 learnings for the topic
      for (let i = 0; i < 3; i++) {
        memoryStore.insertLearning({
          category: "operational",
          topic: "workflow",
          content: `Learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.7,
        });
      }

      const event = makeLearningCreatedEvent(3, "workflow");
      await behavior.act(event, state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals).toHaveLength(0);
    });

    it("should create proposal when topic accumulates 5+ learnings with high confidence", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      // Insert 5 learnings for the topic with high confidence
      for (let i = 0; i < 5; i++) {
        memoryStore.insertLearning({
          category: "operational",
          topic: "bead-workflow",
          content: `Learning about bead workflow ${i}`,
          sourceType: "user_correction",
          confidence: 0.7,
        });
      }

      const event = makeLearningCreatedEvent(5, "bead-workflow");
      await behavior.act(event, state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals.length).toBeGreaterThanOrEqual(1);
      expect(proposals[0].title).toContain("bead-workflow");
    });

    it("should debounce — only 1 proposal per topic per week", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      // Insert 5 learnings
      for (let i = 0; i < 5; i++) {
        memoryStore.insertLearning({
          category: "operational",
          topic: "repeated-topic",
          content: `Learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.7,
        });
      }

      // Trigger twice
      await behavior.act(makeLearningCreatedEvent(5, "repeated-topic"), state, comm);
      await behavior.act(makeLearningCreatedEvent(6, "repeated-topic"), state, comm);

      const proposals = proposalStore.getProposals();
      // Should have at most 1 proposal (debounced)
      expect(proposals.length).toBe(1);
    });

    it("should log a decision when proposal is created", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      for (let i = 0; i < 5; i++) {
        memoryStore.insertLearning({
          category: "operational",
          topic: "test-proposal",
          content: `Learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.7,
        });
      }

      await behavior.act(makeLearningCreatedEvent(5, "test-proposal"), state, comm);

      const decisions = state.getRecentDecisions(5);
      const proposalDecision = decisions.find((d) => d.action === "proposal_created");
      expect(proposalDecision).toBeDefined();
      expect(proposalDecision!.behavior).toBe("self-improver");
    });
  });

  describe("debounce persistence (adj-usx0)", () => {
    it("should persist debounce state across separate behavior instances", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");

      // Insert 5 learnings with high confidence
      for (let i = 0; i < 5; i++) {
        memoryStore.insertLearning({
          category: "operational",
          topic: "persist-test",
          content: `Learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.7,
        });
      }

      // First instance: trigger proposal
      const behavior1 = createSelfImprover(memoryStore, proposalStore);
      await behavior1.act(makeLearningCreatedEvent(5, "persist-test"), state, comm);

      const proposals1 = proposalStore.getProposals();
      expect(proposals1.length).toBe(1);

      // Second instance (simulating restart): same topic should be debounced
      const behavior2 = createSelfImprover(memoryStore, proposalStore);
      await behavior2.act(makeLearningCreatedEvent(6, "persist-test"), state, comm);

      const proposals2 = proposalStore.getProposals();
      // Should still be 1 — debounce survives the "restart"
      expect(proposals2.length).toBe(1);
    });
  });

  describe("proposal type mapping (adj-i9hu)", () => {
    it("should create 'engineering' proposal for technical category learnings", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      for (let i = 0; i < 5; i++) {
        memoryStore.insertLearning({
          category: "technical",
          topic: "typescript-patterns",
          content: `Technical learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.8,
        });
      }

      await behavior.act(makeLearningCreatedEvent(5, "typescript-patterns"), state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe("engineering");
    });

    it("should create 'product' proposal for operational category learnings", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      for (let i = 0; i < 5; i++) {
        memoryStore.insertLearning({
          category: "operational",
          topic: "ops-workflow",
          content: `Operational learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.8,
        });
      }

      await behavior.act(makeLearningCreatedEvent(5, "ops-workflow"), state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe("product");
    });

    it("should create 'engineering' proposal for project category learnings", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      for (let i = 0; i < 5; i++) {
        memoryStore.insertLearning({
          category: "project",
          topic: "project-mgmt",
          content: `Project learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.8,
        });
      }

      await behavior.act(makeLearningCreatedEvent(5, "project-mgmt"), state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe("engineering");
    });

    it("should create 'product' proposal for coordination category learnings", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      for (let i = 0; i < 5; i++) {
        memoryStore.insertLearning({
          category: "coordination",
          topic: "coord-patterns",
          content: `Coordination learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.8,
        });
      }

      await behavior.act(makeLearningCreatedEvent(5, "coord-patterns"), state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe("product");
    });

    it("should use majority category to determine proposal type for mixed topics", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      // 3 technical + 2 operational = majority technical => engineering
      for (let i = 0; i < 3; i++) {
        memoryStore.insertLearning({
          category: "technical",
          topic: "mixed-topic",
          content: `Technical learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.8,
        });
      }
      for (let i = 0; i < 2; i++) {
        memoryStore.insertLearning({
          category: "operational",
          topic: "mixed-topic",
          content: `Operational learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.8,
        });
      }

      await behavior.act(makeLearningCreatedEvent(5, "mixed-topic"), state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe("engineering");
    });
  });

  describe("weekly review", () => {
    it("should process topics with 5+ learnings on cron tick", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      // Insert 5+ learnings across a topic with good confidence
      for (let i = 0; i < 6; i++) {
        memoryStore.insertLearning({
          category: "technical",
          topic: "weekly-review-topic",
          content: `Weekly learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.8,
        });
      }

      // Simulate cron tick
      const event = makeCronEvent();
      await behavior.act(event, state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals.length).toBeGreaterThanOrEqual(1);
    });

    it("should NOT run weekly review again within 7 days (adj-vugs)", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      // First cron tick with no qualifying topics — should still record the run
      await behavior.act(makeCronEvent(), state, comm);

      // Now add qualifying learnings for a NEW topic (not debounced per-topic)
      for (let i = 0; i < 6; i++) {
        memoryStore.insertLearning({
          category: "technical",
          topic: "weekly-gate-topic",
          content: `Weekly gate learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.8,
        });
      }

      // Second cron tick within same week: weekly review should NOT run at all,
      // even though this topic is new and not per-topic debounced
      await behavior.act(makeCronEvent(), state, comm);
      const proposals = proposalStore.getProposals();
      expect(proposals.length).toBe(0);
    });

    it("should skip topics with low average confidence", async () => {
      const { createSelfImprover } = await import("../../../../src/services/adjutant/behaviors/self-improver.js");
      const behavior = createSelfImprover(memoryStore, proposalStore);

      // Insert learnings with low confidence
      for (let i = 0; i < 6; i++) {
        memoryStore.insertLearning({
          category: "technical",
          topic: "low-confidence-topic",
          content: `Low confidence learning ${i}`,
          sourceType: "user_correction",
          confidence: 0.3,
        });
      }

      const event = makeCronEvent();
      await behavior.act(event, state, comm);

      const proposals = proposalStore.getProposals();
      expect(proposals).toHaveLength(0);
    });
  });
});
