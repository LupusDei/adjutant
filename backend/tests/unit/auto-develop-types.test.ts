import { describe, it, expect } from "vitest";

import {
  EnableAutoDevelopSchema,
  ProvideVisionUpdateSchema,
  ScoreProposalSchema,
  UpdateProjectAutoDevelopSchema,
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_THRESHOLDS,
  MAX_REVIEW_ROUNDS,
  AUTO_DEVELOP_LIMITS,
} from "../../src/types/auto-develop.js";
import type {
  ConfidenceSignals,
  ConfidenceClassification,
  AutoDevelopPhase,
  AutoDevelopStatus,
} from "../../src/types/auto-develop.js";
import { getEventBus, resetEventBus } from "../../src/services/event-bus.js";
import type {
  AutoDevelopEnabledEvent,
  AutoDevelopDisabledEvent,
  ProposalScoredEvent,
  ProposalCompletedEvent,
  AutoDevelopPhaseChangedEvent,
  AutoDevelopEscalatedEvent,
} from "../../src/services/event-bus.js";

// ============================================================================
// Constants Validation
// ============================================================================

describe("Auto-develop constants", () => {
  it("should have confidence weights that sum to 1.0", () => {
    const sum = Object.values(CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("should have thresholds in descending order", () => {
    expect(CONFIDENCE_THRESHOLDS.accept).toBeGreaterThan(CONFIDENCE_THRESHOLDS.refine);
    expect(CONFIDENCE_THRESHOLDS.refine).toBeGreaterThan(CONFIDENCE_THRESHOLDS.escalate);
  });

  it("should have MAX_REVIEW_ROUNDS as a positive integer", () => {
    expect(MAX_REVIEW_ROUNDS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_REVIEW_ROUNDS)).toBe(true);
  });

  it("should have valid AUTO_DEVELOP_LIMITS", () => {
    expect(AUTO_DEVELOP_LIMITS.maxProposalsInReview).toBeGreaterThan(0);
    expect(AUTO_DEVELOP_LIMITS.maxEpicsInExecution).toBeGreaterThan(0);
    expect(AUTO_DEVELOP_LIMITS.proposalCooldownMs).toBeGreaterThan(0);
    expect(AUTO_DEVELOP_LIMITS.heartbeatIntervalMs).toBeGreaterThan(0);
    expect(AUTO_DEVELOP_LIMITS.escalationTimeoutMs).toBeGreaterThan(0);
  });
});

// ============================================================================
// EnableAutoDevelopSchema
// ============================================================================

describe("EnableAutoDevelopSchema", () => {
  it("should accept valid input with visionContext", () => {
    const result = EnableAutoDevelopSchema.safeParse({
      visionContext: "Build a better world",
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty object (visionContext is optional)", () => {
    const result = EnableAutoDevelopSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should reject visionContext exceeding 10000 characters", () => {
    const result = EnableAutoDevelopSchema.safeParse({
      visionContext: "x".repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it("should accept visionContext at exactly 10000 characters", () => {
    const result = EnableAutoDevelopSchema.safeParse({
      visionContext: "x".repeat(10000),
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// ProvideVisionUpdateSchema
// ============================================================================

describe("ProvideVisionUpdateSchema", () => {
  it("should accept valid vision update", () => {
    const result = ProvideVisionUpdateSchema.safeParse({
      visionContext: "New direction for the project",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty visionContext string", () => {
    const result = ProvideVisionUpdateSchema.safeParse({
      visionContext: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing visionContext", () => {
    const result = ProvideVisionUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject visionContext exceeding 10000 characters", () => {
    const result = ProvideVisionUpdateSchema.safeParse({
      visionContext: "x".repeat(10001),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ScoreProposalSchema
// ============================================================================

describe("ScoreProposalSchema", () => {
  const validInput = {
    proposalId: "prop-001",
    reviewerConsensus: 85,
    specClarity: 70,
    codebaseAlignment: 90,
    riskAssessment: 60,
    historicalSuccess: 75,
  };

  it("should accept valid score input", () => {
    const result = ScoreProposalSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("should reject missing proposalId", () => {
    const { proposalId, ...rest } = validInput;
    const result = ScoreProposalSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("should reject empty proposalId", () => {
    const result = ScoreProposalSchema.safeParse({ ...validInput, proposalId: "" });
    expect(result.success).toBe(false);
  });

  it("should reject score below 0", () => {
    const result = ScoreProposalSchema.safeParse({ ...validInput, reviewerConsensus: -1 });
    expect(result.success).toBe(false);
  });

  it("should reject score above 100", () => {
    const result = ScoreProposalSchema.safeParse({ ...validInput, specClarity: 101 });
    expect(result.success).toBe(false);
  });

  it("should accept boundary values (0 and 100)", () => {
    const result = ScoreProposalSchema.safeParse({
      ...validInput,
      reviewerConsensus: 0,
      specClarity: 100,
      codebaseAlignment: 0,
      riskAssessment: 100,
      historicalSuccess: 0,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing score fields", () => {
    const { riskAssessment, ...rest } = validInput;
    const result = ScoreProposalSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// UpdateProjectAutoDevelopSchema
// ============================================================================

describe("UpdateProjectAutoDevelopSchema", () => {
  it("should accept valid update with both fields", () => {
    const result = UpdateProjectAutoDevelopSchema.safeParse({
      autoDevelop: true,
      visionContext: "Ship it",
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty object (all fields optional)", () => {
    const result = UpdateProjectAutoDevelopSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should accept autoDevelop alone", () => {
    const result = UpdateProjectAutoDevelopSchema.safeParse({ autoDevelop: false });
    expect(result.success).toBe(true);
  });

  it("should reject non-boolean autoDevelop", () => {
    const result = UpdateProjectAutoDevelopSchema.safeParse({ autoDevelop: "yes" });
    expect(result.success).toBe(false);
  });

  it("should reject visionContext exceeding 10000 characters", () => {
    const result = UpdateProjectAutoDevelopSchema.safeParse({
      visionContext: "x".repeat(10001),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// EventBus Event Types (compile-time + runtime emit/listen)
// ============================================================================

describe("EventBus auto-develop events", () => {
  beforeEach(() => {
    resetEventBus();
  });

  it("should emit and receive project:auto_develop_enabled event", () => {
    const bus = getEventBus();
    let received: AutoDevelopEnabledEvent | null = null;
    bus.on("project:auto_develop_enabled", (data) => {
      received = data;
    });
    bus.emit("project:auto_develop_enabled", {
      projectId: "proj-1",
      projectName: "Adjutant",
      visionContext: "Build the future",
    });
    expect(received).toEqual({
      projectId: "proj-1",
      projectName: "Adjutant",
      visionContext: "Build the future",
    });
  });

  it("should emit and receive project:auto_develop_disabled event", () => {
    const bus = getEventBus();
    let received: AutoDevelopDisabledEvent | null = null;
    bus.on("project:auto_develop_disabled", (data) => {
      received = data;
    });
    bus.emit("project:auto_develop_disabled", {
      projectId: "proj-1",
      projectName: "Adjutant",
    });
    expect(received).toEqual({ projectId: "proj-1", projectName: "Adjutant" });
  });

  it("should emit and receive proposal:scored event", () => {
    const bus = getEventBus();
    let received: ProposalScoredEvent | null = null;
    bus.on("proposal:scored", (data) => {
      received = data;
    });
    bus.emit("proposal:scored", {
      proposalId: "prop-1",
      projectId: "proj-1",
      score: 82,
      classification: "accept",
      reviewRound: 1,
    });
    expect(received).toEqual({
      proposalId: "prop-1",
      projectId: "proj-1",
      score: 82,
      classification: "accept",
      reviewRound: 1,
    });
  });

  it("should emit and receive proposal:completed event", () => {
    const bus = getEventBus();
    let received: ProposalCompletedEvent | null = null;
    bus.on("proposal:completed", (data) => {
      received = data;
    });
    bus.emit("proposal:completed", {
      proposalId: "prop-1",
      projectId: "proj-1",
      epicId: "adj-200",
    });
    expect(received).toEqual({
      proposalId: "prop-1",
      projectId: "proj-1",
      epicId: "adj-200",
    });
  });

  it("should emit and receive auto_develop:phase_changed event", () => {
    const bus = getEventBus();
    let received: AutoDevelopPhaseChangedEvent | null = null;
    bus.on("auto_develop:phase_changed", (data) => {
      received = data;
    });
    bus.emit("auto_develop:phase_changed", {
      projectId: "proj-1",
      cycleId: "cycle-1",
      previousPhase: "analyze",
      newPhase: "ideate",
    });
    expect(received).toEqual({
      projectId: "proj-1",
      cycleId: "cycle-1",
      previousPhase: "analyze",
      newPhase: "ideate",
    });
  });

  it("should emit and receive auto_develop:escalated event", () => {
    const bus = getEventBus();
    let received: AutoDevelopEscalatedEvent | null = null;
    bus.on("auto_develop:escalated", (data) => {
      received = data;
    });
    bus.emit("auto_develop:escalated", {
      projectId: "proj-1",
      reason: "Low confidence after 3 rounds",
      proposalIds: ["prop-1", "prop-2"],
    });
    expect(received).toEqual({
      projectId: "proj-1",
      reason: "Low confidence after 3 rounds",
      proposalIds: ["prop-1", "prop-2"],
    });
  });

  it("should include new events in listenerCounts when listeners exist", () => {
    const bus = getEventBus();
    bus.on("project:auto_develop_enabled", () => {});
    bus.on("auto_develop:escalated", () => {});
    const counts = bus.listenerCounts();
    expect(counts["project:auto_develop_enabled"]).toBe(1);
    expect(counts["auto_develop:escalated"]).toBe(1);
  });
});

// ============================================================================
// Type-level checks (compile-time only — if this file compiles, types are correct)
// ============================================================================

describe("Type-level checks", () => {
  it("should allow valid ConfidenceSignals", () => {
    const signals: ConfidenceSignals = {
      reviewerConsensus: 80,
      specClarity: 70,
      codebaseAlignment: 90,
      riskAssessment: 60,
      historicalSuccess: 75,
    };
    expect(signals).toBeDefined();
  });

  it("should allow valid ConfidenceClassification values", () => {
    const values: ConfidenceClassification[] = ["accept", "refine", "escalate", "dismiss"];
    expect(values).toHaveLength(4);
  });

  it("should allow valid AutoDevelopPhase values", () => {
    const phases: AutoDevelopPhase[] = [
      "analyze", "ideate", "review", "gate", "plan", "execute", "validate",
    ];
    expect(phases).toHaveLength(7);
  });

  it("should allow valid AutoDevelopStatus shape", () => {
    const status: AutoDevelopStatus = {
      enabled: true,
      paused: false,
      pausedAt: null,
      currentPhase: "analyze",
      activeCycleId: "cycle-1",
      visionContext: "Build it",
      proposals: { inReview: 1, accepted: 2, escalated: 0, dismissed: 1 },
      epicsInExecution: 1,
      cycleStats: { totalCycles: 5, completedCycles: 3 },
    };
    expect(status.enabled).toBe(true);
  });
});
