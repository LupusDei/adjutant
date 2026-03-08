import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AdjutantState } from "../../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../../src/services/adjutant/communication.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";

const { mockIsAlive, mockSpawn } = vi.hoisted(() => ({
  mockIsAlive: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("../../../../src/services/adjutant-spawner.js", () => ({
  isAdjutantAlive: mockIsAlive,
  spawnAdjutant: mockSpawn,
}));

// Import after mock setup
const { createHealthMonitorBehavior } = await import(
  "../../../../src/services/adjutant/behaviors/health-monitor.js"
);

function createMockState(): AdjutantState {
  return {
    getAgentProfile: vi.fn(),
    upsertAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn().mockReturnValue([]),
    logDecision: vi.fn(),
    getRecentDecisions: vi.fn().mockReturnValue([]),
    getMeta: vi.fn().mockReturnValue(null),
    setMeta: vi.fn(),
  };
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

const dummyEvent: BehaviorEvent = {
  name: "agent:status_changed",
  data: {},
  seq: 1,
};

describe("createHealthMonitorBehavior", () => {
  const projectPath = "/test/project";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'health-monitor'", () => {
    const behavior = createHealthMonitorBehavior(projectPath);
    expect(behavior.name).toBe("health-monitor");
  });

  it("has empty triggers array", () => {
    const behavior = createHealthMonitorBehavior(projectPath);
    expect(behavior.triggers).toEqual([]);
  });

  it("has schedule '*/5 * * * *'", () => {
    const behavior = createHealthMonitorBehavior(projectPath);
    expect(behavior.schedule).toBe("*/5 * * * *");
  });

  it("shouldAct always returns true", () => {
    const behavior = createHealthMonitorBehavior(projectPath);
    const state = createMockState();
    expect(behavior.shouldAct(dummyEvent, state)).toBe(true);
  });

  it("when Adjutant is alive: sets last_healthy meta, does NOT spawn", async () => {
    mockIsAlive.mockResolvedValue(true);
    const behavior = createHealthMonitorBehavior(projectPath);
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(dummyEvent, state, comm);

    expect(mockIsAlive).toHaveBeenCalled();
    expect(state.setMeta).toHaveBeenCalledWith(
      "adjutant_last_healthy",
      expect.any(String),
    );
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(state.logDecision).not.toHaveBeenCalled();
  });

  it("when Adjutant is dead: logs decision and calls spawnAdjutant with projectPath", async () => {
    mockIsAlive.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockSpawn.mockResolvedValue(undefined);
    const behavior = createHealthMonitorBehavior(projectPath);
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(dummyEvent, state, comm);

    expect(state.logDecision).toHaveBeenCalledWith({
      behavior: "health-monitor",
      action: "respawn_adjutant",
      target: "adjutant-coordinator",
      reason: "Adjutant agent tmux session not found",
    });
    expect(mockSpawn).toHaveBeenCalledWith(projectPath);
  });

  it("when respawn succeeds: sets last_respawn meta and queues routine message", async () => {
    mockIsAlive.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockSpawn.mockResolvedValue(undefined);
    const behavior = createHealthMonitorBehavior(projectPath);
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(dummyEvent, state, comm);

    expect(state.setMeta).toHaveBeenCalledWith(
      "adjutant_last_respawn",
      expect.any(String),
    );
    expect(comm.queueRoutine).toHaveBeenCalledWith(
      "Health monitor: Adjutant agent was down, respawned successfully",
    );
  });

  it("when respawn fails: calls sendImportant with warning", async () => {
    mockIsAlive.mockResolvedValue(false);
    mockSpawn.mockResolvedValue(undefined);
    const behavior = createHealthMonitorBehavior(projectPath);
    const state = createMockState();
    const comm = createMockComm();

    await behavior.act(dummyEvent, state, comm);

    expect(comm.sendImportant).toHaveBeenCalledWith(
      expect.stringContaining("Health monitor: Adjutant agent is down and respawn failed"),
    );
  });
});
