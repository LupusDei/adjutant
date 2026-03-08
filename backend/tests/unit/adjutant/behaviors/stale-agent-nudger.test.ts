import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createStaleAgentNudger } from "../../../../src/services/adjutant/behaviors/stale-agent-nudger.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { AgentProfile } from "../../../../src/services/adjutant/state-store.js";

function createMockState() {
  return {
    getAllAgentProfiles: vi.fn((): AgentProfile[] => []),
    logDecision: vi.fn(),
    upsertAgentProfile: vi.fn(),
    getAgentProfile: vi.fn(),
    getRecentDecisions: vi.fn(),
    getMeta: vi.fn(),
    setMeta: vi.fn(),
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
  };
}

const dummyEvent: BehaviorEvent = {
  name: "agent:status_changed",
  data: {},
  seq: 1,
};

describe("createStaleAgentNudger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has name 'stale-agent-nudger'", () => {
    const behavior = createStaleAgentNudger();
    expect(behavior.name).toBe("stale-agent-nudger");
  });

  it("has schedule '*/15 * * * *'", () => {
    const behavior = createStaleAgentNudger();
    expect(behavior.schedule).toBe("*/15 * * * *");
  });

  it("triggers on 'agent:status_changed'", () => {
    const behavior = createStaleAgentNudger();
    expect(behavior.triggers).toContain("agent:status_changed");
  });

  it("shouldAct always returns true", () => {
    const behavior = createStaleAgentNudger();
    expect(behavior.shouldAct(dummyEvent, {})).toBe(true);
  });

  it("does NOT nudge agents with 'disconnected' status", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-a", lastStatus: "disconnected", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("does NOT nudge agents with 'unknown' status", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-a", lastStatus: "unknown", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("does NOT nudge agents with 'idle' status", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-a", lastStatus: "idle", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("does NOT nudge agents with 'done' status", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-a", lastStatus: "done", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("nudges agents with 'working' status and lastStatusAt > 1 hour ago", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "stale-worker", lastStatus: "working", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).toHaveBeenCalledOnce();
    expect(comm.messageAgent).toHaveBeenCalledWith(
      "stale-worker",
      expect.stringContaining("Status check"),
    );
  });

  it("nudges agents with 'blocked' status and lastStatusAt > 1 hour ago", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "blocked-agent", lastStatus: "blocked", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).toHaveBeenCalledOnce();
    expect(comm.messageAgent).toHaveBeenCalledWith(
      "blocked-agent",
      expect.stringContaining("Status check"),
    );
  });

  it("does NOT nudge fresh agents (lastStatusAt < 1 hour ago)", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "fresh-agent", lastStatus: "working", lastStatusAt: "2026-01-01T11:30:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("sends nudge message via comm.messageAgent", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "stale-agent", lastStatus: "working", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).toHaveBeenCalledWith(
      "stale-agent",
      "Status check: you haven't reported activity in over an hour. Please update your status or report a blocker.",
    );
  });

  it("logs decision for each nudge", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "stale-agent", lastStatus: "working", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(state.logDecision).toHaveBeenCalledOnce();
    expect(state.logDecision).toHaveBeenCalledWith({
      behavior: "stale-agent-nudger",
      action: "nudge_sent",
      target: "stale-agent",
      reason: "Last status update: 2026-01-01T10:00:00Z",
    });
  });

  it("queues routine summary when agents are nudged", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "agent-x", lastStatus: "working", lastStatusAt: "2026-01-01T10:00:00Z" }),
      makeProfile({ agentId: "agent-y", lastStatus: "blocked", lastStatusAt: "2026-01-01T10:30:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.queueRoutine).toHaveBeenCalledOnce();
    expect(comm.queueRoutine).toHaveBeenCalledWith(
      "Nudged 2 stale agent(s): agent-x, agent-y",
    );
  });

  it("does NOT queue routine when no agents are nudged", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "fresh-agent", lastStatus: "working", lastStatusAt: "2026-01-01T11:30:00Z" }),
    ]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.queueRoutine).not.toHaveBeenCalled();
  });

  it("debounce: does NOT nudge same agent twice within 1 hour", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "stale-agent", lastStatus: "working", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    // First nudge
    await behavior.act(dummyEvent, state, comm);
    expect(comm.messageAgent).toHaveBeenCalledOnce();

    // Advance 30 minutes (still within debounce window)
    vi.setSystemTime(new Date("2026-01-01T12:30:00Z"));
    comm.messageAgent.mockClear();

    // Second nudge attempt — should be suppressed
    await behavior.act(dummyEvent, state, comm);
    expect(comm.messageAgent).not.toHaveBeenCalled();
  });

  it("debounce: DOES nudge same agent after 1 hour has passed", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "stale-agent", lastStatus: "working", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    // First nudge
    await behavior.act(dummyEvent, state, comm);
    expect(comm.messageAgent).toHaveBeenCalledOnce();

    // Advance past debounce window (1 hour + 1 minute)
    vi.setSystemTime(new Date("2026-01-01T13:01:00Z"));
    comm.messageAgent.mockClear();

    // Second nudge — should fire
    await behavior.act(dummyEvent, state, comm);
    expect(comm.messageAgent).toHaveBeenCalledOnce();
  });

  it("handles empty profiles list (no agents)", async () => {
    const behavior = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([]);

    await behavior.act(dummyEvent, state, comm);

    expect(comm.messageAgent).not.toHaveBeenCalled();
    expect(comm.queueRoutine).not.toHaveBeenCalled();
    expect(state.logDecision).not.toHaveBeenCalled();
  });

  it("each instance has independent debounce state", async () => {
    const behavior1 = createStaleAgentNudger();
    const behavior2 = createStaleAgentNudger();
    const state = createMockState();
    const comm = createMockComm();
    state.getAllAgentProfiles.mockReturnValue([
      makeProfile({ agentId: "stale-agent", lastStatus: "working", lastStatusAt: "2026-01-01T10:00:00Z" }),
    ]);

    // First instance nudges
    await behavior1.act(dummyEvent, state, comm);
    expect(comm.messageAgent).toHaveBeenCalledOnce();
    comm.messageAgent.mockClear();

    // Second instance also nudges (independent debounce)
    await behavior2.act(dummyEvent, state, comm);
    expect(comm.messageAgent).toHaveBeenCalledOnce();
  });
});
