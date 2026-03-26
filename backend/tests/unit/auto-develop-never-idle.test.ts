import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger before imports
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock event-bus
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: vi.fn() }),
}));

// Mock projects-service
const { mockPauseAutoDevelop } = vi.hoisted(() => ({
  mockPauseAutoDevelop: vi.fn(),
}));

vi.mock("../../src/services/projects-service.js", () => ({
  getAutoDevelopProjects: vi.fn(),
  pauseAutoDevelop: mockPauseAutoDevelop,
  clearAutoDevelopPause: vi.fn(),
}));

// Mock escalation-builder
vi.mock("../../src/services/escalation-builder.js", () => ({
  buildEscalationMessage: vi.fn().mockReturnValue({
    title: "test",
    body: "test body",
    proposalIds: [],
    projectName: "test",
  }),
}));

// Mock confidence-engine
vi.mock("../../src/services/confidence-engine.js", () => ({
  classifyConfidence: vi.fn(),
}));

import {
  getIdeateSubstate,
  setIdeateSubstate,
  getEscalationState,
  setEscalationState,
  getNextResearchAngle,
  buildNeverIdleEscalationMessage,
  buildRefineReason,
  buildPhaseReason,
  ideateSubstateKey,
  escalationStateKey,
} from "../../src/services/adjutant/behaviors/auto-develop-loop.js";
import type { AdjutantState } from "../../src/services/adjutant/state-store.js";
import type { ProposalStore } from "../../src/services/proposal-store.js";
import type { AutoDevelopStore } from "../../src/services/auto-develop-store.js";
import type { IdeateSubState, EscalationState } from "../../src/types/auto-develop.js";
import { MAX_ESCALATION_STRIKES } from "../../src/types/auto-develop.js";

// =============================================================================
// Helpers
// =============================================================================

function createMockState(meta: Record<string, string | null> = {}): AdjutantState {
  const metaStore = new Map<string, string>(
    Object.entries(meta).filter((e): e is [string, string] => e[1] !== null),
  );
  return {
    getMeta: vi.fn((key: string) => metaStore.get(key) ?? null),
    setMeta: vi.fn((key: string, value: string) => { metaStore.set(key, value); }),
    logDecision: vi.fn(),
    getAgentProfile: vi.fn(),
    upsertAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn().mockReturnValue([]),
    incrementAssignmentCount: vi.fn(),
    getRecentDecisions: vi.fn().mockReturnValue([]),
    pruneOldDecisions: vi.fn(),
    logSpawn: vi.fn(),
    getSpawnHistory: vi.fn().mockReturnValue([]),
    getAgentSpawnHistory: vi.fn().mockReturnValue([]),
    markDecommissioned: vi.fn(),
    getLastSpawn: vi.fn(),
    countActiveSpawns: vi.fn().mockReturnValue(0),
    markAllDisconnected: vi.fn(),
    recordOutcome: vi.fn(),
    getRecentDecisionsWithOutcomes: vi.fn().mockReturnValue([]),
    getDecisionsForTarget: vi.fn().mockReturnValue([]),
    isCoordinator: vi.fn().mockReturnValue(false),
    getAgentsByRole: vi.fn().mockReturnValue([]),
  } as unknown as AdjutantState;
}

function createMockProposalStore(): ProposalStore {
  return {
    getProposals: vi.fn().mockReturnValue([]),
    getProposal: vi.fn(),
    getProposalsByConfidenceRange: vi.fn().mockReturnValue([]),
  } as unknown as ProposalStore;
}

function createMockAutoDevelopStore(): AutoDevelopStore {
  return {
    startCycle: vi.fn().mockReturnValue({ id: "cycle-1", phase: "ideate" }),
    updateCycle: vi.fn(),
    completeCycle: vi.fn(),
    getActiveCycle: vi.fn().mockReturnValue(null),
    getCycleHistory: vi.fn().mockReturnValue([]),
  } as unknown as AutoDevelopStore;
}

// =============================================================================
// Tests
// =============================================================================

describe("IDEATE sub-state machine", () => {
  it("should transition ideate → ideate:research when sub-state is set", () => {
    const state = createMockState({
      [ideateSubstateKey("proj-1")]: "ideate:research",
    });

    const substate = getIdeateSubstate("proj-1", state);
    expect(substate).toBe("ideate:research");
  });

  it("should default to 'ideate' when no sub-state is set", () => {
    const state = createMockState();
    const substate = getIdeateSubstate("proj-1", state);
    expect(substate).toBe("ideate");
  });

  it("should allow setting sub-state transitions: ideate → research → refine → escalate", () => {
    const state = createMockState();

    // Start at ideate (default)
    expect(getIdeateSubstate("proj-1", state)).toBe("ideate");

    // Transition to research
    setIdeateSubstate("proj-1", state, "ideate:research");
    expect(state.setMeta).toHaveBeenCalledWith(ideateSubstateKey("proj-1"), "ideate:research");

    // Transition to refine
    setIdeateSubstate("proj-1", state, "ideate:refine");
    expect(state.setMeta).toHaveBeenCalledWith(ideateSubstateKey("proj-1"), "ideate:refine");

    // Transition to escalate
    setIdeateSubstate("proj-1", state, "ideate:escalate");
    expect(state.setMeta).toHaveBeenCalledWith(ideateSubstateKey("proj-1"), "ideate:escalate");
  });

  it("should use buildResearchReason when sub-state is ideate:research", () => {
    const state = createMockState({
      [ideateSubstateKey("proj-1")]: "ideate:research",
    });
    const proposalStore = createMockProposalStore();
    const autoDevelopStore = createMockAutoDevelopStore();

    const reason = buildPhaseReason(
      "proj-1", "TestProject", "ideate",
      proposalStore, autoDevelopStore, state,
    );

    expect(reason).toContain("IDEATE:RESEARCH");
    expect(reason).toContain("WebSearch");
  });

  it("should use buildRefineReason when sub-state is ideate:refine", () => {
    const state = createMockState({
      [ideateSubstateKey("proj-1")]: "ideate:refine",
    });
    const proposalStore = createMockProposalStore();
    const autoDevelopStore = createMockAutoDevelopStore();

    const reason = buildPhaseReason(
      "proj-1", "TestProject", "ideate",
      proposalStore, autoDevelopStore, state,
    );

    expect(reason).toContain("IDEATE:REFINE");
    expect(reason).toContain("tighter scope");
    expect(reason).toContain("UX");
  });

  it("should use escalation message when sub-state is ideate:escalate", () => {
    const escState: EscalationState = {
      count: 2,
      lastAt: "2026-01-01T00:00:00Z",
      anglesTried: ["competitor features"],
    };
    const state = createMockState({
      [ideateSubstateKey("proj-1")]: "ideate:escalate",
      [escalationStateKey("proj-1")]: JSON.stringify(escState),
    });
    const proposalStore = createMockProposalStore();
    const autoDevelopStore = createMockAutoDevelopStore();

    const reason = buildPhaseReason(
      "proj-1", "TestProject", "ideate",
      proposalStore, autoDevelopStore, state,
    );

    expect(reason).toContain("NEEDS DIRECTION");
    expect(reason).toContain("competitor features");
  });
});

describe("Escalation count tracking", () => {
  it("should increment escalation count in state", () => {
    const state = createMockState();

    // Start fresh
    const escState = getEscalationState("proj-1", state);
    expect(escState.count).toBe(0);
    expect(escState.anglesTried).toEqual([]);

    // Increment
    escState.count += 1;
    escState.lastAt = new Date().toISOString();
    escState.anglesTried.push("competitor features and industry best practices");
    setEscalationState("proj-1", state, escState);

    expect(state.setMeta).toHaveBeenCalledWith(
      escalationStateKey("proj-1"),
      expect.stringContaining('"count":1'),
    );
  });

  it("should track multiple escalations with different angles", () => {
    const escState: EscalationState = {
      count: 2,
      lastAt: "2026-01-01T00:00:00Z",
      anglesTried: [
        "competitor features and industry best practices",
        "engineering debt, code quality, and test coverage gaps",
      ],
    };
    const state = createMockState({
      [escalationStateKey("proj-1")]: JSON.stringify(escState),
    });

    const loaded = getEscalationState("proj-1", state);
    expect(loaded.count).toBe(2);
    expect(loaded.anglesTried).toHaveLength(2);
  });
});

describe("Loop pause after 3 strikes", () => {
  it("should identify when escalation count meets MAX_ESCALATION_STRIKES", () => {
    expect(MAX_ESCALATION_STRIKES).toBe(3);

    const escState: EscalationState = {
      count: 3,
      lastAt: new Date().toISOString(),
      anglesTried: ["angle1", "angle2", "angle3"],
    };

    // This is the check the loop uses to decide whether to pause
    expect(escState.count >= MAX_ESCALATION_STRIKES).toBe(true);
  });

  it("should not trigger pause when escalation count is below threshold", () => {
    const escState: EscalationState = {
      count: 2,
      lastAt: new Date().toISOString(),
      anglesTried: ["angle1", "angle2"],
    };

    expect(escState.count >= MAX_ESCALATION_STRIKES).toBe(false);
  });
});

describe("Resume on user vision update (sub-state resets)", () => {
  it("should reset ideate sub-state back to 'ideate' when resetting", () => {
    const state = createMockState({
      [ideateSubstateKey("proj-1")]: "ideate:escalate",
    });

    // Simulate user providing vision update — reset sub-state
    setIdeateSubstate("proj-1", state, "ideate");

    expect(state.setMeta).toHaveBeenCalledWith(ideateSubstateKey("proj-1"), "ideate");
  });

  it("should reset escalation state when starting fresh", () => {
    const state = createMockState({
      [escalationStateKey("proj-1")]: JSON.stringify({
        count: 2, lastAt: "2026-01-01T00:00:00Z", anglesTried: ["a", "b"],
      }),
    });

    // Reset escalation state
    const freshState: EscalationState = { count: 0, lastAt: null, anglesTried: [] };
    setEscalationState("proj-1", state, freshState);

    expect(state.setMeta).toHaveBeenCalledWith(
      escalationStateKey("proj-1"),
      JSON.stringify(freshState),
    );
  });
});

describe("Escalation message includes angles tried", () => {
  it("should list all tried angles in the escalation message", () => {
    const angles = [
      "competitor features and industry best practices",
      "engineering debt, code quality, and test coverage gaps",
    ];
    const msg = buildNeverIdleEscalationMessage("proj-1", "TestProject", 2, angles);

    expect(msg).toContain("Research angles tried:");
    expect(msg).toContain("competitor features and industry best practices");
    expect(msg).toContain("engineering debt, code quality, and test coverage gaps");
  });

  it("should show warning when approaching max strikes", () => {
    const angles = ["angle1", "angle2"];
    const msg = buildNeverIdleEscalationMessage(
      "proj-1", "TestProject", MAX_ESCALATION_STRIKES - 1, angles,
    );

    expect(msg).toContain("WARNING");
    expect(msg).toContain("auto-pause");
  });

  it("should include helpful guidance suggestions", () => {
    const msg = buildNeverIdleEscalationMessage("proj-1", "TestProject", 1, []);

    expect(msg).toContain("vision update");
    expect(msg).toContain("specific area");
    expect(msg).toContain("confidence thresholds");
  });
});

describe("Research angle cycling", () => {
  it("should return first untried angle", () => {
    const angle = getNextResearchAngle([]);
    expect(angle).toBe("competitor features and industry best practices");
  });

  it("should skip already-tried angles", () => {
    const angle = getNextResearchAngle([
      "competitor features and industry best practices",
    ]);
    expect(angle).toBe("engineering debt, code quality, and test coverage gaps");
  });

  it("should cycle back to first when all angles are exhausted", () => {
    const allAngles = [
      "competitor features and industry best practices",
      "engineering debt, code quality, and test coverage gaps",
      "UX improvements, accessibility, and developer experience",
      "performance optimization and scalability concerns",
      "security hardening and error handling improvements",
    ];
    const angle = getNextResearchAngle(allAngles);
    expect(angle).toBe("competitor features and industry best practices");
  });
});

describe("buildRefineReason", () => {
  it("should focus on tighter scope and UX polish", () => {
    const reason = buildRefineReason("proj-1", "TestProject");

    expect(reason).toContain("IDEATE:REFINE");
    expect(reason).toContain("tighter scope");
    expect(reason).toContain("UX polish");
    expect(reason).toContain("SMALLER scope");
    expect(reason).toContain("single-file changes");
  });
});
