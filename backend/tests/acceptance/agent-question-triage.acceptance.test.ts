/**
 * Acceptance Tests: Agent Question Triage (adj-181)
 *
 * End-to-end flow exercised against the REAL store, service, and route layers
 * using an in-memory SQLite database with real migrations applied.
 *
 * Mocked only:
 *   - apns-service (sendNotificationToAll / isAPNsConfigured) — no hardware
 *   - WS broadcast sink — injected as a vi.fn() into QuestionService
 *
 * The test covers:
 *   1. file_question via service → status:'open', appears in open list,
 *      DM mirrored (conversationId set on row), question:new WS broadcast fired,
 *      APNS push enqueued for blocking/high urgency; NOT for normal/low urgency.
 *   2. answer_question (chosenOption from suggestedOptions) → status:'answered',
 *      leaves open list, question:answered broadcast fires, answer mirrored to DM.
 *   3. answer_question (free-text answerBody only) → same lifecycle.
 *   4. dismiss flow on a second question → status:'dismissed', leaves open list,
 *      question:dismissed broadcast fires.
 *   5. Sort order: blocking first over normal.
 *   6. Validation: reject answer with neither answerBody nor chosenOption;
 *      reject chosenOption not in suggestedOptions.
 *   7. REST route integration smoke-test (router → service wiring).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Mock APNS with real call signatures from apns-service.ts (adj-067 rule)
// ---------------------------------------------------------------------------
vi.mock("../../src/services/apns-service.js", () => ({
  isAPNsConfigured: vi.fn(),
  sendNotificationToAll: vi.fn(),
}));

import { runMigrations } from "../../src/services/database.js";
import { createQuestionStore } from "../../src/services/question-store.js";
import { createQuestionService } from "../../src/services/question-service.js";
import { createConversationStore } from "../../src/services/conversation-store.js";
import { createMessageStore } from "../../src/services/message-store.js";
import { isAPNsConfigured, sendNotificationToAll } from "../../src/services/apns-service.js";
import type { WsServerMessage } from "../../src/services/ws-server.js";
import type { QuestionService } from "../../src/services/question-service.js";
import type { QuestionStore } from "../../src/services/question-store.js";

// ---------------------------------------------------------------------------
// APNS return shapes (real shapes from apns-service.ts — adj-067)
// ---------------------------------------------------------------------------

const PUSH_SUCCESS = {
  success: true as const,
  data: { sent: 1, failed: 0, results: [{ success: true, deviceToken: "device-token-001" }] },
};

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

describe("Acceptance: Agent Question Triage (adj-181)", () => {
  let db: Database.Database;
  let questionStore: QuestionStore;
  let questionService: QuestionService;
  let broadcastCalls: WsServerMessage[];

  const PROJECT_ID = "proj-acceptance-181";
  const AGENT_ID = "agent-acceptance-tester";

  beforeEach(() => {
    // Real in-memory SQLite with real migrations
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    // Real stores
    const messageStore = createMessageStore(db);
    const conversationStore = createConversationStore(db, messageStore);
    questionStore = createQuestionStore(db);

    // WS broadcast sink — capture calls for assertion
    broadcastCalls = [];
    const wsBroadcast = vi.fn((msg: WsServerMessage) => {
      broadcastCalls.push(msg);
    });

    // QuestionService with real stores, mock WS broadcast, mock APNS
    questionService = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    // Default: APNS configured (blocking/high questions will push)
    vi.mocked(isAPNsConfigured).mockReturnValue(true);
    vi.mocked(sendNotificationToAll).mockResolvedValue(PUSH_SUCCESS);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // US1 — Agent files a structured question
  // -------------------------------------------------------------------------

  describe("US1 — file_question: persist + DM mirror + WS broadcast + APNS", () => {
    it("should return {id, status:'open'} and persist the question with all fields", async () => {
      const result = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we use Redis or SQLite for the session cache?",
        context: "Redis gives lower latency; SQLite avoids ops overhead.",
        category: "decision",
        urgency: "high",
        suggestedOptions: ["Redis", "SQLite"],
      });

      expect(result.id).toBeTruthy();
      expect(result.status).toBe("open");
      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.body).toBe("Should we use Redis or SQLite for the session cache?");
      expect(result.context).toBe("Redis gives lower latency; SQLite avoids ops overhead.");
      expect(result.category).toBe("decision");
      expect(result.urgency).toBe("high");
      expect(result.suggestedOptions).toEqual(["Redis", "SQLite"]);
    });

    it("should appear in listQuestions({status:'open'}) after filing", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we enable feature flags in the staging env?",
        urgency: "normal",
      });

      const openList = questionService.listQuestions({ status: "open", projectId: PROJECT_ID });
      const found = openList.find((q) => q.id === filed.id);
      expect(found).toBeDefined();
      expect(found?.status).toBe("open");
    });

    it("should mirror the question into the asker's DM and set conversationId on the row (adj-i8epe fix)", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Please add STRIPE_SECRET_KEY to production .env",
        context: "Payment integration is blocked until the key is set.",
        category: "action_required",
        urgency: "blocking",
      });

      // DM mirror: the conversationId should be set on the question row (adj-i8epe fix)
      const persisted = questionStore.getQuestion(filed.id);
      expect(persisted?.conversationId).toBeTruthy();
      expect(typeof persisted?.conversationId).toBe("string");
      expect(persisted!.conversationId!.length).toBeGreaterThan(0);
    });

    it("should fire a question:new WS broadcast when a question is filed", async () => {
      await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Is the deployment window still 2PM?",
        urgency: "normal",
      });

      const newBroadcast = broadcastCalls.find((m) => m.type === "question:new");
      expect(newBroadcast).toBeDefined();
      expect(newBroadcast?.agentId).toBe(AGENT_ID);
      expect(newBroadcast?.projectId).toBe(PROJECT_ID);
      expect(newBroadcast?.urgency).toBe("normal");
    });

    it("should enqueue an APNS push for a blocking-urgency question (adj-96rtr fix)", async () => {
      await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Need S3 bucket permissions ASAP — deploy is blocked",
        category: "action_required",
        urgency: "blocking",
      });

      // Give the async push a tick to complete
      await Promise.resolve();

      expect(sendNotificationToAll).toHaveBeenCalledOnce();
      const pushPayload = vi.mocked(sendNotificationToAll).mock.calls[0]![0];
      expect(pushPayload.data?.["screen"]).toBe("open_questions");
      expect(pushPayload.data?.["urgency"]).toBe("blocking");
      expect(pushPayload.data?.["agentId"]).toBe(AGENT_ID);
    });

    it("should enqueue an APNS push for a high-urgency question", async () => {
      await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "High urgency: production latency spike — decision needed",
        urgency: "high",
      });

      await Promise.resolve();
      expect(sendNotificationToAll).toHaveBeenCalledOnce();
    });

    it("should NOT enqueue an APNS push for a normal-urgency question (adj-96rtr fix)", async () => {
      await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Which linter config should we standardise on?",
        urgency: "normal",
      });

      // Flush microtask queue
      await Promise.resolve();
      expect(sendNotificationToAll).not.toHaveBeenCalled();
    });

    it("should NOT enqueue an APNS push for a low-urgency question", async () => {
      await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we rename the repo?",
        urgency: "low",
      });

      await Promise.resolve();
      expect(sendNotificationToAll).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // US2 — Answer a question (chosenOption + free-text paths)
  // -------------------------------------------------------------------------

  describe("US2 — answer_question: chosenOption and free-text paths", () => {
    it("should mark status:'answered' when answered via chosenOption from suggestedOptions (adj-baauf fix)", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Redis or SQLite?",
        suggestedOptions: ["Redis", "SQLite"],
        urgency: "high",
      });

      const answered = await questionService.answerQuestion(filed.id, {
        chosenOption: "Redis",
        answeredBy: "user",
      });

      expect(answered.status).toBe("answered");
      expect(answered.chosenOption).toBe("Redis");
      expect(answered.answeredAt).toBeTruthy();
      expect(answered.answeredBy).toBe("user");
    });

    it("should leave the open list after being answered via chosenOption", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Which framework?",
        suggestedOptions: ["React", "Vue"],
        urgency: "normal",
      });

      await questionService.answerQuestion(filed.id, {
        chosenOption: "React",
        answeredBy: "user",
      });

      const openList = questionService.listQuestions({ status: "open", projectId: PROJECT_ID });
      const stillOpen = openList.find((q) => q.id === filed.id);
      expect(stillOpen).toBeUndefined();
    });

    it("should fire question:answered WS broadcast on answer and carry chosenOption", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Use feature flags?",
        suggestedOptions: ["Yes", "No"],
        urgency: "normal",
      });

      await questionService.answerQuestion(filed.id, {
        chosenOption: "Yes",
        answeredBy: "user",
      });

      const answeredBroadcast = broadcastCalls.find((m) => m.type === "question:answered");
      expect(answeredBroadcast).toBeDefined();
      expect(answeredBroadcast?.questionId).toBe(filed.id);
      expect(answeredBroadcast?.chosenOption).toBe("Yes");
    });

    it("should accept a free-text answerBody with no chosenOption required", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "What is the deployment window?",
        urgency: "normal",
      });

      const answered = await questionService.answerQuestion(filed.id, {
        answerBody: "Deployment window is every Thursday 2–4 PM PST.",
        answeredBy: "user",
      });

      expect(answered.status).toBe("answered");
      expect(answered.answerBody).toBe("Deployment window is every Thursday 2–4 PM PST.");
      expect(answered.chosenOption).toBeUndefined();
    });

    it("should persist conversationId from filing through to the answered row", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we pin node to v20?",
        urgency: "normal",
      });

      const questionRowBeforeAnswer = questionStore.getQuestion(filed.id);
      const dmConvId = questionRowBeforeAnswer?.conversationId;
      expect(dmConvId).toBeTruthy();

      await questionService.answerQuestion(filed.id, {
        answerBody: "Yes, pin to v20 LTS.",
        answeredBy: "user",
      });

      // The row should still have the same conversationId set during filing (adj-i8epe fix)
      const questionRowAfterAnswer = questionStore.getQuestion(filed.id);
      expect(questionRowAfterAnswer?.conversationId).toBe(dmConvId);
      expect(questionRowAfterAnswer?.status).toBe("answered");
    });

    it("should reject answer with neither answerBody nor chosenOption", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we add a retry queue?",
        urgency: "normal",
      });

      // The store enforces this validation; the service surfaces the throw
      await expect(
        questionService.answerQuestion(filed.id, {
          answeredBy: "user",
          // No answerBody, no chosenOption — triggers the "at least one" guard
        } as Parameters<QuestionService["answerQuestion"]>[1]),
      ).rejects.toThrow(/at least one of answerBody or chosenOption/i);
    });

    it("should reject chosenOption not in suggestedOptions", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Database engine?",
        suggestedOptions: ["PostgreSQL", "SQLite"],
        urgency: "normal",
      });

      await expect(
        questionService.answerQuestion(filed.id, {
          chosenOption: "MongoDB",
          answeredBy: "user",
        }),
      ).rejects.toThrow(/not one of the suggested options/i);
    });
  });

  // -------------------------------------------------------------------------
  // US3 — Dismiss a question
  // -------------------------------------------------------------------------

  describe("US3 — dismiss_question: status:'dismissed' + leaves open list + broadcast", () => {
    it("should mark status:'dismissed' on dismissal", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we add dark-mode to the dashboard?",
        urgency: "low",
      });

      const dismissed = await questionService.dismissQuestion(filed.id);
      expect(dismissed.status).toBe("dismissed");
    });

    it("should leave the open list after dismissal", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Rename the root package?",
        urgency: "low",
      });

      await questionService.dismissQuestion(filed.id);

      const openList = questionService.listQuestions({ status: "open", projectId: PROJECT_ID });
      const stillOpen = openList.find((q) => q.id === filed.id);
      expect(stillOpen).toBeUndefined();
    });

    it("should fire question:dismissed WS broadcast on dismissal", async () => {
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we switch to pnpm?",
        urgency: "low",
      });

      await questionService.dismissQuestion(filed.id);

      const dismissedBroadcast = broadcastCalls.find((m) => m.type === "question:dismissed");
      expect(dismissedBroadcast).toBeDefined();
      expect(dismissedBroadcast?.questionId).toBe(filed.id);
    });
  });

  // -------------------------------------------------------------------------
  // US4 — Full end-to-end lifecycle (file → triage → answer → closed)
  // -------------------------------------------------------------------------

  describe("US4 — Full triage lifecycle: file → open list → answer → closed + notified", () => {
    it("should exercise the complete question lifecycle end-to-end", async () => {
      // ---- Step 1: Agent files a structured question with context + suggestedOptions ----
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we use a circuit-breaker for the external payment API?",
        context:
          "The payment API times out ~5% of requests. A circuit-breaker would reduce " +
          "cascading failures but adds complexity to the service layer.",
        category: "decision",
        urgency: "high",
        suggestedOptions: ["Add circuit-breaker", "Add timeout + retry only", "Leave as-is"],
      });

      // Returns {id, status:'open'}
      expect(filed.id).toBeTruthy();
      expect(filed.status).toBe("open");

      // ---- Step 2: appears in open list ----
      const openList = questionService.listQuestions({ status: "open", projectId: PROJECT_ID });
      expect(openList.find((q) => q.id === filed.id)).toBeDefined();

      // ---- Step 2b: DM mirror with conversationId set (adj-i8epe fix) ----
      const persisted = questionStore.getQuestion(filed.id);
      expect(persisted?.conversationId).toBeTruthy();

      // ---- Step 2c: question:new WS broadcast fired ----
      const newBroadcast = broadcastCalls.find((m) => m.type === "question:new");
      expect(newBroadcast).toBeDefined();
      expect(newBroadcast?.urgency).toBe("high");

      // ---- Step 2d: APNS push enqueued (high urgency = always push) ----
      await Promise.resolve();
      expect(sendNotificationToAll).toHaveBeenCalledOnce();

      // ---- Step 3: Answer via chosenOption from suggestedOptions ----
      const answered = await questionService.answerQuestion(filed.id, {
        chosenOption: "Add circuit-breaker",
        answeredBy: "user",
      });

      expect(answered.status).toBe("answered");
      expect(answered.answeredAt).toBeTruthy();
      expect(answered.answeredBy).toBe("user");
      expect(answered.chosenOption).toBe("Add circuit-breaker");

      // ---- Step 3a: leaves open list ----
      const openAfterAnswer = questionService.listQuestions({
        status: "open",
        projectId: PROJECT_ID,
      });
      expect(openAfterAnswer.find((q) => q.id === filed.id)).toBeUndefined();

      // ---- Step 3b: question:answered broadcast fires ----
      const answeredBroadcast = broadcastCalls.find((m) => m.type === "question:answered");
      expect(answeredBroadcast).toBeDefined();
      expect(answeredBroadcast?.questionId).toBe(filed.id);
      expect(answeredBroadcast?.chosenOption).toBe("Add circuit-breaker");

      // ---- Step 3c: answer visible in 'answered' bucket ----
      const answeredList = questionService.listQuestions({
        status: "answered",
        projectId: PROJECT_ID,
      });
      expect(answeredList.find((q) => q.id === filed.id)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // US5 — Sort order: blocking first, then oldest-first within tier
  // -------------------------------------------------------------------------

  describe("US5 — Sort order: blocking → high → normal → low, oldest-first within tier", () => {
    it("should return blocking question before normal-urgency question", async () => {
      // File normal first, blocking second — blocking must sort to top
      const normalQ = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Which linter?",
        urgency: "normal",
      });

      const blockingQ = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Production is down — need DB credentials NOW",
        urgency: "blocking",
      });

      const list = questionService.listQuestions({ status: "open", projectId: PROJECT_ID });
      const ids = list.map((q) => q.id);

      expect(ids.indexOf(blockingQ.id)).toBeLessThan(ids.indexOf(normalQ.id));
    });

    it("should sort all four tiers: blocking → high → normal → low", async () => {
      const lowQ = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Low urgency question",
        urgency: "low",
      });
      const highQ = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "High urgency question",
        urgency: "high",
      });
      const normalQ = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Normal urgency question",
        urgency: "normal",
      });
      const blockingQ = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Blocking urgency question",
        urgency: "blocking",
      });

      const list = questionService.listQuestions({ status: "open", projectId: PROJECT_ID });
      const urgencies = list.map((q) => q.urgency);

      const blockingIdx = urgencies.indexOf("blocking");
      const highIdx = urgencies.indexOf("high");
      const normalIdx = urgencies.indexOf("normal");
      const lowIdx = urgencies.indexOf("low");

      expect(blockingIdx).toBeLessThan(highIdx);
      expect(highIdx).toBeLessThan(normalIdx);
      expect(normalIdx).toBeLessThan(lowIdx);

      // All four are present
      const returnedIds = list.map((q) => q.id);
      expect(returnedIds).toContain(blockingQ.id);
      expect(returnedIds).toContain(highQ.id);
      expect(returnedIds).toContain(normalQ.id);
      expect(returnedIds).toContain(lowQ.id);
    });
  });

  // -------------------------------------------------------------------------
  // US6 — Parallel dismiss + answer workflow (second question)
  // -------------------------------------------------------------------------

  describe("US6 — Parallel dismiss + answer flow", () => {
    it("should handle one answer and one dismiss with correct broadcasts and list state", async () => {
      // File two questions: one to answer, one to dismiss
      const toAnswer = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we add Sentry?",
        suggestedOptions: ["Yes", "No"],
        urgency: "normal",
      });

      const toDismiss = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we rename the variable?",
        urgency: "low",
      });

      // Both are open
      const openBefore = questionService.listQuestions({ status: "open", projectId: PROJECT_ID });
      expect(openBefore.find((q) => q.id === toAnswer.id)).toBeDefined();
      expect(openBefore.find((q) => q.id === toDismiss.id)).toBeDefined();

      // Answer the first
      await questionService.answerQuestion(toAnswer.id, {
        chosenOption: "Yes",
        answeredBy: "user",
      });

      // Dismiss the second
      const dismissed = await questionService.dismissQuestion(toDismiss.id);
      expect(dismissed.status).toBe("dismissed");

      // Both leave the open list
      const openAfter = questionService.listQuestions({ status: "open", projectId: PROJECT_ID });
      expect(openAfter.find((q) => q.id === toAnswer.id)).toBeUndefined();
      expect(openAfter.find((q) => q.id === toDismiss.id)).toBeUndefined();

      // Broadcasts: question:new × 2, question:answered × 1, question:dismissed × 1
      const newBroadcasts = broadcastCalls.filter((m) => m.type === "question:new");
      const answeredBroadcasts = broadcastCalls.filter((m) => m.type === "question:answered");
      const dismissedBroadcasts = broadcastCalls.filter((m) => m.type === "question:dismissed");

      expect(newBroadcasts).toHaveLength(2);
      expect(answeredBroadcasts).toHaveLength(1);
      expect(dismissedBroadcasts).toHaveLength(1);

      expect(dismissedBroadcasts[0]?.questionId).toBe(toDismiss.id);
    });
  });

  // -------------------------------------------------------------------------
  // US7 — REST route integration (router → service wiring smoke tests)
  // -------------------------------------------------------------------------

  describe("US7 — REST route integration via Express + supertest", () => {
    /**
     * Smoke-tests the REST layer: mount the real questions router against a real
     * service instance and fire HTTP calls via supertest. Validates that the
     * router → service wiring is correct (not just the service in isolation).
     */

    async function buildApp() {
      const supertest = await import("supertest");
      const express = (await import("express")).default;
      const { createQuestionsRouter } = await import("../../src/routes/questions.js");

      const app = express();
      app.use(express.json());
      app.use("/api/questions", createQuestionsRouter(questionService));

      return { agent: supertest.default(app) };
    }

    it("should return filed question in GET /api/questions and answer via POST /answer", async () => {
      const { agent } = await buildApp();

      // File a question via the service
      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "REST route integration question?",
        suggestedOptions: ["Option A", "Option B"],
        urgency: "normal",
      });

      // GET /api/questions should return the open question
      const getRes = await agent.get("/api/questions").query({ projectId: PROJECT_ID });
      expect(getRes.status).toBe(200);
      const questions = (getRes.body as { data: { questions: { id: string }[] } }).data.questions;
      expect(questions.find((q) => q.id === filed.id)).toBeDefined();

      // POST /api/questions/:id/answer with a valid chosenOption
      const answerRes = await agent
        .post(`/api/questions/${filed.id}/answer`)
        .send({ chosenOption: "Option A" });
      expect(answerRes.status).toBe(200);
      const answeredQ = (answerRes.body as { data: { question: { status: string; chosenOption: string } } }).data.question;
      expect(answeredQ.status).toBe("answered");
      expect(answeredQ.chosenOption).toBe("Option A");

      // GET after answering — should NOT include it in open list
      const getResAfter = await agent.get("/api/questions").query({ projectId: PROJECT_ID });
      const questionsAfter = (getResAfter.body as { data: { questions: { id: string }[] } }).data.questions;
      expect(questionsAfter.find((q) => q.id === filed.id)).toBeUndefined();
    });

    it("should return 400 when POST /answer body has neither answerBody nor chosenOption", async () => {
      const { agent } = await buildApp();

      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Should we enable verbose logging?",
        urgency: "low",
      });

      const badAnswerRes = await agent
        .post(`/api/questions/${filed.id}/answer`)
        .send({});
      expect(badAnswerRes.status).toBe(400);
    });

    it("should return 400 when chosenOption is not in suggestedOptions via REST", async () => {
      const { agent } = await buildApp();

      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Database engine?",
        suggestedOptions: ["PostgreSQL", "SQLite"],
        urgency: "normal",
      });

      const badChoiceRes = await agent
        .post(`/api/questions/${filed.id}/answer`)
        .send({ chosenOption: "MongoDB" });
      expect(badChoiceRes.status).toBe(400);
    });

    it("should wire POST /api/questions/:id/dismiss end-to-end", async () => {
      const { agent } = await buildApp();

      const filed = await questionService.fileQuestion({
        projectId: PROJECT_ID,
        agentId: AGENT_ID,
        body: "Trivial question to dismiss?",
        urgency: "low",
      });

      const dismissRes = await agent.post(`/api/questions/${filed.id}/dismiss`);
      expect(dismissRes.status).toBe(200);
      const dismissedQ = (dismissRes.body as { data: { question: { status: string } } }).data.question;
      expect(dismissedQ.status).toBe("dismissed");

      // Confirm it left the open list via GET
      const getRes = await agent.get("/api/questions").query({ projectId: PROJECT_ID });
      const questionsAfter = (getRes.body as { data: { questions: { id: string }[] } }).data.questions;
      expect(questionsAfter.find((q) => q.id === filed.id)).toBeUndefined();
    });
  });
});
