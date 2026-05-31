/**
 * Tests for MCP question tools (adj-181.2).
 *
 * Tools: file_question, answer_question, list_questions.
 *
 * Key invariants under test:
 *   1. Asker identity is ALWAYS resolved server-side via getAgentBySession —
 *      never trusted from client-supplied params.
 *   2. projectId override (adj-146 pattern) works: an explicit projectId in the
 *      tool args routes to the named project, not the session's own project.
 *   3. file_question forwards body/context/category/urgency/suggestedOptions/beadId
 *      to questionService.fileQuestion with correct server-resolved agentId + projectId.
 *   4. answer_question enforces the one-of rule (answerBody OR chosenOption, at least one).
 *   5. list_questions passes filters (status/projectId/category/agentId/urgency) straight
 *      to questionService.listQuestions.
 *
 * Each tool gets ≥2 tests: success path + validation/identity error path.
 * (adj-067: mock data uses real shapes — same field names returned by the service.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Logger mock — suppress all output during tests
// ---------------------------------------------------------------------------
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Server-side identity: getAgentBySession + resolveToolProjectContext
//
// Both come from mcp-server.ts. We mock the entire module and wire up
// a controllable mock for each function.
// ---------------------------------------------------------------------------
const mockGetAgentBySession = vi.fn<[string | undefined], string | undefined>();
const mockResolveToolProjectContext = vi.fn();

vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: (sessionId: string | undefined) => mockGetAgentBySession(sessionId),
  resolveToolProjectContext: (explicitProjectId: string | undefined, sessionId: string | undefined) =>
    mockResolveToolProjectContext(explicitProjectId, sessionId),
}));

// ---------------------------------------------------------------------------
// QuestionService mock
//
// The MCP tool module delegates ALL orchestration to questionService — it must
// not duplicate DM mirroring, WS broadcast, or APNS push. We verify delegation
// via these mocks.
// ---------------------------------------------------------------------------
import type { AgentQuestion } from "../../src/types/index.js";
import type { QuestionService } from "../../src/services/question-service.js";

function makeQuestion(overrides: Partial<AgentQuestion> = {}): AgentQuestion {
  return {
    id: "q-mcp-001",
    projectId: "proj-uuid-aaa",
    agentId: "agent-raynor",
    body: "Which database should we use for caching?",
    urgency: "normal",
    status: "open",
    createdAt: "2026-05-31T10:00:00.000Z",
    updatedAt: "2026-05-31T10:00:00.000Z",
    ...overrides,
  };
}

function makeService(overrides: Partial<QuestionService> = {}): QuestionService {
  return {
    fileQuestion: vi.fn().mockResolvedValue(makeQuestion()),
    answerQuestion: vi.fn().mockResolvedValue(makeQuestion({ status: "answered" })),
    dismissQuestion: vi.fn().mockResolvedValue(makeQuestion({ status: "dismissed" })),
    listQuestions: vi.fn().mockReturnValue([makeQuestion()]),
    ...overrides,
  } as QuestionService;
}

// ---------------------------------------------------------------------------
// Tool registration helper
//
// Mirrors the pattern from mcp-channels.test.ts: build a minimal fake McpServer
// that captures handlers, then call registerQuestionTools.
// ---------------------------------------------------------------------------
type HandlerFn = (params: Record<string, unknown>, extra: { sessionId?: string }) => Promise<{ content: { type: "text"; text: string }[] }>;

async function getHandlers(service: QuestionService): Promise<Map<string, HandlerFn>> {
  const { registerQuestionTools } = await import("../../src/services/mcp-tools/questions.js");
  const handlers = new Map<string, HandlerFn>();
  const mockServer = {
    tool: (name: string, _schema: unknown, handler: HandlerFn) => {
      handlers.set(name, handler);
    },
  } as never;
  registerQuestionTools(mockServer, service);
  return handlers;
}

function parseResult(result: { content: { type: string; text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const PROJECT_CTX = {
  projectId: "proj-uuid-aaa",
  projectName: "test-project",
  projectPath: "/repo",
  beadsDir: "/repo/.beads",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: valid session resolves to "agent-raynor"
  mockGetAgentBySession.mockReturnValue("agent-raynor");
  // Default: session project context resolves to PROJECT_CTX
  mockResolveToolProjectContext.mockReturnValue(PROJECT_CTX);
});

// ============================================================================
// registerQuestionTools — registration smoke test
// ============================================================================

describe("registerQuestionTools", () => {
  it("should register the three question tools", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);
    expect(handlers.has("file_question")).toBe(true);
    expect(handlers.has("answer_question")).toBe(true);
    expect(handlers.has("list_questions")).toBe(true);
  });
});

// ============================================================================
// file_question
// ============================================================================

describe("file_question tool", () => {
  it("should resolve asker server-side and delegate to questionService.fileQuestion", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    const result = await handlers.get("file_question")!(
      {
        body: "Which database should we use for caching?",
        context: "We're evaluating Redis vs SQLite for session storage.",
        category: "decision",
        urgency: "high",
        suggestedOptions: ["Redis", "SQLite"],
        beadId: "adj-181",
      },
      { sessionId: "session-001" },
    );

    // Identity was resolved server-side
    expect(mockGetAgentBySession).toHaveBeenCalledWith("session-001");
    // projectId resolved via resolveToolProjectContext, not client-supplied
    expect(mockResolveToolProjectContext).toHaveBeenCalled();

    // Delegation: questionService.fileQuestion called with server-resolved identity
    expect(svc.fileQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-raynor",
        projectId: "proj-uuid-aaa",
        body: "Which database should we use for caching?",
        context: "We're evaluating Redis vs SQLite for session storage.",
        category: "decision",
        urgency: "high",
        suggestedOptions: ["Redis", "SQLite"],
        beadId: "adj-181",
      }),
    );

    // Response: { id, status: "open" }
    const data = parseResult(result) as { id: string; status: string };
    expect(data.id).toBe("q-mcp-001");
    expect(data.status).toBe("open");
  });

  it("should return an error when the session is unknown", async () => {
    mockGetAgentBySession.mockReturnValue(undefined);
    const svc = makeService();
    const handlers = await getHandlers(svc);

    const result = await handlers.get("file_question")!(
      { body: "What should we do?" },
      { sessionId: "ghost-session" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toMatch(/unknown session/i);
    expect(svc.fileQuestion).not.toHaveBeenCalled();
  });

  it("should return an error when no project context can be resolved", async () => {
    mockResolveToolProjectContext.mockReturnValue(undefined);
    const svc = makeService();
    const handlers = await getHandlers(svc);

    const result = await handlers.get("file_question")!(
      { body: "What should we do?" },
      { sessionId: "session-001" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBeTruthy();
    expect(svc.fileQuestion).not.toHaveBeenCalled();
  });

  it("should honour explicit projectId override (adj-146 cross-project pattern)", async () => {
    const overrideProjectId = "proj-uuid-bbb";
    const overrideCtx = { ...PROJECT_CTX, projectId: overrideProjectId };
    mockResolveToolProjectContext.mockReturnValue(overrideCtx);

    const svc = makeService({
      fileQuestion: vi.fn().mockResolvedValue(makeQuestion({ projectId: overrideProjectId })),
    });
    const handlers = await getHandlers(svc);

    await handlers.get("file_question")!(
      { body: "Override project question", projectId: overrideProjectId },
      { sessionId: "session-001" },
    );

    // resolveToolProjectContext must have been called with the explicit override id
    expect(mockResolveToolProjectContext).toHaveBeenCalledWith(overrideProjectId, "session-001");
    expect(svc.fileQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: overrideProjectId }),
    );
  });

  it("should default urgency to 'normal' when not provided", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    await handlers.get("file_question")!(
      { body: "Quick question, no urgency specified" },
      { sessionId: "session-001" },
    );

    expect(svc.fileQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ urgency: "normal" }),
    );
  });

  it("should accept action_required category for blocking tasks the General must complete", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    const result = await handlers.get("file_question")!(
      {
        body: "Please add the STRIPE_SECRET_KEY to the production .env",
        category: "action_required",
        urgency: "blocking",
        context: "Payment integration is blocked until the key is in the environment.",
      },
      { sessionId: "session-001" },
    );

    expect(svc.fileQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "action_required",
        urgency: "blocking",
      }),
    );
    const data = parseResult(result) as { id: string; status: string };
    expect(data.status).toBe("open");
  });
});

// ============================================================================
// answer_question
// ============================================================================

describe("answer_question tool", () => {
  it("should delegate to questionService.answerQuestion with answerBody", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    const result = await handlers.get("answer_question")!(
      { id: "q-mcp-001", answerBody: "Use Redis — lower latency for session data." },
      { sessionId: "session-001" },
    );

    expect(svc.answerQuestion).toHaveBeenCalledWith(
      "q-mcp-001",
      expect.objectContaining({ answerBody: "Use Redis — lower latency for session data." }),
    );

    const data = parseResult(result) as { id: string; status: string };
    expect(data.id).toBe("q-mcp-001");
    expect(data.status).toBe("answered");
  });

  it("should accept chosenOption alone as a valid answer (one-of rule)", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    const result = await handlers.get("answer_question")!(
      { id: "q-mcp-001", chosenOption: "Redis" },
      { sessionId: "session-001" },
    );

    expect(svc.answerQuestion).toHaveBeenCalledWith(
      "q-mcp-001",
      expect.objectContaining({ chosenOption: "Redis" }),
    );

    const data = parseResult(result) as { status: string };
    expect(data.status).toBe("answered");
  });

  it("should return an error when both answerBody and chosenOption are absent (one-of rule)", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    const result = await handlers.get("answer_question")!(
      { id: "q-mcp-001" },
      { sessionId: "session-001" },
    );

    const data = parseResult(result) as { error: string };
    expect(data.error).toBeTruthy();
    // Service must NOT have been called — validation should reject before delegating
    expect(svc.answerQuestion).not.toHaveBeenCalled();
  });

  it("should accept both answerBody and chosenOption together (both provided)", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    await handlers.get("answer_question")!(
      {
        id: "q-mcp-001",
        chosenOption: "Redis",
        answerBody: "Redis is better for this use case.",
      },
      { sessionId: "session-001" },
    );

    expect(svc.answerQuestion).toHaveBeenCalledWith(
      "q-mcp-001",
      expect.objectContaining({
        chosenOption: "Redis",
        answerBody: "Redis is better for this use case.",
      }),
    );
  });

  it("should honour explicit projectId override when answering", async () => {
    const overrideCtx = { ...PROJECT_CTX, projectId: "proj-uuid-bbb" };
    mockResolveToolProjectContext.mockReturnValue(overrideCtx);
    const svc = makeService();
    const handlers = await getHandlers(svc);

    await handlers.get("answer_question")!(
      { id: "q-mcp-001", answerBody: "Done.", projectId: "proj-uuid-bbb" },
      { sessionId: "session-001" },
    );

    expect(mockResolveToolProjectContext).toHaveBeenCalledWith("proj-uuid-bbb", "session-001");
    expect(svc.answerQuestion).toHaveBeenCalled();
  });
});

// ============================================================================
// list_questions
// ============================================================================

describe("list_questions tool", () => {
  it("should return questions via questionService.listQuestions with no filters", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    const result = await handlers.get("list_questions")!(
      {},
      { sessionId: "session-001" },
    );

    expect(svc.listQuestions).toHaveBeenCalledWith(expect.objectContaining({}));

    const data = parseResult(result) as { questions: AgentQuestion[] };
    expect(Array.isArray(data.questions)).toBe(true);
    expect(data.questions).toHaveLength(1);
    expect(data.questions[0].id).toBe("q-mcp-001");
  });

  it("should pass status/category/agentId/urgency filters to questionService.listQuestions", async () => {
    const svc = makeService();
    const handlers = await getHandlers(svc);

    await handlers.get("list_questions")!(
      {
        status: "open",
        category: "decision",
        agentId: "agent-raynor",
        urgency: "high",
      },
      { sessionId: "session-001" },
    );

    expect(svc.listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "open",
        category: "decision",
        agentId: "agent-raynor",
        urgency: "high",
      }),
    );
  });

  it("should honour explicit projectId override for cross-project listing", async () => {
    const overrideCtx = { ...PROJECT_CTX, projectId: "proj-uuid-bbb" };
    mockResolveToolProjectContext.mockReturnValue(overrideCtx);
    const svc = makeService();
    const handlers = await getHandlers(svc);

    await handlers.get("list_questions")!(
      { projectId: "proj-uuid-bbb" },
      { sessionId: "session-001" },
    );

    expect(mockResolveToolProjectContext).toHaveBeenCalledWith("proj-uuid-bbb", "session-001");
    expect(svc.listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-uuid-bbb" }),
    );
  });

  it("should return an empty list when no questions match", async () => {
    const svc = makeService({ listQuestions: vi.fn().mockReturnValue([]) });
    const handlers = await getHandlers(svc);

    const result = await handlers.get("list_questions")!(
      { status: "answered" },
      { sessionId: "session-001" },
    );

    const data = parseResult(result) as { questions: unknown[] };
    expect(data.questions).toEqual([]);
  });
});
