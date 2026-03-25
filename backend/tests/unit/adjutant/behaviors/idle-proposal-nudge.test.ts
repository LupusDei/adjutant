import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AdjutantState } from "../../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../../src/services/adjutant/communication.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { StimulusEngine } from "../../../../src/services/adjutant/stimulus-engine.js";
import type { ProposalStore } from "../../../../src/services/proposal-store.js";
import type { Proposal } from "../../../../src/types/proposals.js";

// Mock mcp-server for project context resolution
const { mockGetProjectContextByAgent } = vi.hoisted(() => {
  return {
    mockGetProjectContextByAgent: vi.fn().mockReturnValue(undefined),
  };
});

vi.mock("../../../../src/services/mcp-server.js", () => ({
  getProjectContextByAgent: mockGetProjectContextByAgent,
}));

import { createIdleProposalNudge } from "../../../../src/services/adjutant/behaviors/idle-proposal-nudge.js";
import { dispatchToBehavior } from "../../../helpers/behavior-dispatch.js";

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

    it("returns true when agent status changes to working (needed for debounce reset)", () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeWorkingEvent("agent-1");
      expect(behavior.shouldAct(event, state)).toBe(true);
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

  describe("dispatch — shouldAct filtering (adj-108)", () => {
    it("should not call act when event is not agent:status_changed", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const nonMatchingEvent: BehaviorEvent = {
        name: "mcp:agent_connected",
        data: { agentId: "agent-1", sessionId: "s1" },
        seq: 1,
      };

      const actCalled = await dispatchToBehavior(behavior, nonMatchingEvent, state, comm);

      expect(actCalled).toBe(false);
      expect(stimulusEngine.scheduleCheck).not.toHaveBeenCalled();
      expect(state.logDecision).not.toHaveBeenCalled();
      expect(state.setMeta).not.toHaveBeenCalled();
    });

    it("should call act when event is agent:status_changed", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeWorkingEvent("agent-1");

      const actCalled = await dispatchToBehavior(behavior, event, state, comm);

      expect(actCalled).toBe(true);
      // Working event clears debounce
      expect(state.setMeta).toHaveBeenCalled();
    });
  });

  describe("dispatch — cleanup on non-idle via dispatch (adj-108)", () => {
    it("should clear debounce when agent transitions to non-idle through full dispatch", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "agent-1",
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });

      // First: idle event sets debounce via scheduleCheck
      (state.getMeta as ReturnType<typeof vi.fn>).mockReturnValue(null);
      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);
      expect(stimulusEngine.scheduleCheck).toHaveBeenCalledTimes(1);

      // Then: working event through dispatch should clear debounce
      const actCalled = await dispatchToBehavior(behavior, makeWorkingEvent("agent-1"), state, comm);
      expect(actCalled).toBe(true);
      expect(state.setMeta).toHaveBeenCalledWith(
        expect.stringContaining("agent-1"),
        "",
      );
    });

    it("should not process disconnect events (filtered by shouldAct)", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const disconnectEvent = makeDisconnectedEvent("agent-1");

      const actCalled = await dispatchToBehavior(behavior, disconnectEvent, state, comm);

      // mcp:agent_disconnected is NOT agent:status_changed, so shouldAct returns false
      expect(actCalled).toBe(false);
      expect(stimulusEngine.scheduleCheck).not.toHaveBeenCalled();
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

      await dispatchToBehavior(behavior, event, state, comm);

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

      await dispatchToBehavior(behavior, event, state, comm);

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

      await dispatchToBehavior(behavior, event, state, comm);

      expect(state.logDecision).toHaveBeenCalledWith({
        behavior: "idle-proposal-nudge",
        action: "scheduled_idle_check",
        target: "agent-1",
        reason: expect.stringContaining("agent-1"),
      });
    });
  });

  describe("act — skips non-idle agents", () => {
    it("does not call scheduleCheck for working agents but clears debounce", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeWorkingEvent("agent-1");

      // shouldAct returns true for all agent:status_changed events
      expect(behavior.shouldAct(event, state)).toBe(true);
      await dispatchToBehavior(behavior, event, state, comm);

      expect(stimulusEngine.scheduleCheck).not.toHaveBeenCalled();
      // Debounce key should be cleared
      expect(state.setMeta).toHaveBeenCalledWith(
        expect.stringContaining("agent-1"),
        "",
      );
    });
  });

  describe("excludeRoles — coordinator exclusion", () => {
    it("has excludeRoles set to coordinator", () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      expect(behavior.excludeRoles).toEqual(["coordinator"]);
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

      await dispatchToBehavior(behavior, event, state, comm);

      expect(stimulusEngine.scheduleCheck).not.toHaveBeenCalled();
    });

    it("does not call scheduleCheck when agent profile not found", async () => {
      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      const event = makeIdleEvent("ghost-agent");

      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await dispatchToBehavior(behavior, event, state, comm);

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
      await dispatchToBehavior(behavior, event, state, comm);
      expect(stimulusEngine.scheduleCheck).toHaveBeenCalledTimes(1);

      // setMeta should have been called to store the check ID
      expect(state.setMeta).toHaveBeenCalledWith(
        expect.stringContaining("agent-1"),
        expect.any(String),
      );

      // Second call: debounce key IS set (previous check ID stored)
      (state.getMeta as ReturnType<typeof vi.fn>).mockReturnValue("check-id-123");
      await dispatchToBehavior(behavior, event, state, comm);
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
      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);
      expect(stimulusEngine.scheduleCheck).toHaveBeenCalledTimes(1);

      // Agent goes working — behavior should clear debounce via act on working event
      const workingEvent = makeWorkingEvent("agent-1");
      await dispatchToBehavior(behavior, workingEvent, state, comm);

      // Agent goes idle again — debounce was cleared so new check is allowed
      // (getMeta returns null because setMeta was called to clear it during working transition)
      (state.getMeta as ReturnType<typeof vi.fn>).mockReturnValue(null);
      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);
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

      await dispatchToBehavior(behavior, event, state, comm);

      expect(comm.messageAgent).not.toHaveBeenCalled();
      expect(comm.sendImportant).not.toHaveBeenCalled();
      expect(comm.escalate).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: Task adj-057.1.3 — Proposal context in scheduleCheck reason
  // ---------------------------------------------------------------------------

  describe("act — proposal context in reason string", () => {
    function makeProposal(overrides: Partial<Proposal>): Proposal {
      return {
        id: "p-1",
        author: "adjutant-core",
        title: "Improve CI pipeline",
        description: "Some description",
        type: "engineering",
        status: "pending",
        project: "adjutant",
        createdAt: "2026-03-09T10:00:00Z",
        updatedAt: "2026-03-09T10:00:00Z",
        ...overrides,
      };
    }

    function setupConnectedAgent(agentId: string): void {
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId,
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });
    }

    it("includes pending proposal titles and IDs in the reason", async () => {
      const pendingProposals = [
        makeProposal({ id: "p-1", title: "Improve CI pipeline", status: "pending" }),
        makeProposal({ id: "p-2", title: "Add caching layer", status: "pending" }),
        makeProposal({ id: "p-3", title: "Refactor auth module", status: "pending" }),
      ];

      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockImplementation(
        (opts?: { status?: string }) => {
          if (opts?.status === "pending") return pendingProposals;
          if (opts?.status === "dismissed") return [];
          return [];
        },
      );

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).toContain("p-1");
      expect(reason).toContain("Improve CI pipeline");
      expect(reason).toContain("p-2");
      expect(reason).toContain("Add caching layer");
      expect(reason).toContain("p-3");
      expect(reason).toContain("Refactor auth module");
    });

    it("indicates no pending proposals when none exist", async () => {
      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason.toLowerCase()).toContain("no pending proposals");
    });

    it("reason string instructs coordinator to send_message to the idle agent", async () => {
      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("engineer-5");

      await dispatchToBehavior(behavior, makeIdleEvent("engineer-5"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).toContain("send_message");
      expect(reason).toContain("engineer-5");
    });

    it("queries proposalStore for pending proposals only", async () => {
      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      expect(proposalStore.getProposals).toHaveBeenCalledWith({ status: "pending" });
      expect(proposalStore.getProposals).not.toHaveBeenCalledWith(expect.objectContaining({ status: "dismissed" }));
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: Task adj-057.1.5 — 12-proposal pending cap in reason string
  // ---------------------------------------------------------------------------

  describe("act — pending proposal cap (12)", () => {
    function makeProposal(overrides: Partial<Proposal>): Proposal {
      return {
        id: "p-1",
        author: "adjutant-core",
        title: "Proposal",
        description: "desc",
        type: "engineering",
        status: "pending",
        project: "adjutant",
        createdAt: "2026-03-09T10:00:00Z",
        updatedAt: "2026-03-09T10:00:00Z",
        ...overrides,
      };
    }

    function setupConnectedAgent(agentId: string): void {
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId,
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });
    }

    function makePendingProposals(count: number): Proposal[] {
      return Array.from({ length: count }, (_, i) =>
        makeProposal({ id: `p-${i + 1}`, title: `Proposal ${i + 1}`, status: "pending" }),
      );
    }

    it("includes PENDING CAP when 12 pending proposals exist", async () => {
      const pending = makePendingProposals(12);
      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockImplementation(
        (opts?: { status?: string }) => {
          if (opts?.status === "pending") return pending;
          if (opts?.status === "dismissed") return [];
          return [];
        },
      );

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).toContain("PENDING CAP");
      expect(reason).toContain("12/12");
      expect(reason.toLowerCase()).toContain("must improve existing");
      expect(reason.toLowerCase()).toContain("not create new");
    });

    it("includes PENDING CAP when more than 12 pending proposals exist", async () => {
      const pending = makePendingProposals(15);
      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockImplementation(
        (opts?: { status?: string }) => {
          if (opts?.status === "pending") return pending;
          if (opts?.status === "dismissed") return [];
          return [];
        },
      );

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).toContain("PENDING CAP");
      expect(reason).toContain("15/12");
    });

    it("does NOT include PENDING CAP when fewer than 12 pending proposals exist", async () => {
      const pending = makePendingProposals(11);
      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockImplementation(
        (opts?: { status?: string }) => {
          if (opts?.status === "pending") return pending;
          if (opts?.status === "dismissed") return [];
          return [];
        },
      );

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).not.toContain("PENDING CAP");
    });

    it("allows new creation when under the cap", async () => {
      const pending = makePendingProposals(5);
      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockImplementation(
        (opts?: { status?: string }) => {
          if (opts?.status === "pending") return pending;
          if (opts?.status === "dismissed") return [];
          return [];
        },
      );

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).not.toContain("PENDING CAP");
      // The reason should still list the proposals
      expect(reason).toContain("Pending proposals (5)");
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: adj-119 — Project-aware proposal filtering
  // ---------------------------------------------------------------------------

  describe("act — project-aware proposal filtering (adj-119)", () => {
    const ADJUTANT_PROJECT_CONTEXT = {
      projectId: "f1e8f895",
      projectName: "adjutant",
      projectPath: "/path/to/adjutant",
      beadsDir: "/path/to/adjutant/.beads",
    };

    function makeProposal(overrides: Partial<Proposal>): Proposal {
      return {
        id: "p-1",
        author: "adjutant-core",
        title: "Proposal",
        description: "desc",
        type: "engineering",
        status: "pending",
        project: "f1e8f895",
        createdAt: "2026-03-09T10:00:00Z",
        updatedAt: "2026-03-09T10:00:00Z",
        ...overrides,
      };
    }

    function setupConnectedAgent(agentId: string): void {
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId,
        lastStatus: "idle",
        disconnectedAt: null,
        connectedAt: "2026-03-09T10:00:00Z",
      });
    }

    it("filters proposals by agent's project context (projectId + projectName)", async () => {
      mockGetProjectContextByAgent.mockReturnValue(ADJUTANT_PROJECT_CONTEXT);

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      // Should pass project filter [projectId, projectName] to getProposals
      expect(proposalStore.getProposals).toHaveBeenCalledWith({
        status: "pending",
        project: ["f1e8f895", "adjutant"],
      });
    });

    it("falls back to unfiltered proposals when agent has no project context", async () => {
      mockGetProjectContextByAgent.mockReturnValue(undefined);

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      // Without project context, should query without project filter
      expect(proposalStore.getProposals).toHaveBeenCalledWith({
        status: "pending",
      });
    });

    it("only shows project-scoped proposals in reason string", async () => {
      mockGetProjectContextByAgent.mockReturnValue(ADJUTANT_PROJECT_CONTEXT);

      const adjutantProposal = makeProposal({
        id: "adj-p1",
        title: "Adjutant improvement",
        project: "f1e8f895",
      });

      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockImplementation(
        (opts?: { status?: string; project?: string | string[] }) => {
          // The store is expected to filter by project — mock returns only matching proposals
          if (opts?.status === "pending" && opts?.project) return [adjutantProposal];
          if (opts?.status === "dismissed" && opts?.project) return [];
          return [];
        },
      );

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).toContain("adj-p1");
      expect(reason).toContain("Adjutant improvement");
    });

    it("pending cap applies per-project, not globally", async () => {
      mockGetProjectContextByAgent.mockReturnValue(ADJUTANT_PROJECT_CONTEXT);

      // Return 12 proposals scoped to this project
      const projectProposals = Array.from({ length: 12 }, (_, i) =>
        makeProposal({ id: `p-${i + 1}`, title: `Proposal ${i + 1}` }),
      );

      (proposalStore.getProposals as ReturnType<typeof vi.fn>).mockImplementation(
        (opts?: { status?: string; project?: string | string[] }) => {
          if (opts?.status === "pending") return projectProposals;
          if (opts?.status === "dismissed") return [];
          return [];
        },
      );

      const behavior = createIdleProposalNudge(stimulusEngine, proposalStore);
      setupConnectedAgent("agent-1");

      await dispatchToBehavior(behavior, makeIdleEvent("agent-1"), state, comm);

      const reason = (stimulusEngine.scheduleCheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(reason).toContain("PENDING CAP");
      expect(reason).toContain("12/12");
    });
  });
});
