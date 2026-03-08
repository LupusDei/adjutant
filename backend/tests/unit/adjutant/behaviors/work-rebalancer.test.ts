import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createWorkRebalancer } from "../../../../src/services/adjutant/behaviors/work-rebalancer.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { AgentProfile } from "../../../../src/services/adjutant/state-store.js";
import type { BeadsIssue } from "../../../../src/services/bd-client.js";

// Mock execBd
vi.mock("../../../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
}));

// Mock updateBead
vi.mock("../../../../src/services/beads/beads-mutations.js", () => ({
  updateBead: vi.fn(),
}));

import { execBd } from "../../../../src/services/bd-client.js";
import { updateBead } from "../../../../src/services/beads/beads-mutations.js";

const mockedExecBd = vi.mocked(execBd);
const mockedUpdateBead = vi.mocked(updateBead);

function createMockState() {
  return {
    getAllAgentProfiles: vi.fn((): AgentProfile[] => []),
    logDecision: vi.fn(),
    upsertAgentProfile: vi.fn(),
    getAgentProfile: vi.fn(),
    getRecentDecisions: vi.fn(),
    getMeta: vi.fn(),
    setMeta: vi.fn(),
    incrementAssignmentCount: vi.fn(),
    pruneOldDecisions: vi.fn(),
  };
}

function createMockComm() {
  return {
    messageAgent: vi.fn(async () => {}),
    queueRoutine: vi.fn(),
    sendImportant: vi.fn(),
    escalate: vi.fn(),
    flushRoutineQueue: vi.fn(),
    getRoutineQueueLength: vi.fn(),
  };
}

function makeProfile(overrides: Partial<AgentProfile> & { agentId: string }): AgentProfile {
  return {
    agentId: overrides.agentId,
    lastStatus: overrides.lastStatus ?? "working",
    lastStatusAt: overrides.lastStatusAt ?? "2026-01-01T12:00:00Z",
    lastActivity: overrides.lastActivity ?? null,
    currentTask: overrides.currentTask ?? null,
    currentBeadId: overrides.currentBeadId ?? null,
    connectedAt: overrides.connectedAt ?? null,
    disconnectedAt: overrides.disconnectedAt ?? null,
    assignmentCount: overrides.assignmentCount ?? 0,
    lastEpicId: overrides.lastEpicId ?? null,
  };
}

function makeDisconnectEvent(agentId: string): BehaviorEvent {
  return {
    name: "mcp:agent_disconnected",
    data: { agentId, sessionId: "session-123" },
    seq: 1,
  };
}

function makeStatusChangedEvent(agentId: string, status: string): BehaviorEvent {
  return {
    name: "agent:status_changed",
    data: { agent: agentId, status },
    seq: 1,
  };
}

function makeBeadIssue(id: string, assignee: string): BeadsIssue {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    status: "in_progress",
    priority: 2,
    issue_type: "task",
    created_at: "2026-01-01T10:00:00Z",
    assignee,
  };
}

describe("createWorkRebalancer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'work-rebalancer'", () => {
    const behavior = createWorkRebalancer();
    expect(behavior.name).toBe("work-rebalancer");
  });

  it("triggers on 'mcp:agent_disconnected' only", () => {
    const behavior = createWorkRebalancer();
    expect(behavior.triggers).toEqual(["mcp:agent_disconnected"]);
  });

  it("has no schedule (event-driven only)", () => {
    const behavior = createWorkRebalancer();
    expect(behavior.schedule).toBeUndefined();
  });

  // Test 1: should not act on agent:status_changed to blocked
  it("should not act on agent:status_changed to blocked", () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const event = makeStatusChangedEvent("agent-a", "blocked");

    const result = behavior.shouldAct(event, state);
    expect(result).toBe(false);
  });

  it("should act on mcp:agent_disconnected event", () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );
    const event = makeDisconnectEvent("agent-a");

    const result = behavior.shouldAct(event, state);
    expect(result).toBe(true);
  });

  it("shouldAct returns false if disconnected agent has no profile", () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    state.getAgentProfile.mockReturnValue(null);
    const event = makeDisconnectEvent("unknown-agent");

    const result = behavior.shouldAct(event, state);
    expect(result).toBe(false);
  });

  // Test 2: should not act if disconnected agent has no in-progress beads
  it("should not act if disconnected agent has no in-progress beads", async () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const comm = createMockComm();
    const event = makeDisconnectEvent("agent-a");

    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );

    // bd list returns empty
    mockedExecBd.mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await behavior.act(event, state, comm);

    expect(mockedUpdateBead).not.toHaveBeenCalled();
    expect(comm.queueRoutine).not.toHaveBeenCalled();
  });

  // Test 3: should unassign orphaned beads when agent disconnects
  it("should unassign orphaned beads when agent disconnects", async () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const comm = createMockComm();
    const event = makeDisconnectEvent("agent-a");

    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );

    // bd list returns 2 in-progress beads
    mockedExecBd.mockResolvedValue({
      success: true,
      data: [
        makeBeadIssue("adj-001", "agent-a"),
        makeBeadIssue("adj-002", "agent-a"),
      ],
      exitCode: 0,
    });

    mockedUpdateBead.mockResolvedValue({ success: true, data: { id: "adj-001", status: "open", assignee: "" } });

    await behavior.act(event, state, comm);

    expect(mockedUpdateBead).toHaveBeenCalledTimes(2);
    expect(mockedUpdateBead).toHaveBeenCalledWith("adj-001", { status: "open", assignee: "" });
    expect(mockedUpdateBead).toHaveBeenCalledWith("adj-002", { status: "open", assignee: "" });
  });

  // Test 4: should use updateBead not raw execBd for updates
  it("should use updateBead not raw execBd for bead updates", async () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const comm = createMockComm();
    const event = makeDisconnectEvent("agent-a");

    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );

    mockedExecBd.mockResolvedValue({
      success: true,
      data: [makeBeadIssue("adj-001", "agent-a")],
      exitCode: 0,
    });

    mockedUpdateBead.mockResolvedValue({ success: true, data: { id: "adj-001", status: "open", assignee: "" } });

    await behavior.act(event, state, comm);

    // updateBead should be called for the unassignment
    expect(mockedUpdateBead).toHaveBeenCalledOnce();

    // execBd should only be called once — for bd list, NOT for update
    expect(mockedExecBd).toHaveBeenCalledOnce();
    expect(mockedExecBd).toHaveBeenCalledWith(
      expect.arrayContaining(["list"]),
      expect.any(Object),
    );
  });

  // Test 5: should queue routine message summarizing rebalanced beads
  it("should queue routine message summarizing rebalanced beads", async () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const comm = createMockComm();
    const event = makeDisconnectEvent("agent-a");

    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );

    mockedExecBd.mockResolvedValue({
      success: true,
      data: [
        makeBeadIssue("adj-001", "agent-a"),
        makeBeadIssue("adj-002", "agent-a"),
      ],
      exitCode: 0,
    });

    mockedUpdateBead.mockResolvedValue({ success: true, data: { id: "test", status: "open", assignee: "" } });

    await behavior.act(event, state, comm);

    expect(comm.queueRoutine).toHaveBeenCalledOnce();
    expect(comm.queueRoutine).toHaveBeenCalledWith(
      expect.stringContaining("agent-a"),
    );
    expect(comm.queueRoutine).toHaveBeenCalledWith(
      expect.stringContaining("adj-001"),
    );
    expect(comm.queueRoutine).toHaveBeenCalledWith(
      expect.stringContaining("adj-002"),
    );
  });

  // Test 6: should log decision for each unassigned bead
  it("should log decision for each unassigned bead", async () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const comm = createMockComm();
    const event = makeDisconnectEvent("agent-a");

    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );

    mockedExecBd.mockResolvedValue({
      success: true,
      data: [
        makeBeadIssue("adj-001", "agent-a"),
        makeBeadIssue("adj-002", "agent-a"),
      ],
      exitCode: 0,
    });

    mockedUpdateBead.mockResolvedValue({ success: true, data: { id: "test", status: "open", assignee: "" } });

    await behavior.act(event, state, comm);

    expect(state.logDecision).toHaveBeenCalledTimes(2);
    expect(state.logDecision).toHaveBeenCalledWith({
      behavior: "work-rebalancer",
      action: "bead_unassigned",
      target: "adj-001",
      reason: expect.stringContaining("agent-a"),
    });
    expect(state.logDecision).toHaveBeenCalledWith({
      behavior: "work-rebalancer",
      action: "bead_unassigned",
      target: "adj-002",
      reason: expect.stringContaining("agent-a"),
    });
  });

  // Test 7: should handle updateBead failure gracefully
  it("should handle updateBead failure gracefully", async () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const comm = createMockComm();
    const event = makeDisconnectEvent("agent-a");

    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );

    mockedExecBd.mockResolvedValue({
      success: true,
      data: [
        makeBeadIssue("adj-001", "agent-a"),
        makeBeadIssue("adj-002", "agent-a"),
        makeBeadIssue("adj-003", "agent-a"),
      ],
      exitCode: 0,
    });

    // First bead succeeds, second fails, third succeeds
    mockedUpdateBead
      .mockResolvedValueOnce({ success: true, data: { id: "adj-001", status: "open", assignee: "" } })
      .mockResolvedValueOnce({ success: false, error: { code: "UPDATE_FAILED", message: "db error" } })
      .mockResolvedValueOnce({ success: true, data: { id: "adj-003", status: "open", assignee: "" } });

    await behavior.act(event, state, comm);

    // All three should be attempted
    expect(mockedUpdateBead).toHaveBeenCalledTimes(3);

    // Decisions logged for successful unassignments
    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bead_unassigned", target: "adj-001" }),
    );
    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bead_unassign_failed", target: "adj-002" }),
    );
    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bead_unassigned", target: "adj-003" }),
    );

    // Routine message should mention successful ones
    expect(comm.queueRoutine).toHaveBeenCalledOnce();
    expect(comm.queueRoutine).toHaveBeenCalledWith(
      expect.stringContaining("adj-001"),
    );
  });

  it("should not act if bd list fails", async () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const comm = createMockComm();
    const event = makeDisconnectEvent("agent-a");

    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );

    mockedExecBd.mockResolvedValue({
      success: false,
      error: { code: "BD_ERROR", message: "command failed" },
      exitCode: 1,
    });

    await behavior.act(event, state, comm);

    expect(mockedUpdateBead).not.toHaveBeenCalled();
    expect(comm.queueRoutine).not.toHaveBeenCalled();
    // Should log the failure
    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "work-rebalancer",
        action: "list_beads_failed",
      }),
    );
  });

  it("should pass correct args to execBd for listing beads", async () => {
    const behavior = createWorkRebalancer();
    const state = createMockState();
    const comm = createMockComm();
    const event = makeDisconnectEvent("agent-a");

    state.getAgentProfile.mockReturnValue(
      makeProfile({ agentId: "agent-a", lastStatus: "working" }),
    );

    mockedExecBd.mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await behavior.act(event, state, comm);

    expect(mockedExecBd).toHaveBeenCalledWith(
      ["list", "--status", "in_progress", "--assignee", "agent-a", "--json"],
      expect.any(Object),
    );
  });
});
