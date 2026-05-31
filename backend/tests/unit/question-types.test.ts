/**
 * Tests for AgentQuestion types and Zod schemas (adj-181.1.5 / adj-181.1.6).
 *
 * Verifies the AgentQuestion interface, urgency/status enums, FileQuestionSchema,
 * AnswerQuestionSchema (with refinement: at least one of answerBody/chosenOption),
 * and ListQuestionsSchema parse valid input and reject bad values.
 */

import { describe, it, expect } from "vitest";

import {
  AgentQuestionUrgencySchema,
  AgentQuestionStatusSchema,
  AgentQuestionSchema,
  FileQuestionSchema,
  AnswerQuestionSchema,
  ListQuestionsSchema,
  type AgentQuestion,
  type AgentQuestionUrgency,
  type AgentQuestionStatus,
} from "../../src/types/index.js";

// ============================================================================
// AgentQuestionUrgencySchema
// ============================================================================

describe("AgentQuestionUrgencySchema", () => {
  it("should accept all valid urgency values", () => {
    for (const v of ["low", "normal", "high", "blocking"]) {
      expect(AgentQuestionUrgencySchema.safeParse(v).success).toBe(true);
    }
  });

  it("should reject invalid urgency values", () => {
    for (const v of ["critical", "urgent", "", "NORMAL", undefined]) {
      expect(AgentQuestionUrgencySchema.safeParse(v).success).toBe(false);
    }
  });

  it("should narrow the TypeScript type correctly", () => {
    const urgency: AgentQuestionUrgency = "blocking";
    expect(AgentQuestionUrgencySchema.safeParse(urgency).success).toBe(true);
  });
});

// ============================================================================
// AgentQuestionStatusSchema
// ============================================================================

describe("AgentQuestionStatusSchema", () => {
  it("should accept all valid status values", () => {
    for (const v of ["open", "answered", "dismissed"]) {
      expect(AgentQuestionStatusSchema.safeParse(v).success).toBe(true);
    }
  });

  it("should reject invalid status values", () => {
    for (const v of ["closed", "pending", "", "OPEN", null]) {
      expect(AgentQuestionStatusSchema.safeParse(v).success).toBe(false);
    }
  });

  it("should narrow the TypeScript type correctly", () => {
    const status: AgentQuestionStatus = "answered";
    expect(AgentQuestionStatusSchema.safeParse(status).success).toBe(true);
  });
});

// ============================================================================
// AgentQuestionSchema (full record shape)
// ============================================================================

describe("AgentQuestionSchema", () => {
  const validQuestion = {
    id: "q-001",
    projectId: "proj-uuid-1234",
    agentId: "engineer-1",
    body: "Should I use approach A or B?",
    context: "We have a deadline tomorrow",
    category: "decision",
    suggestedOptions: ["approach A", "approach B"],
    urgency: "high" as const,
    status: "open" as const,
    answerBody: null,
    chosenOption: null,
    answeredBy: null,
    beadId: "adj-123",
    conversationId: "dm_conv_abc",
    createdAt: "2026-05-31T10:00:00.000Z",
    answeredAt: null,
    updatedAt: "2026-05-31T10:00:00.000Z",
  };

  it("should accept a fully populated valid question", () => {
    const result = AgentQuestionSchema.safeParse(validQuestion);
    expect(result.success).toBe(true);
  });

  it("should accept a minimal question (only required fields)", () => {
    const minimal = {
      id: "q-002",
      projectId: "proj-uuid-5678",
      agentId: "agent-x",
      body: "What is the plan?",
      urgency: "normal" as const,
      status: "open" as const,
      createdAt: "2026-05-31T10:00:00.000Z",
      updatedAt: "2026-05-31T10:00:00.000Z",
    };
    const result = AgentQuestionSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("should reject missing required body", () => {
    const { body: _body, ...rest } = validQuestion;
    const result = AgentQuestionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("should reject missing required projectId", () => {
    const { projectId: _pid, ...rest } = validQuestion;
    const result = AgentQuestionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("should reject invalid urgency in a question record", () => {
    const result = AgentQuestionSchema.safeParse({ ...validQuestion, urgency: "panic" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid status in a question record", () => {
    const result = AgentQuestionSchema.safeParse({ ...validQuestion, status: "archived" });
    expect(result.success).toBe(false);
  });

  it("should reject empty suggestedOptions array entries", () => {
    const result = AgentQuestionSchema.safeParse({
      ...validQuestion,
      suggestedOptions: ["valid", ""],
    });
    expect(result.success).toBe(false);
  });

  it("should compile as a valid AgentQuestion interface", () => {
    // Type-level check — if this compiles, the interface matches the schema.
    const q: AgentQuestion = {
      id: "q-999",
      projectId: "proj-abc",
      agentId: "agent-raynor",
      body: "Which path forward?",
      urgency: "blocking",
      status: "open",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };
    expect(q.urgency).toBe("blocking");
  });
});

// ============================================================================
// FileQuestionSchema (input for creating a question)
// ============================================================================

describe("FileQuestionSchema", () => {
  it("should accept all optional fields populated", () => {
    const result = FileQuestionSchema.safeParse({
      projectId: "proj-uuid",
      agentId: "agent-1",
      body: "Should we pivot?",
      context: "Market shifted",
      category: "decision",
      urgency: "high",
      suggestedOptions: ["yes", "no", "defer"],
      beadId: "adj-42",
      conversationId: "dm_abc",
    });
    expect(result.success).toBe(true);
  });

  it("should accept only required fields (body, projectId, agentId)", () => {
    const result = FileQuestionSchema.safeParse({
      projectId: "proj-uuid",
      agentId: "agent-1",
      body: "What should we do?",
    });
    expect(result.success).toBe(true);
  });

  it("should default urgency to normal when not provided", () => {
    const result = FileQuestionSchema.safeParse({
      projectId: "proj-uuid",
      agentId: "agent-1",
      body: "Any plans?",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.urgency).toBe("normal");
    }
  });

  it("should reject empty body", () => {
    const result = FileQuestionSchema.safeParse({
      projectId: "proj-uuid",
      agentId: "agent-1",
      body: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing body", () => {
    const result = FileQuestionSchema.safeParse({
      projectId: "proj-uuid",
      agentId: "agent-1",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid urgency", () => {
    const result = FileQuestionSchema.safeParse({
      projectId: "proj-uuid",
      agentId: "agent-1",
      body: "What?",
      urgency: "ultra",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty strings in suggestedOptions array", () => {
    const result = FileQuestionSchema.safeParse({
      projectId: "proj-uuid",
      agentId: "agent-1",
      body: "What?",
      suggestedOptions: ["valid", ""],
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// AnswerQuestionSchema (requires at least one of answerBody/chosenOption)
// ============================================================================

describe("AnswerQuestionSchema", () => {
  it("should accept answerBody alone", () => {
    const result = AnswerQuestionSchema.safeParse({
      answerBody: "Go with approach A.",
    });
    expect(result.success).toBe(true);
  });

  it("should accept chosenOption alone", () => {
    const result = AnswerQuestionSchema.safeParse({
      chosenOption: "approach A",
    });
    expect(result.success).toBe(true);
  });

  it("should accept both answerBody and chosenOption", () => {
    const result = AnswerQuestionSchema.safeParse({
      answerBody: "Use option A because it's simpler.",
      chosenOption: "approach A",
      answeredBy: "user",
    });
    expect(result.success).toBe(true);
  });

  it("should reject when neither answerBody nor chosenOption is provided", () => {
    const result = AnswerQuestionSchema.safeParse({
      answeredBy: "user",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty object", () => {
    const result = AnswerQuestionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject empty answerBody with no chosenOption", () => {
    const result = AnswerQuestionSchema.safeParse({
      answerBody: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty chosenOption with no answerBody", () => {
    const result = AnswerQuestionSchema.safeParse({
      chosenOption: "",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ListQuestionsSchema
// ============================================================================

describe("ListQuestionsSchema", () => {
  it("should accept empty filter (all optional)", () => {
    const result = ListQuestionsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should accept all valid filter combinations", () => {
    const result = ListQuestionsSchema.safeParse({
      status: "open",
      projectId: "proj-abc",
      category: "decision",
      agentId: "agent-1",
      urgency: "blocking",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid status filter", () => {
    const result = ListQuestionsSchema.safeParse({ status: "resolved" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid urgency filter", () => {
    const result = ListQuestionsSchema.safeParse({ urgency: "panic" });
    expect(result.success).toBe(false);
  });
});
