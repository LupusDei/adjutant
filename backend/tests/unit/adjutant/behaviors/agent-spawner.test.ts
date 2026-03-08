import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { AgentProfile } from "../../../../src/services/adjutant/state-store.js";

// Mock external dependencies before importing the module under test
vi.mock("../../../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
}));

vi.mock("../../../../src/services/agent-spawner-service.js", () => ({
  spawnAgent: vi.fn(),
}));

vi.mock("../../../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
  })),
}));

// Import mocked modules so we can set up return values
import { execBd } from "../../../../src/services/bd-client.js";
import { spawnAgent } from "../../../../src/services/agent-spawner-service.js";
import { createAgentSpawnerBehavior } from "../../../../src/services/adjutant/behaviors/agent-spawner.js";

// Typed mock references
const mockExecBd = vi.mocked(execBd);
const mockSpawnAgent = vi.mocked(spawnAgent);

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
    logSpawn: vi.fn((): number => 1),
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

const PROJECT_PATH = "/tmp/test-project";

describe("createAgentSpawnerBehavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ========================================================================
  // Identity & metadata tests
  // ========================================================================

  it("should have correct name and triggers", () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    expect(behavior.name).toBe("agent-spawner");
    expect(behavior.triggers).toContain("bead:created");
    expect(behavior.triggers).toContain("bead:closed");
    // CRITICAL: must NOT trigger on bead:assigned (adj-ud2f)
    expect(behavior.triggers).not.toContain("bead:assigned");
  });

  it("should have */10 schedule", () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    expect(behavior.schedule).toBe("*/10 * * * *");
  });

  // ========================================================================
  // shouldAct tests
  // ========================================================================

  it("should not act within 60s cooldown", () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();

    // Set last-spawn-at to 30 seconds ago (within 60s cooldown)
    const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
    state.getMeta.mockImplementation((key: string) =>
      key === "agent-spawner:last-spawn-at" ? thirtySecondsAgo : null,
    );

    expect(behavior.shouldAct(dummyEvent, state)).toBe(false);
  });

  it("should act when cooldown has expired", () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();

    // Set last-spawn-at to 90 seconds ago (past 60s cooldown)
    const ninetySecondsAgo = new Date(Date.now() - 90_000).toISOString();
    state.getMeta.mockImplementation((key: string) =>
      key === "agent-spawner:last-spawn-at" ? ninetySecondsAgo : null,
    );

    expect(behavior.shouldAct(dummyEvent, state)).toBe(true);
  });

  it("should act when no previous spawn exists", () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();

    // No cooldown meta set
    state.getMeta.mockReturnValue(null);

    expect(behavior.shouldAct(dummyEvent, state)).toBe(true);
  });

  // ========================================================================
  // act() tests — capacity checks
  // ========================================================================

  it("should not spawn when at max agent capacity", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    // 5 active agents (default max is 5)
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-2", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-3", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-4", lastStatus: "connected", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-5", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    await behavior.act(dummyEvent, state, comm);

    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  it("should not spawn when idle agents exist", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    // 2 agents: 1 working, 1 idle — idle agent exists, work-assigner handles it
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-2", lastStatus: "idle", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    await behavior.act(dummyEvent, state, comm);

    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  it("should not spawn when no ready beads", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    // 1 working agent, no idle — but no ready beads
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await behavior.act(dummyEvent, state, comm);

    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  // ========================================================================
  // act() tests — successful spawn
  // ========================================================================

  it("should spawn agent when ready beads exist and no idle agents", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    // All agents are working, none idle
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: true,
      sessionId: "session-123",
      tmuxSession: "adj-swarm-worker-123",
    });

    await behavior.act(dummyEvent, state, comm);

    expect(mockSpawnAgent).toHaveBeenCalledOnce();
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: PROJECT_PATH,
        mode: "swarm",
      }),
    );
  });

  it("should log spawn in state store", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: true,
      sessionId: "session-123",
      tmuxSession: "adj-swarm-worker-123",
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.logSpawn).toHaveBeenCalledWith(
      expect.stringContaining("worker-"),
      expect.stringContaining("Ready beads available"),
      "adj-001",
    );
  });

  it("should update cooldown meta after spawn", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: true,
      sessionId: "session-123",
      tmuxSession: "adj-swarm-worker-123",
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.setMeta).toHaveBeenCalledWith(
      "agent-spawner:last-spawn-at",
      expect.any(String),
    );
  });

  it("should queue routine message after spawn", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: true,
      sessionId: "session-123",
      tmuxSession: "adj-swarm-worker-123",
    });

    await behavior.act(dummyEvent, state, comm);

    expect(comm.queueRoutine).toHaveBeenCalledWith(
      expect.stringContaining("Spawned agent"),
    );
  });

  it("should send important message on spawn failure", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: false,
      error: "tmux session creation failed",
    });

    await behavior.act(dummyEvent, state, comm);

    expect(comm.sendImportant).toHaveBeenCalledWith(
      expect.stringContaining("Failed to spawn agent"),
    );
    // Should NOT log spawn in state on failure
    expect(state.logSpawn).not.toHaveBeenCalled();
  });

  it("should prevent concurrent spawns via lock", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    // Make execBd slow to simulate concurrent calls
    let resolveExecBd!: (value: unknown) => void;
    const slowExecBd = new Promise((res) => { resolveExecBd = res; });
    mockExecBd.mockImplementationOnce(() => slowExecBd as ReturnType<typeof execBd>);

    mockSpawnAgent.mockResolvedValue({
      success: true,
      sessionId: "session-123",
      tmuxSession: "adj-swarm-worker-123",
    });

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

    await Promise.all([act1, act2]);

    // Only one spawn should happen (the other was blocked by lock)
    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
  });

  // ========================================================================
  // act() tests — configurable max_concurrent_agents
  // ========================================================================

  it("should use configurable max_concurrent_agents from metadata", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    // 3 active agents, max set to 3
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-2", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-3", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockImplementation((key: string) =>
      key === "max_concurrent_agents" ? "3" : null,
    );

    await behavior.act(dummyEvent, state, comm);

    // At capacity (3/3), should not spawn
    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  it("should default max_concurrent_agents to 5", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    // 4 active agents, no max set (defaults to 5) — still room for 1 more
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-2", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-3", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-4", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null); // no max set

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: true,
      sessionId: "session-123",
      tmuxSession: "adj-swarm-worker-123",
    });

    await behavior.act(dummyEvent, state, comm);

    // Under default cap of 5, should spawn
    expect(mockSpawnAgent).toHaveBeenCalledOnce();
  });

  it("should log decision after successful spawn", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: true,
      sessionId: "session-123",
      tmuxSession: "adj-swarm-worker-123",
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "agent-spawner",
        action: "spawn",
      }),
    );
  });

  it("should log decision on spawn failure", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: false,
      error: "tmux not available",
    });

    await behavior.act(dummyEvent, state, comm);

    expect(state.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "agent-spawner",
        action: "spawn",
        reason: expect.stringContaining("tmux not available"),
      }),
    );
  });

  it("should not count disconnected agents as active", async () => {
    const behavior = createAgentSpawnerBehavior(PROJECT_PATH);
    const state = createMockState();
    const comm = createMockComm();

    // 5 agents but 3 disconnected — only 2 truly active
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-1", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-2", lastStatus: "working", connectedAt: "2026-01-01T11:00:00Z", disconnectedAt: null }),
      makeProfile({ agentId: "agent-3", lastStatus: "working", connectedAt: "2026-01-01T10:00:00Z", disconnectedAt: "2026-01-01T11:00:00Z" }),
      makeProfile({ agentId: "agent-4", lastStatus: "idle", connectedAt: "2026-01-01T10:00:00Z", disconnectedAt: "2026-01-01T11:00:00Z" }),
      makeProfile({ agentId: "agent-5", lastStatus: "connected", connectedAt: "2026-01-01T10:00:00Z", disconnectedAt: "2026-01-01T11:00:00Z" }),
    ]);

    state.getMeta.mockReturnValue(null);

    mockExecBd.mockResolvedValue({
      success: true,
      data: [
        { id: "adj-001", title: "Ready task", priority: 1, type: "task" },
      ],
      exitCode: 0,
    });

    mockSpawnAgent.mockResolvedValue({
      success: true,
      sessionId: "session-123",
      tmuxSession: "adj-swarm-worker-123",
    });

    await behavior.act(dummyEvent, state, comm);

    // Only 2 active, under default cap of 5, no idle connected agents, should spawn
    expect(mockSpawnAgent).toHaveBeenCalledOnce();
  });
});
