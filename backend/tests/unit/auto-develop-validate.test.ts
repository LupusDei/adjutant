/**
 * Tests for VALIDATE phase behavior in auto-develop loop.
 *
 * Covers:
 * - buildValidateReason content (acceptance criteria, integration gaps, end-to-end)
 * - QA_SENTINEL_PROMPT_TEMPLATE structure
 * - advance_auto_develop_phase P0/P1 bug gating
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock bd-client before importing modules that use it
const { mockExecBd } = vi.hoisted(() => ({
  mockExecBd: vi.fn().mockResolvedValue({ success: true, data: [], exitCode: 0 }),
}));

vi.mock("../../src/services/bd-client.js", () => ({
  execBd: mockExecBd,
  resolveBeadsDir: () => "/tmp/beads",
}));

// Mock projects-service
vi.mock("../../src/services/projects-service.js", () => ({
  getAutoDevelopProjects: vi.fn().mockReturnValue({ success: true, data: [] }),
  getProject: vi.fn().mockReturnValue({ success: false }),
  pauseAutoDevelop: vi.fn(),
  clearAutoDevelopPause: vi.fn(),
  enableAutoDevelop: vi.fn().mockReturnValue({ success: true }),
  disableAutoDevelop: vi.fn().mockReturnValue({ success: true }),
  setVisionContext: vi.fn().mockReturnValue({ success: true }),
}));

// Mock event-bus
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: vi.fn() }),
}));

// Mock confidence-engine
vi.mock("../../src/services/confidence-engine.js", () => ({
  classifyConfidence: (score: number) => {
    if (score >= 80) return "accept";
    if (score >= 60) return "refine";
    if (score >= 40) return "escalate";
    return "dismiss";
  },
  computeConfidenceScore: () => 80,
}));

// Mock utils
vi.mock("../../src/utils/index.js", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

// Mock escalation-builder
vi.mock("../../src/services/escalation-builder.js", () => ({
  buildEscalationMessage: () => ({ body: "escalation" }),
}));

// Mock auto-develop-status
vi.mock("../../src/services/auto-develop-status.js", () => ({
  buildAutoDevelopStatus: vi.fn().mockReturnValue({}),
}));

// Mock mcp-server
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: vi.fn().mockReturnValue("test-agent"),
  resolveToolProjectContext: vi.fn().mockReturnValue({
    projectId: "proj-123",
    projectName: "test-project",
    projectPath: "/tmp/test",
  }),
}));

import {
  buildPhaseReason,
  QA_SENTINEL_PROMPT_TEMPLATE,
} from "../../src/services/adjutant/behaviors/auto-develop-loop.js";
import { checkOpenCriticalBugs } from "../../src/services/mcp-tools/auto-develop.js";
import type { ProposalStore } from "../../src/services/proposal-store.js";
import type { AutoDevelopStore, AutoDevelopCycle } from "../../src/services/auto-develop-store.js";
import type { AdjutantState } from "../../src/services/adjutant/state-store.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockProposalStore(): ProposalStore {
  return {
    getProposals: vi.fn().mockReturnValue([]),
    getProposal: vi.fn().mockReturnValue(null),
    getProposalsByConfidenceRange: vi.fn().mockReturnValue([]),
    setConfidenceScore: vi.fn(),
    createProposal: vi.fn(),
    updateProposal: vi.fn(),
  } as unknown as ProposalStore;
}

function createMockAutoDevelopStore(): AutoDevelopStore {
  const mockCycle: AutoDevelopCycle = {
    id: "cycle-1",
    projectId: "proj-123",
    phase: "validate",
    startedAt: new Date().toISOString(),
    completedAt: null,
    proposalsGenerated: 1,
    proposalsAccepted: 1,
    proposalsEscalated: 0,
    proposalsDismissed: 0,
  };
  return {
    getActiveCycle: vi.fn().mockReturnValue(mockCycle),
    startCycle: vi.fn().mockReturnValue(mockCycle),
    updateCycle: vi.fn(),
    completeCycle: vi.fn(),
    getCycleHistory: vi.fn().mockReturnValue([]),
  } as unknown as AutoDevelopStore;
}

function createMockState(): AdjutantState {
  const meta: Record<string, string> = {};
  return {
    getMeta: vi.fn((key: string) => meta[key] ?? null),
    setMeta: vi.fn((key: string, value: string) => { meta[key] = value; }),
    logDecision: vi.fn(),
    countActiveSpawns: vi.fn().mockReturnValue(0),
  } as unknown as AdjutantState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VALIDATE phase behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
  });

  // =========================================================================
  // adj-152.2.1 — buildValidateReason
  // =========================================================================

  describe("buildValidateReason", () => {
    it("should include instructions about acceptance criteria lookup", () => {
      const proposalStore = createMockProposalStore();
      const autoDevelopStore = createMockAutoDevelopStore();
      const state = createMockState();

      const reason = buildPhaseReason(
        "proj-123",
        "test-project",
        "validate",
        proposalStore,
        autoDevelopStore,
        state,
      );

      expect(reason).toContain("ACCEPTANCE CRITERIA");
      expect(reason).toContain("spec.md");
      expect(reason).toContain("proposal description");
    });

    it("should include instructions about integration gap checks", () => {
      const proposalStore = createMockProposalStore();
      const autoDevelopStore = createMockAutoDevelopStore();
      const state = createMockState();

      const reason = buildPhaseReason(
        "proj-123",
        "test-project",
        "validate",
        proposalStore,
        autoDevelopStore,
        state,
      );

      expect(reason).toContain("integration gap");
      // Check for specific integration gap examples
      expect(reason).toContain("wired together");
    });

    it("should include end-to-end verification instructions", () => {
      const proposalStore = createMockProposalStore();
      const autoDevelopStore = createMockAutoDevelopStore();
      const state = createMockState();

      const reason = buildPhaseReason(
        "proj-123",
        "test-project",
        "validate",
        proposalStore,
        autoDevelopStore,
        state,
      );

      expect(reason).toContain("END-TO-END");
      expect(reason).toContain("user would experience");
    });

    it("should reference QA_SENTINEL_PROMPT_TEMPLATE for spawning", () => {
      const proposalStore = createMockProposalStore();
      const autoDevelopStore = createMockAutoDevelopStore();
      const state = createMockState();

      const reason = buildPhaseReason(
        "proj-123",
        "test-project",
        "validate",
        proposalStore,
        autoDevelopStore,
        state,
      );

      expect(reason).toContain("QA_SENTINEL_PROMPT_TEMPLATE");
      expect(reason).toContain("{{acceptance_criteria}}");
      expect(reason).toContain("{{epic_id}}");
    });

    it("should mention P0/P1 bug gating for advancement", () => {
      const proposalStore = createMockProposalStore();
      const autoDevelopStore = createMockAutoDevelopStore();
      const state = createMockState();

      const reason = buildPhaseReason(
        "proj-123",
        "test-project",
        "validate",
        proposalStore,
        autoDevelopStore,
        state,
      );

      expect(reason).toContain("P0/P1");
      expect(reason).toContain("BLOCK");
    });
  });

  // =========================================================================
  // adj-152.2.2 — QA_SENTINEL_PROMPT_TEMPLATE
  // =========================================================================

  describe("QA_SENTINEL_PROMPT_TEMPLATE", () => {
    it("should contain acceptance criteria placeholder", () => {
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("{{acceptance_criteria}}");
    });

    it("should contain epic ID placeholder", () => {
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("{{epic_id}}");
    });

    it("should include instructions for running the app", () => {
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("Run the app");
    });

    it("should include instructions for creating bug beads", () => {
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("bd create");
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("--type=bug");
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("--priority=1");
    });

    it("should include instructions for reporting findings via send_message", () => {
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("send_message");
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("VALIDATION PASSED");
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("VALIDATION FAILED");
    });

    it("should include integration gap check instructions", () => {
      expect(QA_SENTINEL_PROMPT_TEMPLATE).toContain("integration gap");
    });
  });

  // =========================================================================
  // adj-152.2.3 — checkOpenCriticalBugs
  // =========================================================================

  describe("checkOpenCriticalBugs", () => {
    it("should return empty array when no bugs exist", async () => {
      mockExecBd.mockResolvedValue({ success: true, data: [], exitCode: 0 });
      const result = await checkOpenCriticalBugs("proj-123");
      expect(result).toEqual([]);
    });

    it("should return P0 and P1 bugs only", async () => {
      // Real bd list --json output shape
      mockExecBd.mockResolvedValue({
        success: true,
        data: [
          { id: "adj-100.1.1.1", title: "Bug: API broken", status: "open", priority: 1, issue_type: "bug", description: "", created_at: "2026-03-26" },
          { id: "adj-100.1.1.2", title: "Bug: Minor typo", status: "open", priority: 3, issue_type: "bug", description: "", created_at: "2026-03-26" },
          { id: "adj-100.1.1.3", title: "Bug: Critical crash", status: "open", priority: 0, issue_type: "bug", description: "", created_at: "2026-03-26" },
        ],
        exitCode: 0,
      });

      const result = await checkOpenCriticalBugs("proj-123");
      expect(result).toHaveLength(2);
      expect(result.map(b => b.id)).toContain("adj-100.1.1.1");
      expect(result.map(b => b.id)).toContain("adj-100.1.1.3");
      expect(result.map(b => b.id)).not.toContain("adj-100.1.1.2");
    });

    it("should return empty array when bd command fails", async () => {
      mockExecBd.mockResolvedValue({
        success: false,
        error: { code: "EXEC_FAIL", message: "bd not found" },
        exitCode: 1,
      });

      const result = await checkOpenCriticalBugs("proj-123");
      expect(result).toEqual([]);
    });

    it("should call execBd with correct arguments", async () => {
      await checkOpenCriticalBugs("proj-123");

      expect(mockExecBd).toHaveBeenCalledWith(
        ["list", "--status=open", "--type=bug", "--json"],
      );
    });
  });
});
