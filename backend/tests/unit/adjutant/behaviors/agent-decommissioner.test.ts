import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { AgentProfile } from "../../../../src/services/adjutant/state-store.js";

// Mock external dependencies before importing the module under test
vi.mock("../../../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
}));

// Import mocked modules so we can set up return values
import { execBd } from "../../../../src/services/bd-client.js";
import { createAgentDecommissioner } from "../../../../src/services/adjutant/behaviors/agent-decommissioner.js";

const mockExecBd = vi.mocked(execBd);

function createMockState() {
  return {
    getAllAgentProfiles: vi.fn((): AgentProfile[] => []),
    getAgentProfile: vi.fn(),
    upsertAgentProfile: vi.fn(),
    incrementAssignmentCount: vi.fn(),
    logDecision: vi.fn(),
    getRecentDecisions: vi.fn(),
    getMeta: vi.fn((): string | null => null),
    setMeta: vi.fn(),
    pruneOldDecisions: vi.fn(),
    logSpawn: vi.fn(),
    getSpawnHistory: vi.fn(),
    getAgentSpawnHistory: vi.fn(),
    markDecommissioned: vi.fn(),
    getLastSpawn: vi.fn(),
    countActiveSpawns: vi.fn(),
  };
}

function createMockComm() {
  return {
    messageAgent: vi.fn(async () => {}),
    queueRoutine: vi.fn(),
    sendImportant: vi.fn(async () => {}),
    escalate: vi.fn(async () => {}),
    flushRoutineQueue: vi.fn(),
    getRoutineQueueLength: vi.fn(),
  };
}

function makeProfile(overrides: Partial<AgentProfile> & { agentId: string }): AgentProfile {
  return {
    agentId: overrides.agentId,
    lastStatus: overrides.lastStatus ?? "idle",
    lastStatusAt: overrides.lastStatusAt ?? "2026-01-01T12:00:00Z",
    lastActivity: overrides.lastActivity ?? null,
    currentTask: overrides.currentTask ?? null,
    currentBeadId: overrides.currentBeadId ?? null,
    connectedAt: overrides.connectedAt ?? "2026-01-01T11:00:00Z",
    disconnectedAt: overrides.disconnectedAt ?? null,
    assignmentCount: overrides.assignmentCount ?? 0,
    lastEpicId: overrides.lastEpicId ?? null,
  };
}

const dummyEvent: BehaviorEvent = {
  name: "agent:status_changed",
  data: {},
  seq: 1,
};

describe("createAgentDecommissioner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T13:00:00Z"));
    mockExecBd.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have correct name, triggers, and schedule", () => {
    const behavior = createAgentDecommissioner();
    expect(behavior.name).toBe("agent-decommissioner");
    expect(behavior.triggers).toEqual(["agent:status_changed"]);
    expect(behavior.schedule).toBe("*/30 * * * *");
  });

  it("should not target adjutant-coordinator", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for 60 minutes
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "adjutant-coordinator",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:00:00Z",
      }),
    ]);
    // no beads
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
    expect(comm.escalate).not.toHaveBeenCalled();
  });

  it("should not target adjutant", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for 60 minutes
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "adjutant",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:00:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
    expect(comm.escalate).not.toHaveBeenCalled();
  });

  it("should not target agents idle less than 30 minutes", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for only 20 minutes
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "agent-fresh",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:40:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("should not target disconnected agents", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for 60 min but disconnected
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "agent-disc",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:00:00Z",
        disconnectedAt: "2026-01-01T12:30:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("should not target agents with in-progress beads", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for 35 minutes, still connected
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "busy-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    // Has in-progress beads
    mockExecBd.mockResolvedValue({
      success: true,
      data: [{ id: "adj-100", title: "Some task", status: "in_progress" }],
      exitCode: 0,
    });

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("should send shutdown suggestion to idle agent", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for 35 minutes, still connected
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "idle-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    // No beads
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
    // Not previously warned
    state.getMeta.mockReturnValue(null);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).toHaveBeenCalledOnce();
    expect(comm.messageAgent).toHaveBeenCalledWith(
      "idle-agent",
      expect.stringContaining("shutting down"),
    );
  });

  it("should set warning meta after sending suggestion", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for 35 minutes
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "idle-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
    state.getMeta.mockReturnValue(null);

    await behavior.act(dummyEvent, state, comm);

    expect(state.setMeta).toHaveBeenCalledWith(
      "decommission-warned:idle-agent",
      expect.any(String),
    );
  });

  it("should debounce same agent within 30 minutes", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for 35 minutes
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "idle-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
    state.getMeta.mockReturnValue(null);

    // First call - should send
    await behavior.act(dummyEvent, state, comm);
    expect(comm.messageAgent).toHaveBeenCalledOnce();

    // Advance 10 minutes (still within debounce window)
    vi.setSystemTime(new Date("2026-01-01T13:10:00Z"));
    comm.messageAgent.mockClear();

    // Second call - should be debounced
    await behavior.act(dummyEvent, state, comm);
    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("should escalate if agent still idle after warning period", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    // idle for 65 minutes (since 12:25 at time 13:30 = 65 min)
    vi.setSystemTime(new Date("2026-01-01T13:30:00Z"));
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "stubborn-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
    // Was warned 35 minutes ago
    const warnedAt = new Date("2026-01-01T12:55:00Z").getTime().toString();
    state.getMeta.mockImplementation((key: string) => {
      if (key === "decommission-warned:stubborn-agent") return warnedAt;
      return null;
    });

    await behavior.act(dummyEvent, state, comm);

    expect(comm.escalate).toHaveBeenCalledOnce();
    expect(comm.escalate).toHaveBeenCalledWith(
      expect.stringContaining("stubborn-agent"),
    );
  });

  it("should clear warning meta after escalation", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    vi.setSystemTime(new Date("2026-01-01T13:30:00Z"));
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "stubborn-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
    // Was warned 35 minutes ago
    const warnedAt = new Date("2026-01-01T12:55:00Z").getTime().toString();
    state.getMeta.mockImplementation((key: string) => {
      if (key === "decommission-warned:stubborn-agent") return warnedAt;
      return null;
    });

    await behavior.act(dummyEvent, state, comm);

    // Should clear the warning meta (set to empty or delete)
    expect(state.setMeta).toHaveBeenCalledWith(
      "decommission-warned:stubborn-agent",
      "",
    );
  });

  it("should log decision for each action", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "idle-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
    state.getMeta.mockReturnValue(null);

    await behavior.act(dummyEvent, state, comm);

    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "agent-decommissioner",
        target: "idle-agent",
      }),
    );
  });

  it("should handle bd list failure gracefully", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "idle-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    // bd list fails
    mockExecBd.mockRejectedValue(new Error("bd command failed"));
    state.getMeta.mockReturnValue(null);

    // Should still process agent (assume no beads on failure)
    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).toHaveBeenCalledOnce();
    expect(comm.messageAgent).toHaveBeenCalledWith(
      "idle-agent",
      expect.stringContaining("shutting down"),
    );
  });

  it("should handle agents with status 'done' same as 'idle'", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "done-agent",
        lastStatus: "done",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
    state.getMeta.mockReturnValue(null);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).toHaveBeenCalledOnce();
    expect(comm.messageAgent).toHaveBeenCalledWith(
      "done-agent",
      expect.stringContaining("shutting down"),
    );
  });

  it("shouldAct always returns true", () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    expect(behavior.shouldAct(dummyEvent, state as any)).toBe(true);
  });

  it("should mark spawn as decommissioned on escalation if spawn exists", async () => {
    const behavior = createAgentDecommissioner();
    const state = createMockState();
    const comm = createMockComm();
    vi.setSystemTime(new Date("2026-01-01T13:30:00Z"));
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "stubborn-agent",
        lastStatus: "idle",
        lastStatusAt: "2026-01-01T12:25:00Z",
      }),
    ]);
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
    const warnedAt = new Date("2026-01-01T12:55:00Z").getTime().toString();
    state.getMeta.mockImplementation((key: string) => {
      if (key === "decommission-warned:stubborn-agent") return warnedAt;
      return null;
    });
    // Has a spawn record
    state.getLastSpawn.mockReturnValue({
      id: 42,
      agentId: "stubborn-agent",
      spawnedAt: "2026-01-01T11:00:00Z",
      reason: null,
      beadId: null,
      decommissionedAt: null,
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.markDecommissioned).toHaveBeenCalledWith(42);
  });
});
