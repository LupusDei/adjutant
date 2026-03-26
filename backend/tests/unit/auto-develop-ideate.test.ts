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
vi.mock("../../src/services/projects-service.js", () => ({
  getAutoDevelopProjects: vi.fn(),
  pauseAutoDevelop: vi.fn(),
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
  buildResearchReason,
  buildPhaseReason,
  researchFindingsKey,
} from "../../src/services/adjutant/behaviors/auto-develop-loop.js";
import type { AdjutantState } from "../../src/services/adjutant/state-store.js";
import type { ProposalStore } from "../../src/services/proposal-store.js";
import type { AutoDevelopStore } from "../../src/services/auto-develop-store.js";
import type { ResearchFindings } from "../../src/types/auto-develop.js";

// =============================================================================
// Helpers
// =============================================================================

function createMockState(meta: Record<string, string | null> = {}): AdjutantState {
  const metaStore = new Map<string, string>(
    Object.entries(meta).filter((e): e is [string, string] => e[1] !== null),
  );
  return {
    getMeta: vi.fn((key: string) => metaStore.get(key) ?? null),
    setMeta: vi.fn((key: string, value: string) => metaStore.set(key, value)),
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

describe("buildResearchReason", () => {
  it("should include WebSearch instructions in the research prompt", () => {
    const state = createMockState();
    const reason = buildResearchReason("proj-1", "TestProject", state);

    expect(reason).toContain("WebSearch");
    expect(reason).toContain("research the project domain");
    expect(reason).toContain("competitors");
    expect(reason).toContain("best practices");
  });

  it("should include codebase analysis instructions in the research prompt", () => {
    const state = createMockState();
    const reason = buildResearchReason("proj-1", "TestProject", state);

    expect(reason).toContain("Analyze the codebase for gaps");
    expect(reason).toContain("README vision");
    expect(reason).toContain("test coverage gaps");
    expect(reason).toContain("refactoring opportunities");
    expect(reason).toContain("UX improvements");
  });

  it("should include previously tried angles from escalation state", () => {
    const escState = {
      count: 1,
      lastAt: "2026-01-01T00:00:00Z",
      anglesTried: ["competitor features and industry best practices"],
    };
    const state = createMockState({
      "auto_develop:escalation_state:proj-1": JSON.stringify(escState),
    });
    const reason = buildResearchReason("proj-1", "TestProject", state);

    expect(reason).toContain("Previous research angles already tried");
    expect(reason).toContain("competitor features and industry best practices");
    expect(reason).toContain("DIFFERENT research angle");
  });

  it("should include project name and ID in the prompt", () => {
    const state = createMockState();
    const reason = buildResearchReason("proj-1", "TestProject", state);

    expect(reason).toContain("TestProject");
    expect(reason).toContain("proj-1");
    expect(reason).toContain("IDEATE:RESEARCH");
  });
});

describe("buildIdeateReason with research findings", () => {
  it("should include research findings when available in state meta", () => {
    const findings: ResearchFindings = {
      sources: [
        { url: "https://example.com", title: "Example", relevance: "High" },
      ],
      codebaseGaps: ["Missing auth middleware"],
      refactoringOpportunities: ["Extract shared utility"],
      featureIdeas: ["Add dark mode"],
      summary: "Research found several areas for improvement.",
    };

    const state = createMockState({
      [`auto_develop:research_findings:proj-1`]: JSON.stringify(findings),
    });
    const proposalStore = createMockProposalStore();
    const autoDevelopStore = createMockAutoDevelopStore();

    const reason = buildPhaseReason(
      "proj-1", "TestProject", "ideate",
      proposalStore, autoDevelopStore, state,
    );

    expect(reason).toContain("RESEARCH FINDINGS");
    expect(reason).toContain("Research found several areas for improvement.");
    expect(reason).toContain("Missing auth middleware");
    expect(reason).toContain("Extract shared utility");
    expect(reason).toContain("Add dark mode");
    expect(reason).toContain("https://example.com");
    expect(reason).toContain("Example");
  });

  it("should work without research findings (backward compatibility)", () => {
    const state = createMockState();
    const proposalStore = createMockProposalStore();
    const autoDevelopStore = createMockAutoDevelopStore();

    const reason = buildPhaseReason(
      "proj-1", "TestProject", "ideate",
      proposalStore, autoDevelopStore, state,
    );

    expect(reason).toContain("IDEATE");
    expect(reason).toContain("generate new proposals");
    expect(reason).not.toContain("RESEARCH FINDINGS");
  });

  it("should gracefully handle invalid JSON in research findings", () => {
    const state = createMockState({
      [`auto_develop:research_findings:proj-1`]: "not valid json{{{",
    });
    const proposalStore = createMockProposalStore();
    const autoDevelopStore = createMockAutoDevelopStore();

    // Should not throw
    const reason = buildPhaseReason(
      "proj-1", "TestProject", "ideate",
      proposalStore, autoDevelopStore, state,
    );

    expect(reason).toContain("IDEATE");
    expect(reason).not.toContain("RESEARCH FINDINGS");
  });

  it("should include source citations in the findings section", () => {
    const findings: ResearchFindings = {
      sources: [
        { url: "https://a.com/1", title: "Source A", relevance: "Direct match" },
        { url: "https://b.com/2", title: "Source B", relevance: "Tangential" },
      ],
      codebaseGaps: [],
      refactoringOpportunities: [],
      featureIdeas: [],
      summary: "Two sources found.",
    };

    const state = createMockState({
      [`auto_develop:research_findings:proj-1`]: JSON.stringify(findings),
    });
    const proposalStore = createMockProposalStore();
    const autoDevelopStore = createMockAutoDevelopStore();

    const reason = buildPhaseReason(
      "proj-1", "TestProject", "ideate",
      proposalStore, autoDevelopStore, state,
    );

    expect(reason).toContain("[Source A](https://a.com/1)");
    expect(reason).toContain("Direct match");
    expect(reason).toContain("[Source B](https://b.com/2)");
  });
});
