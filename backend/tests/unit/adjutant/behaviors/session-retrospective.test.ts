// Suppress logging
vi.mock("../../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";

import { createSessionRetrospective } from "../../../../src/services/adjutant/behaviors/session-retrospective.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { MemoryStore } from "../../../../src/services/adjutant/memory-store.js";

function createMockState() {
  return {
    upsertAgentProfile: vi.fn(),
    logDecision: vi.fn(),
    getAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn().mockReturnValue([]),
    getRecentDecisions: vi.fn().mockReturnValue([]),
    getMeta: vi.fn().mockReturnValue(null),
    setMeta: vi.fn(),
    incrementAssignmentCount: vi.fn(),
    pruneOldDecisions: vi.fn(),
  };
}

function createMockComm() {
  return {
    queueRoutine: vi.fn(),
    sendImportant: vi.fn().mockResolvedValue(undefined),
    escalate: vi.fn(),
    messageAgent: vi.fn(),
    flushRoutineQueue: vi.fn(() => [] as string[]),
    getRoutineQueueLength: vi.fn(),
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
    pruneStale: vi.fn(),
    insertRetrospective: vi.fn().mockReturnValue({
      id: 1,
      sessionDate: "2026-03-08",
      beadsClosed: 0,
      beadsFailed: 0,
      correctionsReceived: 0,
      agentsUsed: 0,
      avgBeadTimeMins: null,
      wentWell: null,
      wentWrong: null,
      actionItems: null,
      metrics: null,
      createdAt: "2026-03-08T23:00:00Z",
    }),
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

function makeCronEvent(): BehaviorEvent {
  return {
    name: "session-retrospective" as BehaviorEvent["name"],
    data: { cronTick: true, behavior: "session-retrospective" },
    seq: 1,
  };
}

describe("createSessionRetrospective", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the name "session-retrospective"', () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    expect(behavior.name).toBe("session-retrospective");
  });

  it('has schedule "0 23 * * *"', () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    expect(behavior.schedule).toBe("0 23 * * *");
  });

  it("has an empty triggers array", () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    expect(behavior.triggers).toEqual([]);
  });

  it("shouldAct always returns true", () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    expect(behavior.shouldAct(makeCronEvent(), state)).toBe(true);
  });
});

describe("session-retrospective act()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gathers beads closed count from recent decisions", async () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    const comm = createMockComm();

    state.getRecentDecisions.mockReturnValue([
      { behavior: "work-assigner", action: "close_bead", target: "adj-001", reason: null, createdAt: new Date().toISOString() },
      { behavior: "work-assigner", action: "close_bead", target: "adj-002", reason: null, createdAt: new Date().toISOString() },
      { behavior: "user", action: "update_status", target: "adj-003", reason: null, createdAt: new Date().toISOString() },
    ]);

    await behavior.act(makeCronEvent(), state, comm);

    // Should have called insertRetrospective with beadsClosed >= 2
    expect(memoryStore.insertRetrospective).toHaveBeenCalledOnce();
    const retroArg = (memoryStore.insertRetrospective as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(retroArg.beadsClosed).toBe(2);
  });

  it("gathers beads failed count from decisions with reopen/failure actions", async () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    const comm = createMockComm();

    state.getRecentDecisions.mockReturnValue([
      { behavior: "some", action: "reopen_bead", target: "adj-001", reason: null, createdAt: new Date().toISOString() },
      { behavior: "some", action: "failure_detected", target: "adj-002", reason: null, createdAt: new Date().toISOString() },
    ]);

    await behavior.act(makeCronEvent(), state, comm);

    const retroArg = (memoryStore.insertRetrospective as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(retroArg.beadsFailed).toBe(2);
  });

  it("gathers corrections received count from memory store", async () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    const comm = createMockComm();

    (memoryStore.getUnresolvedCorrections as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 1, correctionType: "approach", pattern: "no", description: "test", recurrenceCount: 0, resolved: false, createdAt: new Date().toISOString() },
      { id: 2, correctionType: "approach", pattern: "wrong", description: "test2", recurrenceCount: 0, resolved: false, createdAt: new Date().toISOString() },
      { id: 3, correctionType: "approach", pattern: "stop", description: "test3", recurrenceCount: 0, resolved: false, createdAt: new Date().toISOString() },
    ]);

    await behavior.act(makeCronEvent(), state, comm);

    const retroArg = (memoryStore.insertRetrospective as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(retroArg.correctionsReceived).toBe(3);
  });

  it("gathers agents used count from agent profiles with recent activity", async () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    const comm = createMockComm();

    const today = new Date().toISOString().split("T")[0];
    state.getAllAgentProfiles.mockReturnValue([
      { agentId: "agent-1", lastActivity: `${today}T10:00:00Z`, lastStatus: "working" },
      { agentId: "agent-2", lastActivity: `${today}T11:00:00Z`, lastStatus: "done" },
      { agentId: "agent-3", lastActivity: "2026-01-01T00:00:00Z", lastStatus: "idle" },
    ]);

    await behavior.act(makeCronEvent(), state, comm);

    const retroArg = (memoryStore.insertRetrospective as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(retroArg.agentsUsed).toBe(2);
  });

  it("persists the retrospective via memoryStore.insertRetrospective", async () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    expect(memoryStore.insertRetrospective).toHaveBeenCalledOnce();
    const retroArg = (memoryStore.insertRetrospective as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(retroArg).toHaveProperty("sessionDate");
    expect(retroArg).toHaveProperty("beadsClosed");
    expect(retroArg).toHaveProperty("beadsFailed");
    expect(retroArg).toHaveProperty("correctionsReceived");
    expect(retroArg).toHaveProperty("agentsUsed");
  });

  it("logs decision after successful retrospective", async () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    expect(state.logDecision).toHaveBeenCalledOnce();
    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "session-retrospective",
        action: "retrospective_generated",
      }),
    );
  });

  it("handles errors gracefully without throwing", async () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    const comm = createMockComm();

    // Make getRecentDecisions throw
    state.getRecentDecisions.mockImplementation(() => {
      throw new Error("Database error");
    });

    await expect(
      behavior.act(makeCronEvent(), state, comm),
    ).resolves.toBeUndefined();
  });

  it("sets sessionDate to today's date in YYYY-MM-DD format", async () => {
    const memoryStore = createMockMemoryStore();
    const behavior = createSessionRetrospective(memoryStore);
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(makeCronEvent(), state, comm);

    const retroArg = (memoryStore.insertRetrospective as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(retroArg.sessionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
