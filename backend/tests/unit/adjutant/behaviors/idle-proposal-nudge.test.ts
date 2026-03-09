import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AdjutantState } from "../../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../../src/services/adjutant/communication.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { StimulusEngine } from "../../../../src/services/adjutant/stimulus-engine.js";
import type { ProposalStore } from "../../../../src/services/proposal-store.js";
import type { Proposal } from "../../../../src/types/proposals.js";

import { createIdleProposalNudge } from "../../../../src/services/adjutant/behaviors/idle-proposal-nudge.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockStimulusEngine(): StimulusEngine {
  return {
    scheduleCheck: vi.fn().mockReturnValue("check-id-123"),
    cancelCheck: vi.fn(),
    onWake: vi.fn(),
    handleCriticalSignal: vi.fn(),
    registerWatch: vi.fn(),
    cancelWatch: vi.fn(),
    triggerWatch: vi.fn(),
    getPendingSchedule: vi.fn().mockReturnValue({ checks: [], watches: [] }),
    destroy: vi.fn(),
  } as unknown as StimulusEngine;
}

function createMockProposalStore(): ProposalStore {
  return {
    insertProposal: vi.fn(),
    getProposal: vi.fn(),
    getProposals: vi.fn().mockReturnValue([]),
    updateProposalStatus: vi.fn(),
  };
}

function createMockState(): AdjutantState {
  return {
    getAgentProfile: vi.fn().mockReturnValue(null),
    upsertAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn().mockReturnValue([]),
    incrementAssignmentCount: vi.fn(),
    logDecision: vi.fn(),
    getRecentDecisions: vi.fn().mockReturnValue([]),
    getMeta: vi.fn().mockReturnValue(null),
    setMeta: vi.fn(),
    pruneOldDecisions: vi.fn(),
    logSpawn: vi.fn(),
    getSpawnHistory: vi.fn().mockReturnValue([]),
    getAgentSpawnHistory: vi.fn().mockReturnValue([]),
    markDecommissioned: vi.fn(),
    getLastSpawn: vi.fn().mockReturnValue(null),
    countActiveSpawns: vi.fn().mockReturnValue(0),
    markAllDisconnected: vi.fn().mockReturnValue(0),
  } as unknown as AdjutantState;
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

function makeIdleEvent(agentId: string): BehaviorEvent {
  return {
    name: "agent:status_changed",
    data: { agent: agentId, status: "idle" },
    seq: 1,
  };
}

function makeWorkingEvent(agentId: string): BehaviorEvent {
  return {
    name: "agent:status_changed",
    data: { agent: agentId, status: "working", activity: "coding" },
    seq: 2,
  };
}

function makeDisconnectedEvent(agentId: string): BehaviorEvent {
  return {
    name: "mcp:agent_disconnected",
    data: { agentId, sessionId: "s1" },
    seq: 3,
  };
}

// ---------------------------------------------------------------------------
// Tests: Task adj-057.1.1 — Idle detection + scheduleCheck trigger
// ---------------------------------------------------------------------------

describe("createIdleProposalNudge", () => {
  let stimulusEngine: StimulusEngine;
  let proposalStore: ProposalStore;
  let state: AdjutantState;
  let comm: CommunicationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    stimulusEngine = createMockStimulusEngine();
    proposalStore = createMockProposalStore();
    state = createMockState();
    comm = createMockComm();
  });

  it("has name 'idle-proposal-nudge'", () => {
    const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
    expect(behavior.name).toBe("idle-proposal-nudge");
  });

  it("triggers on 'agent:status_changed'", () => {
    const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
    expect(behavior.triggers).toEqual(["agent:status_changed"]);
  });

  it("has no cron schedule", () => {
    const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
    expect(behavior.schedule).toBeUndefined();
  });

  describe("shouldAct", () => {
    it("returns true when agent status changes to idle", () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("agent-1");
      expect(behavior.shouldAct(event, state)).toBe(true);
    });

    it("returns false when agent status changes to working", () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeWorkingEvent("agent-1");
      expect(behavior.shouldAct(event, state)).toBe(false);
    });

    it("returns false when event is not agent:status_changed", () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event: BehaviorEvent = {
        name: "mcp:agent_connected",
        data: { agentId: "agent-1" },
        seq: 1,
      };
      expect(behavior.shouldAct(event, state)).toBe(false);
    });
  });

  describe("act — idle agent triggers scheduleCheck", () => {
    it("calls scheduleCheck with 300000ms delay when agent goes idle", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("agent-1");

      // Agent profile: connected (not disconnected)
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "agent-1",
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });

      await behavior.act(event, state, comm);

      expect(stimulusEngine.scheduleCheck).toHaveBeenCalledWith(
        300000,
        expect.stringContaining("agent-1"),
      );
    });

    it("includes agent ID in the scheduleCheck reason string", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("engineer-3");

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "engineer-3",
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });

      await behavior.act(event, state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).toContain("engineer-3");
    });

    it("logs a decision when scheduling a check", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("agent-1");

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "agent-1",
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });

      await behavior.act(event, state, comm);

      expect(state.logDecision).toHaveBeenCalledWith({
        behavior: "idle-proposal-nudge",
        action: "scheduled_idle_check",
        target: "agent-1",
        reason: expect.stringContaining("agent-1"),
      });
    });
  });

  describe("act — skips non-idle agents", () => {
    it("does not call scheduleCheck for working agents", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeWorkingEvent("agent-1");

      // shouldAct already returns false, but if act were called directly:
      await behavior.act(event, state, comm);

      expect(stimulusEngine.scheduleCheck).not.toHaveBeenCalled();
    });
  });

  describe("act — skips disconnected agents", () => {
    it("does not call scheduleCheck when agent is disconnected", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("agent-1");

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "agent-1",
        lastStatus: "idle",
        disconnectedAt: "2026-03-09T10:05:00Z",
        connectedAt: "2026-03-09T10:00:00Z",
      });

      await behavior.act(event, state, comm);

      expect(stimulusEngine.scheduleCheck).not.toHaveBeenCalled();
    });

    it("does not call scheduleCheck when agent profile not found", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("ghost-agent");

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await behavior.act(event, state, comm);

      expect(stimulusEngine.scheduleCheck).not.toHaveBeenCalled();
    });
  });

  describe("act — debounce prevents duplicate checks", () => {
    it("does not schedule a second check for the same agent within the idle period", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("agent-1");

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "agent-1",
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });

      // First call: debounce key not set
      (state.getMeta as ReturnType<typeof vi.fn>).mockReturnValue(null);
      await behavior.act(event, state, comm);
      expect(stimulusEngine.scheduleCheck).toHaveBeenCalledTimes(1);

      // setMeta should have been called to store the check ID
      expect(state.setMeta).toHaveBeenCalledWith(
        expect.stringContaining("agent-1"),
        expect.any(String),
      );

      // Second call: debounce key IS set (previous check ID stored)
      (state.getMeta as ReturnType<typeof vi.fn>).mockReturnValue("check-id-123");
      await behavior.act(event, state, comm);
      expect(stimulusEngine.scheduleCheck).toHaveBeenCalledTimes(1); // Still 1
    });

    it("allows a new check after agent transitions through non-idle state", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "agent-1",
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });

      // First idle event, no debounce
      (state.getMeta as ReturnType<typeof vi.fn>).mockReturnValue(null);
      await behavior.act(makeIdleEvent("agent-1"), state, comm);
      expect(stimulusEngine.scheduleCheck).toHaveBeenCalledTimes(1);

      // Agent goes working — behavior should clear debounce via act on working event
      const workingEvent = makeWorkingEvent("agent-1");
      await behavior.act(workingEvent, state, comm);

      // Agent goes idle again — debounce was cleared so new check is allowed
      // (getMeta returns null because setMeta was called to clear it during working transition)
      (state.getMeta as ReturnType<typeof vi.fn>).mockReturnValue(null);
      await behavior.act(makeIdleEvent("agent-1"), state, comm);
      expect(stimulusEngine.scheduleCheck).toHaveBeenCalledTimes(2);
    });
  });

  describe("act — never uses CommunicationManager", () => {
    it("does not call messageAgent, sendImportant, or escalate", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("agent-1");

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "agent-1",
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });

      await behavior.act(event, state, comm);

      expect(comm.messageAgent).not.toHaveBeenCalled();
      expect(comm.sendImportant).not.toHaveBeenCalled();
      expect(comm.escalate).not.toHaveBeenCalled();
    });
  });
});
