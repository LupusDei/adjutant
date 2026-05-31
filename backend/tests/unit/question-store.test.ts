/**
 * Tests for QuestionStore (adj-181.1.3 / adj-181.1.4).
 *
 * Uses a real in-memory SQLite database with real migrations applied — no hand-crafted
 * mock objects from TS types (adj-067 rule). Every assertion runs against actual rows
 * inserted and fetched through the store.
 *
 * Methods covered: fileQuestion, getQuestion, answerQuestion, dismissQuestion,
 * listQuestions (≥3 tests each).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createQuestionStore, type QuestionStore } from "../../src/services/question-store.js";

let db: Database.Database;
let store: QuestionStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createQuestionStore(db);
});

afterEach(() => {
  db.close();
});

// ============================================================================
// fileQuestion
// ============================================================================

describe("QuestionStore.fileQuestion", () => {
  it("should persist a question and return it with defaults (happy path)", () => {
    const q = store.fileQuestion({
      projectId: "proj-uuid-1",
      agentId: "agent-raynor",
      body: "Should we pivot the architecture?",
    });

    expect(q.id).toBeTruthy();
    expect(q.projectId).toBe("proj-uuid-1");
    expect(q.agentId).toBe("agent-raynor");
    expect(q.body).toBe("Should we pivot the architecture?");
    expect(q.urgency).toBe("normal");
    expect(q.status).toBe("open");
    expect(q.createdAt).toBeTruthy();
    expect(q.updatedAt).toBeTruthy();
    expect(q.context).toBeUndefined();
    expect(q.category).toBeUndefined();
    expect(q.suggestedOptions).toBeUndefined();
    expect(q.beadId).toBeUndefined();
    expect(q.conversationId).toBeUndefined();
  });

  it("should persist all optional fields correctly (full input)", () => {
    const q = store.fileQuestion({
      projectId: "proj-uuid-2",
      agentId: "agent-kerrigan",
      body: "Which approach for the cache layer?",
      context: "We have a 200ms latency budget",
      category: "decision",
      urgency: "high",
      suggestedOptions: ["redis", "memcached", "local-cache"],
      beadId: "adj-999",
      conversationId: "dm_conv_xyz",
    });

    expect(q.urgency).toBe("high");
    expect(q.category).toBe("decision");
    expect(q.context).toBe("We have a 200ms latency budget");
    expect(q.suggestedOptions).toEqual(["redis", "memcached", "local-cache"]);
    expect(q.beadId).toBe("adj-999");
    expect(q.conversationId).toBe("dm_conv_xyz");
  });

  it("should round-trip suggestedOptions as a JSON array (edge case)", () => {
    const options = ["option A", "option B with spaces", 'option C with "quotes"'];
    const q = store.fileQuestion({
      projectId: "proj-uuid-3",
      agentId: "agent-x",
      body: "Which option?",
      suggestedOptions: options,
    });

    // The stored ID lets us fetch fresh from DB to verify the round-trip
    const fetched = store.getQuestion(q.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.suggestedOptions).toEqual(options);
  });

  it("should generate unique IDs for each question", () => {
    const q1 = store.fileQuestion({ projectId: "p", agentId: "a", body: "Q1" });
    const q2 = store.fileQuestion({ projectId: "p", agentId: "a", body: "Q2" });
    expect(q1.id).not.toBe(q2.id);
  });

  it("should throw a structured error when body is empty", () => {
    expect(() =>
      store.fileQuestion({ projectId: "proj-1", agentId: "agent-1", body: "" }),
    ).toThrow(/body/i);
  });

  it("should throw a structured error when urgency is invalid", () => {
    expect(() =>
      store.fileQuestion({
        projectId: "proj-1",
        agentId: "agent-1",
        body: "Valid body",
        // @ts-expect-error — deliberate invalid value for runtime test
        urgency: "critical",
      }),
    ).toThrow();
  });
});

// ============================================================================
// getQuestion
// ============================================================================

describe("QuestionStore.getQuestion", () => {
  it("should return the question by id after filing (happy path)", () => {
    const filed = store.fileQuestion({
      projectId: "proj-1",
      agentId: "agent-1",
      body: "Which database engine?",
      urgency: "blocking",
    });

    const fetched = store.getQuestion(filed.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(filed.id);
    expect(fetched!.body).toBe("Which database engine?");
    expect(fetched!.urgency).toBe("blocking");
    expect(fetched!.status).toBe("open");
  });

  it("should return null for an unknown id (error path)", () => {
    const result = store.getQuestion("does-not-exist");
    expect(result).toBeNull();
  });

  it("should reflect the updated status after answering (edge case)", () => {
    const q = store.fileQuestion({
      projectId: "proj-1",
      agentId: "agent-1",
      body: "Deploy now?",
    });
    store.answerQuestion(q.id, { answerBody: "Yes, deploy." });
    const fetched = store.getQuestion(q.id);
    expect(fetched!.status).toBe("answered");
    expect(fetched!.answerBody).toBe("Yes, deploy.");
  });
});

// ============================================================================
// answerQuestion
// ============================================================================

describe("QuestionStore.answerQuestion", () => {
  it("should set status to answered and record the answer body (happy path)", () => {
    const q = store.fileQuestion({
      projectId: "proj-1",
      agentId: "agent-1",
      body: "Should we use TypeScript strict mode?",
    });

    const answered = store.answerQuestion(q.id, {
      answerBody: "Yes, always.",
      answeredBy: "user",
    });

    expect(answered.status).toBe("answered");
    expect(answered.answerBody).toBe("Yes, always.");
    expect(answered.answeredBy).toBe("user");
    expect(answered.answeredAt).toBeTruthy();
    // updatedAt and createdAt are set atomically in fast tests; verify it is set, not that it differs
    expect(answered.updatedAt).toBeTruthy();
  });

  it("should accept chosenOption alone when it matches a suggestedOption", () => {
    const q = store.fileQuestion({
      projectId: "proj-1",
      agentId: "agent-1",
      body: "Redis or Memcached?",
      suggestedOptions: ["redis", "memcached"],
    });

    const answered = store.answerQuestion(q.id, { chosenOption: "redis" });
    expect(answered.status).toBe("answered");
    expect(answered.chosenOption).toBe("redis");
  });

  it("should throw when chosenOption is not in suggestedOptions (validation)", () => {
    const q = store.fileQuestion({
      projectId: "proj-1",
      agentId: "agent-1",
      body: "Redis or Memcached?",
      suggestedOptions: ["redis", "memcached"],
    });

    expect(() =>
      store.answerQuestion(q.id, { chosenOption: "dynamodb" }),
    ).toThrow(/not one of the suggested options/i);
  });

  it("should throw when neither answerBody nor chosenOption is provided", () => {
    const q = store.fileQuestion({
      projectId: "proj-1",
      agentId: "agent-1",
      body: "Test question",
    });

    expect(() =>
      store.answerQuestion(q.id, { answeredBy: "user" }),
    ).toThrow(/at least one of/i);
  });

  it("should throw when the question id does not exist", () => {
    expect(() =>
      store.answerQuestion("nonexistent-id", { answerBody: "answer" }),
    ).toThrow(/not found/i);
  });

  it("should accept chosenOption without suggestedOptions when answerBody is also provided", () => {
    const q = store.fileQuestion({
      projectId: "proj-1",
      agentId: "agent-1",
      body: "Any approach?",
      // no suggestedOptions
    });

    // When there are no suggested options, chosenOption can be any non-empty string
    // as long as answerBody is also provided (or alone if no options exist).
    const answered = store.answerQuestion(q.id, {
      answerBody: "Go with the standard approach.",
      chosenOption: "standard",
    });
    expect(answered.status).toBe("answered");
    expect(answered.chosenOption).toBe("standard");
  });
});

// ============================================================================
// dismissQuestion
// ============================================================================

describe("QuestionStore.dismissQuestion", () => {
  it("should set status to dismissed and update timestamps (happy path)", () => {
    const q = store.fileQuestion({
      projectId: "proj-1",
      agentId: "agent-1",
      body: "Is this still relevant?",
    });

    const dismissed = store.dismissQuestion(q.id);
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.answeredAt).toBeTruthy(); // dismissed_at reuses answered_at column
    // updatedAt is set during dismiss; verify it is present (fast test may match createdAt)
    expect(dismissed.updatedAt).toBeTruthy();
  });

  it("should throw when the question does not exist (error path)", () => {
    expect(() => store.dismissQuestion("nonexistent-id")).toThrow(/not found/i);
  });

  it("should not affect other questions when one is dismissed (edge case)", () => {
    const q1 = store.fileQuestion({ projectId: "p", agentId: "a", body: "Q1" });
    const q2 = store.fileQuestion({ projectId: "p", agentId: "a", body: "Q2" });

    store.dismissQuestion(q1.id);

    const fetched2 = store.getQuestion(q2.id);
    expect(fetched2!.status).toBe("open");
  });
});

// ============================================================================
// listQuestions
// ============================================================================

describe("QuestionStore.listQuestions", () => {
  beforeEach(() => {
    // Insert questions with known urgency/status in a specific order to test sorting.
    // We insert low first, then high, then blocking, then normal to verify the sort
    // is by urgency priority (blocking→high→normal→low), not insertion order.
    store.fileQuestion({ projectId: "proj-1", agentId: "a1", body: "Low Q", urgency: "low" });
    store.fileQuestion({ projectId: "proj-1", agentId: "a1", body: "High Q", urgency: "high" });
    store.fileQuestion({ projectId: "proj-1", agentId: "a1", body: "Blocking Q", urgency: "blocking" });
    store.fileQuestion({ projectId: "proj-1", agentId: "a1", body: "Normal Q", urgency: "normal" });
    store.fileQuestion({ projectId: "proj-2", agentId: "a2", body: "Proj2 Q", urgency: "normal" });
  });

  it("should return open questions sorted blocking→high→normal→low (happy path)", () => {
    const list = store.listQuestions({ projectId: "proj-1" });
    const urgencies = list.map((q) => q.urgency);
    expect(urgencies).toEqual(["blocking", "high", "normal", "low"]);
  });

  it("should default to status=open and exclude answered/dismissed", () => {
    // Answer one question
    const qs = store.listQuestions({ projectId: "proj-1" });
    store.answerQuestion(qs[0].id, { answerBody: "answered" });

    const openList = store.listQuestions({ projectId: "proj-1" });
    expect(openList.every((q) => q.status === "open")).toBe(true);
    // Originally had 4, one answered, so 3 remain
    expect(openList).toHaveLength(3);
  });

  it("should filter by projectId and exclude other projects", () => {
    const list = store.listQuestions({ projectId: "proj-2" });
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("Proj2 Q");
  });

  it("should filter by status=answered when requested", () => {
    const q = store.listQuestions({ projectId: "proj-1" })[0];
    store.answerQuestion(q.id, { answerBody: "done" });

    const answeredList = store.listQuestions({ projectId: "proj-1", status: "answered" });
    expect(answeredList).toHaveLength(1);
    expect(answeredList[0].status).toBe("answered");
  });

  it("should filter by category when provided", () => {
    store.fileQuestion({
      projectId: "proj-1",
      agentId: "a1",
      body: "Approval question",
      category: "approval",
      urgency: "normal",
    });

    const list = store.listQuestions({ projectId: "proj-1", category: "approval" });
    expect(list).toHaveLength(1);
    expect(list[0].category).toBe("approval");
  });

  it("should filter by agentId when provided", () => {
    store.fileQuestion({ projectId: "proj-1", agentId: "agent-unique", body: "Unique agent Q" });

    const list = store.listQuestions({ projectId: "proj-1", agentId: "agent-unique" });
    expect(list).toHaveLength(1);
    expect(list[0].agentId).toBe("agent-unique");
  });

  it("should filter by urgency when provided", () => {
    const list = store.listQuestions({ projectId: "proj-1", urgency: "blocking" });
    expect(list).toHaveLength(1);
    expect(list[0].urgency).toBe("blocking");
  });

  it("should return empty array when no questions match the filter", () => {
    const list = store.listQuestions({ projectId: "proj-999" });
    expect(list).toEqual([]);
  });

  it("should return questions oldest-first within the same urgency tier", () => {
    // Add two more normal-urgency questions for proj-1 to test created_at ordering
    store.fileQuestion({ projectId: "proj-3", agentId: "a", body: "Normal First", urgency: "normal" });
    store.fileQuestion({ projectId: "proj-3", agentId: "a", body: "Normal Second", urgency: "normal" });

    const list = store.listQuestions({ projectId: "proj-3" });
    expect(list).toHaveLength(2);
    // "Normal First" was inserted before "Normal Second", so it should appear first
    expect(list[0].body).toBe("Normal First");
    expect(list[1].body).toBe("Normal Second");
  });

  it("should round-trip suggestedOptions in the listed questions", () => {
    const options = ["opt-1", "opt-2"];
    store.fileQuestion({
      projectId: "proj-4",
      agentId: "a",
      body: "Pick one",
      suggestedOptions: options,
    });

    const list = store.listQuestions({ projectId: "proj-4" });
    expect(list[0].suggestedOptions).toEqual(options);
  });
});
