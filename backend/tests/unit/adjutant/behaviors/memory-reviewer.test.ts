/**
 * Tests for the memory-reviewer behavior.
 *
 * Bead: adj-053.4.1
 *
 * The memory-reviewer has two modes:
 * 1. Startup Review: On first fire (no last_review_at meta), query top learnings
 *    and recent retrospectives, then inject into heartbeat via queueRoutine.
 * 2. Weekly Review: Prune stale learnings, decay confidence, escalate recurring corrections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { AdjutantState, AgentProfile } from "../../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../../src/services/adjutant/communication.js";
import type {
  MemoryStore,
  Learning,
  Retrospective,
  Correction,
} from "../../../../src/services/adjutant/memory-store.js";

// ============================================================================
// Mock Helpers
// ============================================================================

function makeLearning(overrides: Partial<Learning> & { id: number }): Learning {
  return {
    id: overrides.id,
    category: overrides.category ?? "operational",
    topic: overrides.topic ?? "test-topic",
    content: overrides.content ?? "Test learning content",
    sourceType: overrides.sourceType ?? "user_correction",
    sourceRef: overrides.sourceRef ?? null,
    confidence: overrides.confidence ?? 0.5,
    reinforcementCount: overrides.reinforcementCount ?? 1,
    lastAppliedAt: overrides.lastAppliedAt ?? null,
    lastValidatedAt: overrides.lastValidatedAt ?? null,
    supersededBy: overrides.supersededBy ?? null,
    createdAt: overrides.createdAt ?? "2026-03-01T12:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-03-01T12:00:00Z",
  };
}

function makeRetrospective(overrides: Partial<Retrospective> & { id: number }): Retrospective {
  return {
    id: overrides.id,
    sessionDate: overrides.sessionDate ?? "2026-03-08",
    beadsClosed: overrides.beadsClosed ?? 5,
    beadsFailed: overrides.beadsFailed ?? 1,
    correctionsReceived: overrides.correctionsReceived ?? 2,
    agentsUsed: overrides.agentsUsed ?? 3,
    avgBeadTimeMins: overrides.avgBeadTimeMins ?? 30,
    wentWell: overrides.wentWell ?? '["Good coverage"]',
    wentWrong: overrides.wentWrong ?? '["Build failures"]',
    actionItems: overrides.actionItems ?? '["Add tests"]',
    metrics: overrides.metrics ?? null,
    createdAt: overrides.createdAt ?? "2026-03-08T23:00:00Z",
  };
}

function makeCorrection(overrides: Partial<Correction> & { id: number }): Correction {
  return {
    id: overrides.id,
    messageId: overrides.messageId ?? null,
    correctionType: overrides.correctionType ?? "behavioral",
    pattern: overrides.pattern ?? "don't do X",
    description: overrides.description ?? "Test correction",
    learningId: overrides.learningId ?? null,
    recurrenceCount: overrides.recurrenceCount ?? 0,
    lastRecurrenceAt: overrides.lastRecurrenceAt ?? null,
    resolved: overrides.resolved ?? false,
    createdAt: overrides.createdAt ?? "2026-03-08T12:00:00Z",
  };
}

function createMockState(): AdjutantState {
  return {
    getAllAgentProfiles: vi.fn((): AgentProfile[] => []),
    logDecision: vi.fn(),
    upsertAgentProfile: vi.fn(),
    getAgentProfile: vi.fn(),
    incrementAssignmentCount: vi.fn(),
    getRecentDecisions: vi.fn().mockReturnValue([]),
    getMeta: vi.fn().mockReturnValue(null),
    setMeta: vi.fn(),
    pruneOldDecisions: vi.fn().mockReturnValue(0),
  };
}

function createMockComm(): CommunicationManager {
  return {
    messageAgent: vi.fn(async () => {}),
    queueRoutine: vi.fn(),
    sendImportant: vi.fn(async () => {}),
    escalate: vi.fn(async () => {}),
    flushRoutineQueue: vi.fn().mockReturnValue([]),
    getRoutineQueueLength: vi.fn().mockReturnValue(0),
  };
}

function createMockMemoryStore(): MemoryStore {
  return {
    insertLearning: vi.fn(),
    getLearning: vi.fn(),
    updateLearning: vi.fn(),
    queryLearnings: vi.fn().mockReturnValue([]),
    searchLearnings: vi.fn().mockReturnValue([]),
    findSimilarLearnings: vi.fn().mockReturnValue([]),
    reinforceLearning: vi.fn(),
    supersedeLearning: vi.fn(),
    pruneStale: vi.fn().mockReturnValue(0),
    insertRetrospective: vi.fn(),
    getRecentRetrospectives: vi.fn().mockReturnValue([]),
    insertCorrection: vi.fn(),
    findSimilarCorrection: vi.fn(),
    incrementRecurrence: vi.fn(),
    getUnresolvedCorrections: vi.fn().mockReturnValue([]),
    getTopicFrequency: vi.fn().mockReturnValue([]),
    getCorrectionRecurrenceRate: vi.fn().mockReturnValue([]),
    getLearningEffectiveness: vi.fn().mockReturnValue([]),
  };
}

const dummyEvent: BehaviorEvent = {
  name: "agent:status_changed",
  data: {},
  seq: 1,
};

// ============================================================================
// Tests
// ============================================================================

describe("createMemoryReviewer", () => {
  let mockStore: MemoryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T12:00:00Z"));
    mockStore = createMockMemoryStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  it("has name 'memory-reviewer'", async () => {
    const { createMemoryReviewer } = await import(
      "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
    );
    const behavior = createMemoryReviewer(mockStore);
    expect(behavior.name).toBe("memory-reviewer");
  });

  it("triggers on 'agent:status_changed'", async () => {
    const { createMemoryReviewer } = await import(
      "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
    );
    const behavior = createMemoryReviewer(mockStore);
    expect(behavior.triggers).toContain("agent:status_changed");
  });

  it("has weekly schedule '0 0 * * 1'", async () => {
    const { createMemoryReviewer } = await import(
      "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
    );
    const behavior = createMemoryReviewer(mockStore);
    expect(behavior.schedule).toBe("0 0 * * 1");
  });

  it("shouldAct always returns true", async () => {
    const { createMemoryReviewer } = await import(
      "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
    );
    const behavior = createMemoryReviewer(mockStore);
    const state = createMockState();
    expect(behavior.shouldAct(dummyEvent, state)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Startup Review — first fire (no last_review_at)
  // --------------------------------------------------------------------------

  describe("startup review", () => {
    it("should query top learnings on first fire (no last_review_at)", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      vi.mocked(state.getMeta).mockReturnValue(null);

      const learnings = [
        makeLearning({ id: 1, content: "Always use worktree", confidence: 0.9, createdAt: "2026-03-07T12:00:00Z" }),
        makeLearning({ id: 2, content: "Self-assign beads", confidence: 0.8, createdAt: "2026-03-06T12:00:00Z" }),
      ];
      vi.mocked(mockStore.queryLearnings).mockReturnValue(learnings);

      await behavior.act(dummyEvent, state, comm);

      expect(mockStore.queryLearnings).toHaveBeenCalled();
    });

    it("should query recent retrospectives on startup", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();
      vi.mocked(state.getMeta).mockReturnValue(null);

      await behavior.act(dummyEvent, state, comm);

      expect(mockStore.getRecentRetrospectives).toHaveBeenCalledWith(3);
    });

    it("should inject lessons into heartbeat via queueRoutine", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();
      vi.mocked(state.getMeta).mockReturnValue(null);

      const learnings = [
        makeLearning({ id: 1, content: "Always use worktree isolation", confidence: 0.9, createdAt: "2026-03-07T12:00:00Z" }),
      ];
      vi.mocked(mockStore.queryLearnings).mockReturnValue(learnings);

      await behavior.act(dummyEvent, state, comm);

      expect(comm.queueRoutine).toHaveBeenCalled();
      const routineMsg = vi.mocked(comm.queueRoutine).mock.calls[0][0];
      expect(routineMsg).toContain("Lessons to remember");
      expect(routineMsg).toContain("Always use worktree isolation");
    });

    it("should include retro action items in startup review", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();
      vi.mocked(state.getMeta).mockReturnValue(null);

      // actionItems is a JSON string in the real interface
      const retros = [
        makeRetrospective({ id: 1, actionItems: '["Add pre-commit hooks", "Fix nudger"]' }),
        makeRetrospective({ id: 2, actionItems: '["Add pre-commit hooks"]' }),
      ];
      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue(retros);

      await behavior.act(dummyEvent, state, comm);

      expect(comm.queueRoutine).toHaveBeenCalled();
      const routineMsg = vi.mocked(comm.queueRoutine).mock.calls[0][0];
      expect(routineMsg).toContain("Add pre-commit hooks");
    });

    it("should set last_review_at after startup review", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();
      vi.mocked(state.getMeta).mockReturnValue(null);

      await behavior.act(dummyEvent, state, comm);

      expect(state.setMeta).toHaveBeenCalledWith(
        "last_review_at",
        expect.any(String),
      );
    });

    it("should log decision for startup review", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();
      vi.mocked(state.getMeta).mockReturnValue(null);

      await behavior.act(dummyEvent, state, comm);

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "memory-reviewer",
          action: "startup_review",
        }),
      );
    });

    it("should NOT perform startup review if last_review_at is set", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      // Already reviewed recently — also set last_weekly_review_at to prevent weekly
      vi.mocked(state.getMeta).mockImplementation((key: string) => {
        if (key === "last_review_at") return "2026-03-08T11:00:00Z";
        if (key === "last_weekly_review_at") return "2026-03-08T11:00:00Z";
        return null;
      });

      await behavior.act(dummyEvent, state, comm);

      expect(comm.queueRoutine).not.toHaveBeenCalled();
    });

    it("should handle empty learnings gracefully during startup", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();
      vi.mocked(state.getMeta).mockReturnValue(null);

      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);
      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue([]);

      await behavior.act(dummyEvent, state, comm);

      expect(state.setMeta).toHaveBeenCalledWith(
        "last_review_at",
        expect.any(String),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Weekly Review — scheduled (last_review_at is set)
  // --------------------------------------------------------------------------

  describe("weekly review (schedule-triggered)", () => {
    const scheduleEvent: BehaviorEvent = {
      name: "agent:status_changed",
      data: {},
      seq: 100,
    };

    it("should prune stale learnings (>90 days)", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      vi.mocked(state.getMeta).mockImplementation((key: string) => {
        if (key === "last_review_at") return "2026-03-07T12:00:00Z";
        if (key === "last_weekly_review_at") return null;
        return null;
      });

      vi.mocked(mockStore.pruneStale).mockReturnValue(5);

      await behavior.act(scheduleEvent, state, comm);

      expect(mockStore.pruneStale).toHaveBeenCalledWith(90);
    });

    it("should escalate corrections with recurrence_count > 2", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      vi.mocked(state.getMeta).mockImplementation((key: string) => {
        if (key === "last_review_at") return "2026-03-07T12:00:00Z";
        if (key === "last_weekly_review_at") return null;
        return null;
      });

      const corrections = [
        makeCorrection({ id: 1, recurrenceCount: 3, description: "Stop using any types", resolved: false }),
        makeCorrection({ id: 2, recurrenceCount: 5, description: "Always assign beads", resolved: false }),
      ];
      vi.mocked(mockStore.getUnresolvedCorrections).mockReturnValue(corrections);

      await behavior.act(scheduleEvent, state, comm);

      expect(comm.sendImportant).toHaveBeenCalled();
      const importantMsg = vi.mocked(comm.sendImportant).mock.calls[0][0];
      expect(importantMsg).toContain("recurring");
    });

    it("should decay confidence for unreinforced learnings", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      vi.mocked(state.getMeta).mockImplementation((key: string) => {
        if (key === "last_review_at") return "2026-03-07T12:00:00Z";
        if (key === "last_weekly_review_at") return null;
        return null;
      });

      const staleLearning = makeLearning({
        id: 1,
        confidence: 0.6,
        lastValidatedAt: "2026-02-25T12:00:00Z", // 11 days ago
      });
      vi.mocked(mockStore.queryLearnings).mockReturnValue([staleLearning]);

      await behavior.act(scheduleEvent, state, comm);

      expect(mockStore.updateLearning).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          confidence: expect.any(Number),
        }),
      );
    });

    it("should NOT decay confidence for recently validated learnings", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      vi.mocked(state.getMeta).mockImplementation((key: string) => {
        if (key === "last_review_at") return "2026-03-07T12:00:00Z";
        if (key === "last_weekly_review_at") return null;
        return null;
      });

      const freshLearning = makeLearning({
        id: 1,
        confidence: 0.6,
        lastValidatedAt: "2026-03-06T12:00:00Z", // 2 days ago
      });
      vi.mocked(mockStore.queryLearnings).mockReturnValue([freshLearning]);

      await behavior.act(scheduleEvent, state, comm);

      expect(mockStore.updateLearning).not.toHaveBeenCalled();
    });

    it("should generate weekly summary for user", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      vi.mocked(state.getMeta).mockImplementation((key: string) => {
        if (key === "last_review_at") return "2026-03-07T12:00:00Z";
        if (key === "last_weekly_review_at") return null;
        return null;
      });

      vi.mocked(mockStore.pruneStale).mockReturnValue(3);

      await behavior.act(scheduleEvent, state, comm);

      expect(comm.sendImportant).toHaveBeenCalled();
    });

    it("should update last_weekly_review_at after weekly review", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      vi.mocked(state.getMeta).mockImplementation((key: string) => {
        if (key === "last_review_at") return "2026-03-07T12:00:00Z";
        if (key === "last_weekly_review_at") return null;
        return null;
      });

      await behavior.act(scheduleEvent, state, comm);

      expect(state.setMeta).toHaveBeenCalledWith(
        "last_weekly_review_at",
        expect.any(String),
      );
    });

    it("should log decision for weekly review", async () => {
      const { createMemoryReviewer } = await import(
        "../../../../src/services/adjutant/behaviors/memory-reviewer.js"
      );
      const behavior = createMemoryReviewer(mockStore);
      const state = createMockState();
      const comm = createMockComm();

      vi.mocked(state.getMeta).mockImplementation((key: string) => {
        if (key === "last_review_at") return "2026-03-07T12:00:00Z";
        if (key === "last_weekly_review_at") return null;
        return null;
      });

      await behavior.act(scheduleEvent, state, comm);

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "memory-reviewer",
          action: "weekly_review",
        }),
      );
    });
  });
});
