import { describe, it, expect, vi } from "vitest";

import {
  computeConfidenceScore,
  classifyConfidence,
  getHistoricalSuccessRate,
} from "../../src/services/confidence-engine.js";
import type { ConfidenceSignals } from "../../src/types/auto-develop.js";
import type { ProposalStore } from "../../src/services/proposal-store.js";
import type { Proposal } from "../../src/types/proposals.js";

// =============================================================================
// computeConfidenceScore
// =============================================================================

describe("computeConfidenceScore", () => {
  it("should return 0 when all signals are 0", () => {
    const signals: ConfidenceSignals = {
      reviewerConsensus: 0,
      specClarity: 0,
      codebaseAlignment: 0,
      riskAssessment: 0,
      historicalSuccess: 0,
    };
    expect(computeConfidenceScore(signals)).toBe(0);
  });

  it("should return 100 when all signals are 100", () => {
    const signals: ConfidenceSignals = {
      reviewerConsensus: 100,
      specClarity: 100,
      codebaseAlignment: 100,
      riskAssessment: 100,
      historicalSuccess: 100,
    };
    expect(computeConfidenceScore(signals)).toBe(100);
  });

  it("should compute correct weighted sum for mixed signals", () => {
    const signals: ConfidenceSignals = {
      reviewerConsensus: 80,  // 0.30 * 80 = 24
      specClarity: 70,       // 0.20 * 70 = 14
      codebaseAlignment: 60, // 0.20 * 60 = 12
      riskAssessment: 50,    // 0.15 * 50 = 7.5
      historicalSuccess: 40, // 0.15 * 40 = 6
    };
    // 24 + 14 + 12 + 7.5 + 6 = 63.5 → rounds to 64
    expect(computeConfidenceScore(signals)).toBe(64);
  });

  it("should round to nearest integer", () => {
    const signals: ConfidenceSignals = {
      reviewerConsensus: 33,  // 0.30 * 33 = 9.9
      specClarity: 33,       // 0.20 * 33 = 6.6
      codebaseAlignment: 33, // 0.20 * 33 = 6.6
      riskAssessment: 33,    // 0.15 * 33 = 4.95
      historicalSuccess: 33,  // 0.15 * 33 = 4.95
    };
    // 9.9 + 6.6 + 6.6 + 4.95 + 4.95 = 33.0
    expect(computeConfidenceScore(signals)).toBe(33);
  });

  it("should weight reviewerConsensus highest (30%)", () => {
    // Only reviewerConsensus is 100, rest are 0
    const signals: ConfidenceSignals = {
      reviewerConsensus: 100,
      specClarity: 0,
      codebaseAlignment: 0,
      riskAssessment: 0,
      historicalSuccess: 0,
    };
    expect(computeConfidenceScore(signals)).toBe(30);
  });

  it("should clamp negative input to 0 minimum output", () => {
    // Even though signals shouldn't be negative, ensure clamping
    const signals: ConfidenceSignals = {
      reviewerConsensus: -50,
      specClarity: -50,
      codebaseAlignment: -50,
      riskAssessment: -50,
      historicalSuccess: -50,
    };
    expect(computeConfidenceScore(signals)).toBe(0);
  });

  it("should treat NaN signals as 0 (adj-122.10.4)", () => {
    const signals: ConfidenceSignals = {
      reviewerConsensus: NaN,
      specClarity: 100,
      codebaseAlignment: 100,
      riskAssessment: 100,
      historicalSuccess: 100,
    };
    // NaN reviewerConsensus (30% weight) treated as 0 → 0 + 20 + 20 + 15 + 15 = 70
    expect(computeConfidenceScore(signals)).toBe(70);
  });

  it("should treat Infinity signals as 0 (adj-122.10.4)", () => {
    const signals: ConfidenceSignals = {
      reviewerConsensus: Infinity,
      specClarity: 0,
      codebaseAlignment: 0,
      riskAssessment: 0,
      historicalSuccess: 0,
    };
    // Infinity treated as 0
    expect(computeConfidenceScore(signals)).toBe(0);
  });

  it("should treat -Infinity signals as 0 (adj-122.10.4)", () => {
    const signals: ConfidenceSignals = {
      reviewerConsensus: -Infinity,
      specClarity: 100,
      codebaseAlignment: 100,
      riskAssessment: 100,
      historicalSuccess: 100,
    };
    // -Infinity treated as 0 → 0 + 20 + 20 + 15 + 15 = 70
    expect(computeConfidenceScore(signals)).toBe(70);
  });
});

// =============================================================================
// classifyConfidence
// =============================================================================

describe("classifyConfidence", () => {
  it("should return 'accept' for scores >= 80", () => {
    expect(classifyConfidence(80)).toBe("accept");
    expect(classifyConfidence(100)).toBe("accept");
    expect(classifyConfidence(95)).toBe("accept");
  });

  it("should return 'refine' for scores 60-79", () => {
    expect(classifyConfidence(60)).toBe("refine");
    expect(classifyConfidence(79)).toBe("refine");
    expect(classifyConfidence(70)).toBe("refine");
  });

  it("should return 'escalate' for scores 40-59", () => {
    expect(classifyConfidence(40)).toBe("escalate");
    expect(classifyConfidence(59)).toBe("escalate");
    expect(classifyConfidence(50)).toBe("escalate");
  });

  it("should return 'dismiss' for scores 0-39", () => {
    expect(classifyConfidence(0)).toBe("dismiss");
    expect(classifyConfidence(39)).toBe("dismiss");
    expect(classifyConfidence(20)).toBe("dismiss");
  });

  // Boundary tests
  it("should handle exact threshold boundaries correctly", () => {
    expect(classifyConfidence(79)).toBe("refine");
    expect(classifyConfidence(80)).toBe("accept");
    expect(classifyConfidence(59)).toBe("escalate");
    expect(classifyConfidence(60)).toBe("refine");
    expect(classifyConfidence(39)).toBe("dismiss");
    expect(classifyConfidence(40)).toBe("escalate");
  });
});

// =============================================================================
// getHistoricalSuccessRate
// =============================================================================

describe("getHistoricalSuccessRate", () => {
  function makeProposal(status: string): Proposal {
    return {
      id: "test-id",
      author: "agent",
      title: "Test",
      description: "test",
      type: "engineering",
      status: status as Proposal["status"],
      project: "proj-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      reviewRound: 0,
      autoGenerated: false,
    };
  }

  function createMockStore(proposals: Proposal[]): ProposalStore {
    return {
      insertProposal: vi.fn(),
      getProposal: vi.fn(),
      getProposals: vi.fn().mockReturnValue(proposals),
      updateProposalStatus: vi.fn(),
      insertComment: vi.fn(),
      getComments: vi.fn(),
      reviseProposal: vi.fn(),
      getRevisions: vi.fn(),
      setConfidenceScore: vi.fn(),
      incrementReviewRound: vi.fn(),
      getAutoGeneratedProposals: vi.fn(),
      getProposalsByConfidenceRange: vi.fn(),
    } as unknown as ProposalStore;
  }

  it("should return 50 when no historical data exists", () => {
    const store = createMockStore([]);
    expect(getHistoricalSuccessRate(store, "proj-1", "engineering")).toBe(50);
  });

  it("should return 100 when all proposals are accepted/completed", () => {
    const proposals = [
      makeProposal("accepted"),
      makeProposal("completed"),
      makeProposal("accepted"),
    ];
    const store = createMockStore(proposals);
    expect(getHistoricalSuccessRate(store, "proj-1", "engineering")).toBe(100);
  });

  it("should return 0 when all proposals are dismissed", () => {
    const proposals = [
      makeProposal("dismissed"),
      makeProposal("dismissed"),
    ];
    const store = createMockStore(proposals);
    expect(getHistoricalSuccessRate(store, "proj-1", "engineering")).toBe(0);
  });

  it("should compute correct percentage for mixed outcomes", () => {
    const proposals = [
      makeProposal("accepted"),
      makeProposal("dismissed"),
      makeProposal("completed"),
      makeProposal("dismissed"),
    ];
    const store = createMockStore(proposals);
    // 2 successes / 4 total = 50%
    expect(getHistoricalSuccessRate(store, "proj-1", "engineering")).toBe(50);
  });

  it("should exclude pending proposals from the calculation", () => {
    const proposals = [
      makeProposal("accepted"),
      makeProposal("pending"),
      makeProposal("pending"),
      makeProposal("dismissed"),
    ];
    const store = createMockStore(proposals);
    // 1 success / 2 resolved = 50%
    expect(getHistoricalSuccessRate(store, "proj-1", "engineering")).toBe(50);
  });

  it("should return 50 when all proposals are pending (no resolved)", () => {
    const proposals = [
      makeProposal("pending"),
      makeProposal("pending"),
    ];
    const store = createMockStore(proposals);
    expect(getHistoricalSuccessRate(store, "proj-1", "engineering")).toBe(50);
  });

  it("should pass project and type filters to store", () => {
    const store = createMockStore([]);
    getHistoricalSuccessRate(store, "proj-1", "product");
    expect(store.getProposals).toHaveBeenCalledWith({
      project: "proj-1",
      type: "product",
    });
  });
});
