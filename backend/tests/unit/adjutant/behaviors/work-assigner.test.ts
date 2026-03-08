import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { AgentProfile } from "../../../../src/services/adjutant/state-store.js";

// Mock external dependencies before importing the module under test
vi.mock("../../../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
}));

vi.mock("../../../../src/services/beads/beads-mutations.js", () => ({
  updateBead: vi.fn(),
}));

vi.mock("../../../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
  })),
}));

// Import mocked modules so we can set up return values
import { execBd } from "../../../../src/services/bd-client.js";
import { updateBead } from "../../../../src/services/beads/beads-mutations.js";
import { getEventBus } from "../../../../src/services/event-bus.js";
import { createWorkAssigner } from "../../../../src/services/adjutant/behaviors/work-assigner.js";

// Typed mock references
const mockExecBd = vi.mocked(execBd);
const mockUpdateBead = vi.mocked(updateBead);
const mockGetEventBus = vi.mocked(getEventBus);

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
    lastStatus: overrides.lastStatus ?? "idle",
    lastStatusAt: overrides.lastStatusAt ?? "2026-01-01T12:00:00Z",
    lastActivity: overrides.lastActivity ?? "2026-01-01T12:00:00Z",
    currentTask: overrides.currentTask ?? null,
    currentBeadId: overrides.currentBeadId ?? null,
    connectedAt: overrides.connectedAt ?? "2026-01-01T11:00:00Z",
    disconnectedAt: overrides.disconnectedAt ?? null,
    assignmentCount: overrides.assignmentCount ?? 0,
    lastEpicId: overrides.lastEpicId ?? null,
  };
}

const dummyEvent: BehaviorEvent = {
  name: "bead:created",
  data: {},
  seq: 1,
};

describe("createWorkAssigner", () => {
  let mockEmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    vi.clearAllMocks();

    mockEmit = vi.fn();
    mockGetEventBus.mockReturnValue({ emit: mockEmit } as ReturnType<typeof getEventBus>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has name 'work-assigner'", () => {
    const behavior = createWorkAssigner();
    expect(behavior.name).toBe("work-assigner");
  });

  it("has schedule '*/5 * * * *'", () => {
    const behavior = createWorkAssigner();
    expect(behavior.schedule).toBe("*/5 * * * *");
  });

  it("triggers on bead:created, agent:status_changed, bead:closed", () => {
    const behavior = createWorkAssigner();
    expect(behavior.triggers).toContain("bead:created");
    expect(behavior.triggers).toContain("agent:status_changed");
    expect(behavior.triggers).toContain("bead:closed");
  });

  // ========================================================================
  // shouldAct tests
  // ========================================================================

  it("should not act within 30s debounce window", () => {
    const behavior = createWorkAssigner();
    const state = createMockState();

    // Set last-assigned-at to 10 seconds ago
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    state.getMeta.mockImplementation((key: string) =>
      key === "work-assigner:last-assigned-at" ? tenSecondsAgo : null,
    );

    // No idle agents -> shouldAct returns false regardless, but let's test debounce
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    expect(behavior.shouldAct(dummyEvent, state)).toBe(false);
  });

  it("shouldAct returns true when idle agents exist and debounce expired", () => {
    const behavior = createWorkAssigner();
    const state = createMockState();

    // No recent assignment
    state.getMeta.mockReturnValue(null);
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    expect(behavior.shouldAct(dummyEvent, state)).toBe(true);
  });

  it("shouldAct returns false when no idle connected agents", () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    state.getMeta.mockReturnValue(null);
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    expect(behavior.shouldAct(dummyEvent, state)).toBe(false);
  });

  it("shouldAct returns false when idle agent is disconnected (ghost/stale)", () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    state.getMeta.mockReturnValue(null);
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "ghost-agent",
        lastStatus: "idle",
        connectedAt: "2026-01-01T10:00:00Z",
        disconnectedAt: "2026-01-01T11:00:00Z",  // disconnected = ghost
      }),
    ]);

    expect(behavior.shouldAct(dummyEvent, state)).toBe(false);
  });

  // ========================================================================
  // act() tests
  // ========================================================================

  it("should not act when no idle agents exist", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(mockUpdateBead).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("should assign highest priority bead to idle agent", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    // bd ready returns two beads: P1 and P2
    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "High priority", priority: 1, type: "task" },
        { id: "adj-002", title: "Low priority", priority: 2, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "agent-1" },
    });

    await behavior.act(dummyEvent, state, comm);

    // Should assign P1 (highest priority = lowest number)
    expect(mockUpdateBead).toHaveBeenCalledWith("adj-001", {
      status: "in_progress",
      assignee: "agent-1",
    });
  });

  it("should prefer agent with matching epic affinity", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    // Two idle agents: one with epic affinity, one without
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "agent-no-affinity",
        lastStatus: "idle",
        connectedAt: "2026-01-01T11:00:00Z",
        disconnectedAt: null,
        lastActivity: "2026-01-01T11:55:00Z",
        lastEpicId: null,
      }),
      makeProfile({
        agentId: "agent-with-affinity",
        lastStatus: "idle",
        connectedAt: "2026-01-01T11:00:00Z",
        disconnectedAt: null,
        lastActivity: "2026-01-01T11:50:00Z",
        lastEpicId: "adj-epic-1",
      }),
    ]);

    // One bead whose parent epic matches "adj-epic-1"
    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-epic-1.1", title: "Sub-task of epic 1", priority: 1, type: "task", parent: "adj-epic-1" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-epic-1.1", status: "in_progress", assignee: "agent-with-affinity" },
    });

    await behavior.act(dummyEvent, state, comm);

    // Agent with affinity should be preferred even though agent-no-affinity has more recent activity
    expect(mockUpdateBead).toHaveBeenCalledWith("adj-epic-1.1", {
      status: "in_progress",
      assignee: "agent-with-affinity",
    });
  });

  it("should filter out ghost/stale agents", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      // Ghost agent: idle but disconnected
      makeProfile({
        agentId: "ghost-agent",
        lastStatus: "idle",
        connectedAt: "2026-01-01T10:00:00Z",
        disconnectedAt: "2026-01-01T11:00:00Z",
      }),
      // Real idle agent
      makeProfile({
        agentId: "real-agent",
        lastStatus: "idle",
        connectedAt: "2026-01-01T11:00:00Z",
        disconnectedAt: null,
      }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "real-agent" },
    });

    await behavior.act(dummyEvent, state, comm);

    // Should only assign to the real agent, not the ghost
    expect(mockUpdateBead).toHaveBeenCalledWith("adj-001", {
      status: "in_progress",
      assignee: "real-agent",
    });
  });

  it("should use updateBead not raw execBd for assignment", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "agent-1" },
    });

    await behavior.act(dummyEvent, state, comm);

    // Verify updateBead is called (not raw execBd for update)
    expect(mockUpdateBead).toHaveBeenCalledOnce();
    expect(mockUpdateBead).toHaveBeenCalledWith("adj-001", {
      status: "in_progress",
      assignee: "agent-1",
    });

    // execBd should only be called for "bd ready", not for update
    expect(mockExecBd).toHaveBeenCalledOnce();
    expect(mockExecBd).toHaveBeenCalledWith(["ready", "--json"]);
  });

  it("should emit bead:assigned event after successful assignment", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "agent-1" },
    });

    await behavior.act(dummyEvent, state, comm);

    expect(mockEmit).toHaveBeenCalledWith("bead:assigned", {
      beadId: "adj-001",
      agentId: "agent-1",
      assignedBy: "work-assigner",
    });
  });

  it("should not message agent directly (bead-assign-notification handles it)", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "agent-1" },
    });

    await behavior.act(dummyEvent, state, comm);

    // comm.messageAgent should NOT be called — bead-assign-notification handles messaging
    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("should prevent concurrent assignments via lock", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    // Make execBd slow to simulate concurrent calls
    let resolveExecBd!: (value: unknown) => void;
    const slowExecBd = new Promise((res) => { resolveExecBd = res; });
    mockExecBd.mockImplementationOnce(() => slowExecBd as ReturnType<typeof execBd>);

    // Start first act() — it will block on execBd
    const act1 = behavior.act(dummyEvent, state, comm);

    // Start second act() immediately — should return early due to lock
    mockExecBd.mockResolvedValueOnce({
      success: true,
      data: [{ id: "adj-002", title: "Task 2", priority: 1, type: "task" }],
      exitCode: 0,
    });
    const act2 = behavior.act(dummyEvent, state, comm);

    // Resolve the first execBd
    resolveExecBd({
      success: true,
      data: [{ id: "adj-001", title: "Task 1", priority: 1, type: "task" }],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "agent-1" },
    });

    await Promise.all([act1, act2]);

    // Only one assignment should happen (the other was blocked by lock)
    expect(mockUpdateBead).toHaveBeenCalledTimes(1);
  });

  it("should increment assignment count after assignment", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "agent-1" },
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.incrementAssignmentCount).toHaveBeenCalledWith("agent-1");
  });

  it("should log decision after assignment", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "agent-1" },
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "work-assigner",
        action: "assigned",
        target: "adj-001",
      }),
    );
  });

  it("should return early when bd ready returns no beads", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await behavior.act(dummyEvent, state, comm);

    expect(mockUpdateBead).not.toHaveBeenCalled();
  });

  it("should return early when bd ready fails", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: false,
      error: { code: "COMMAND_FAILED", message: "bd ready failed" },
      exitCode: 1,
    });

    await behavior.act(dummyEvent, state, comm);

    expect(mockUpdateBead).not.toHaveBeenCalled();
  });

  it("should update lastEpicId on agent profile when bead has parent epic", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-epic-1.1", title: "Sub-task", priority: 1, type: "task", parent: "adj-epic-1" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-epic-1.1", status: "in_progress", assignee: "agent-1" },
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.upsertAgentProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        lastEpicId: "adj-epic-1",
      }),
    );
  });

  it("should update debounce meta after successful assignment", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "agent-1" },
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.setMeta).toHaveBeenCalledWith(
      "work-assigner:last-assigned-at",
      expect.any(String),
    );
  });

  it("should prefer most recently idle agent as tiebreaker", async () => {
    const behavior = createWorkAssigner();
    const state = createMockState();
    const comm = createMockComm();

    // Two idle agents with no epic affinity, different lastActivity times
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({
        agentId: "older-idle",
        lastStatus: "idle",
        connectedAt: "2026-01-01T11:00:00Z",
        disconnectedAt: null,
        lastActivity: "2026-01-01T11:30:00Z",
        lastEpicId: null,
      }),
      makeProfile({
        agentId: "newer-idle",
        lastStatus: "idle",
        connectedAt: "2026-01-01T11:00:00Z",
        disconnectedAt: null,
        lastActivity: "2026-01-01T11:55:00Z",
        lastEpicId: null,
      }),
    ]);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockUpdateBead.mockResolvedValue({
      success: true,
      data: { id: "adj-001", status: "in_progress", assignee: "newer-idle" },
    });

    await behavior.act(dummyEvent, state, comm);

    // newer-idle should be preferred (most recently active)
    expect(mockUpdateBead).toHaveBeenCalledWith("adj-001", {
      status: "in_progress",
      assignee: "newer-idle",
    });
  });
});
