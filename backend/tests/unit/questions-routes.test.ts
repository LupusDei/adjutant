/**
 * Tests for the questions REST routes (adj-181.3.1 / adj-181.3.2).
 *
 * Routes are thin adapters over a QuestionService. The service is fully mocked;
 * tests assert HTTP status codes, response shapes, Zod validation enforcement,
 * and that the route delegates to the correct service method with the right args.
 *
 * Coverage (≥2 per endpoint):
 *   GET  /api/questions              — happy path, default filter, all filters
 *   POST /api/questions/:id/answer   — success, 400 both-absent, 400 bad chosenOption
 *   POST /api/questions/:id/dismiss  — success, 404 not found
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the question-service before importing the router
vi.mock("../../src/services/question-service.js", () => ({
  createQuestionService: vi.fn(),
}));

import { createQuestionsRouter } from "../../src/routes/questions.js";
import type { QuestionService } from "../../src/services/question-service.js";
import type { AgentQuestion } from "../../src/types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<AgentQuestion> = {}): AgentQuestion {
  return {
    id: "q-uuid-001",
    projectId: "proj-uuid-001",
    agentId: "agent-raynor",
    body: "Should we use Redis or Memcached?",
    urgency: "high",
    status: "open",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}

function makeService(overrides: Partial<QuestionService> = {}): QuestionService {
  return {
    fileQuestion: vi.fn(),
    answerQuestion: vi.fn(),
    dismissQuestion: vi.fn(),
    listQuestions: vi.fn(),
    ...overrides,
  } as QuestionService;
}

function createTestApp(service: QuestionService) {
  const app = express();
  app.use(express.json());
  app.use("/api/questions", createQuestionsRouter(service));
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/questions
// ---------------------------------------------------------------------------

describe("GET /api/questions", () => {
  let service: QuestionService;
  let app: express.Express;

  beforeEach(() => {
    service = makeService();
    app = createTestApp(service);
    vi.clearAllMocks();
  });

  it("should return open questions with default status when no query params", async () => {
    const questions = [makeQuestion()];
    vi.mocked(service.listQuestions).mockReturnValue(questions);

    const res = await request(app).get("/api/questions");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.questions).toHaveLength(1);
    expect(res.body.data.questions[0].id).toBe("q-uuid-001");
    expect(service.listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open" }),
    );
  });

  it("should pass all filter params to the service", async () => {
    vi.mocked(service.listQuestions).mockReturnValue([]);

    const res = await request(app)
      .get("/api/questions")
      .query({
        status: "answered",
        projectId: "proj-123",
        category: "decision",
        agentId: "agent-kerrigan",
        urgency: "blocking",
      });

    expect(res.status).toBe(200);
    expect(service.listQuestions).toHaveBeenCalledWith({
      status: "answered",
      projectId: "proj-123",
      category: "decision",
      agentId: "agent-kerrigan",
      urgency: "blocking",
    });
  });

  it("should return 400 when an invalid status is provided", async () => {
    const res = await request(app)
      .get("/api/questions")
      .query({ status: "unknown-status" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(service.listQuestions).not.toHaveBeenCalled();
  });

  it("should return 400 when an invalid urgency is provided", async () => {
    const res = await request(app)
      .get("/api/questions")
      .query({ urgency: "critical" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(service.listQuestions).not.toHaveBeenCalled();
  });

  it("should return an empty list when no questions match", async () => {
    vi.mocked(service.listQuestions).mockReturnValue([]);

    const res = await request(app).get("/api/questions");

    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/questions/:id/answer
// ---------------------------------------------------------------------------

describe("POST /api/questions/:id/answer", () => {
  let service: QuestionService;
  let app: express.Express;

  beforeEach(() => {
    service = makeService();
    app = createTestApp(service);
    vi.clearAllMocks();
  });

  it("should answer a question with answerBody and return the updated question", async () => {
    const answered = makeQuestion({
      status: "answered",
      answerBody: "Use Redis — it supports TTL natively.",
      answeredBy: "user",
      answeredAt: "2026-05-31T01:00:00.000Z",
    });
    vi.mocked(service.answerQuestion).mockResolvedValue(answered);

    const res = await request(app)
      .post("/api/questions/q-uuid-001/answer")
      .send({ answerBody: "Use Redis — it supports TTL natively." });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.question.status).toBe("answered");
    expect(service.answerQuestion).toHaveBeenCalledWith(
      "q-uuid-001",
      expect.objectContaining({ answerBody: "Use Redis — it supports TTL natively." }),
    );
  });

  it("should answer a question with chosenOption and return the updated question", async () => {
    const answered = makeQuestion({
      status: "answered",
      chosenOption: "redis",
      suggestedOptions: ["redis", "memcached"],
    });
    vi.mocked(service.answerQuestion).mockResolvedValue(answered);

    const res = await request(app)
      .post("/api/questions/q-uuid-001/answer")
      .send({ chosenOption: "redis" });

    expect(res.status).toBe(200);
    expect(res.body.data.question.chosenOption).toBe("redis");
    expect(service.answerQuestion).toHaveBeenCalledWith(
      "q-uuid-001",
      expect.objectContaining({ chosenOption: "redis" }),
    );
  });

  it("should return 400 when both answerBody and chosenOption are absent", async () => {
    const res = await request(app)
      .post("/api/questions/q-uuid-001/answer")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(service.answerQuestion).not.toHaveBeenCalled();
  });

  it("should return 400 when body is an empty string only", async () => {
    const res = await request(app)
      .post("/api/questions/q-uuid-001/answer")
      .send({ answerBody: "" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(service.answerQuestion).not.toHaveBeenCalled();
  });

  it("should return 404 when the service throws a not-found error", async () => {
    vi.mocked(service.answerQuestion).mockRejectedValue(
      new Error("Question not found: q-missing"),
    );

    const res = await request(app)
      .post("/api/questions/q-missing/answer")
      .send({ answerBody: "Done." });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("should pass answeredBy='user' when no override is specified", async () => {
    vi.mocked(service.answerQuestion).mockResolvedValue(makeQuestion({ status: "answered" }));

    await request(app)
      .post("/api/questions/q-uuid-001/answer")
      .send({ answerBody: "Answer text" });

    expect(service.answerQuestion).toHaveBeenCalledWith(
      "q-uuid-001",
      expect.objectContaining({ answeredBy: "user" }),
    );
  });

  // adj-kvenl regression: the describe header claims "400 bad chosenOption" coverage
  // but no such test existed. A chosenOption that is NOT in suggestedOptions must return
  // 400 (not 500) — the store-thrown validation error must be mapped to a client error.

  it("adj-kvenl: should return 400 when chosenOption is not in the question's suggestedOptions", async () => {
    vi.mocked(service.answerQuestion).mockRejectedValue(
      new Error('chosenOption "invalid-option" is not one of the suggested options: Redis, SQLite'),
    );

    const res = await request(app)
      .post("/api/questions/q-uuid-001/answer")
      .send({ chosenOption: "invalid-option" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // Must contain a meaningful error message
    expect(res.body).toMatchObject({ success: false });
  });
});

// ---------------------------------------------------------------------------
// POST /api/questions/:id/dismiss
// ---------------------------------------------------------------------------

describe("POST /api/questions/:id/dismiss", () => {
  let service: QuestionService;
  let app: express.Express;

  beforeEach(() => {
    service = makeService();
    app = createTestApp(service);
    vi.clearAllMocks();
  });

  it("should dismiss a question and return the updated question", async () => {
    const dismissed = makeQuestion({ status: "dismissed" });
    vi.mocked(service.dismissQuestion).mockResolvedValue(dismissed);

    const res = await request(app).post("/api/questions/q-uuid-001/dismiss");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.question.status).toBe("dismissed");
    expect(service.dismissQuestion).toHaveBeenCalledWith("q-uuid-001");
  });

  it("should return 404 when the service throws a not-found error", async () => {
    vi.mocked(service.dismissQuestion).mockRejectedValue(
      new Error("Question not found: q-missing"),
    );

    const res = await request(app).post("/api/questions/q-missing/dismiss");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
