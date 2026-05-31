/**
 * Tests for QuestionService — the shared orchestration layer (adj-181.3).
 *
 * The service coordinates: question-store (data), conversation-store (DM),
 * message-store (mirror), wsBroadcast (real-time), and APNS push (notifications).
 *
 * All dependencies are mocked with REAL call shapes (adj-067):
 *   - QuestionStore methods return real AgentQuestion shapes
 *   - wsBroadcast accepts a WsServerMessage-shaped argument
 *   - sendNotificationToAll accepts a real APNsNotification
 *
 * Coverage (≥3 per public method):
 *   fileQuestion: happy path, DM mirror, WS broadcast + push
 *   answerQuestion: happy path, DM mirror, WS broadcast, no push on answer
 *   dismissQuestion: happy path, WS broadcast, no push on dismiss
 *   listQuestions: pass-through, filter forwarding
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentQuestion } from "../../src/types/index.js";
import type { QuestionStore } from "../../src/services/question-store.js";
import type { ConversationStore } from "../../src/services/conversation-store.js";
import type { MessageStore } from "../../src/services/message-store.js";

// ---------------------------------------------------------------------------
// Mock dependencies (all external to the service under test)
// ---------------------------------------------------------------------------

vi.mock("../../src/services/apns-service.js", () => ({
  isAPNsConfigured: vi.fn().mockReturnValue(true),
  sendNotificationToAll: vi.fn().mockResolvedValue({ success: true, data: { sent: 1, failed: 0 } }),
}));

import { createQuestionService } from "../../src/services/question-service.js";
import { isAPNsConfigured, sendNotificationToAll } from "../../src/services/apns-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<AgentQuestion> = {}): AgentQuestion {
  return {
    id: "q-uuid-001",
    projectId: "proj-uuid-001",
    agentId: "agent-raynor",
    body: "Should we pivot the architecture?",
    urgency: "high",
    status: "open",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}

function makeQuestionStore(overrides: Partial<QuestionStore> = {}): QuestionStore {
  return {
    fileQuestion: vi.fn().mockReturnValue(makeQuestion()),
    getQuestion: vi.fn().mockReturnValue(makeQuestion()),
    answerQuestion: vi.fn().mockReturnValue(makeQuestion({ status: "answered" })),
    dismissQuestion: vi.fn().mockReturnValue(makeQuestion({ status: "dismissed" })),
    setConversationId: vi.fn(),
    listQuestions: vi.fn().mockReturnValue([makeQuestion()]),
    ...overrides,
  } as QuestionStore;
}

function makeConversationStore(): ConversationStore {
  return {
    getOrCreateDm: vi.fn().mockReturnValue({
      id: "dm_conv_abc123",
      kind: "dm",
      title: null,
      archived: false,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    }),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    listConversations: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    getMembers: vi.fn().mockReturnValue([]),
    getConversationsForMember: vi.fn(),
    createChannel: vi.fn(),
    listChannels: vi.fn(),
    joinChannel: vi.fn(),
    leaveChannel: vi.fn(),
    postToChannel: vi.fn(),
    getOrCreateDmWithMessages: vi.fn(),
    getUnreadCountsForMember: vi.fn().mockReturnValue([]),
  } as unknown as ConversationStore;
}

function makeMessageStore(): MessageStore {
  return {
    insertMessage: vi.fn().mockReturnValue({
      id: "msg-uuid-001",
      sessionId: null,
      agentId: "agent-raynor",
      recipient: "user",
      role: "agent",
      body: "Should we pivot the architecture?",
      metadata: null,
      deliveryStatus: "pending",
      eventType: null,
      threadId: null,
      conversationId: "dm_conv_abc123",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    }),
    getMessage: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getPendingForRecipient: vi.fn().mockReturnValue([]),
    markDelivered: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    searchMessages: vi.fn().mockReturnValue([]),
    getUnreadCounts: vi.fn().mockReturnValue([]),
    getUnreadSummaries: vi.fn().mockReturnValue([]),
    getThreads: vi.fn().mockReturnValue([]),
  } as MessageStore;
}

// ---------------------------------------------------------------------------
// fileQuestion
// ---------------------------------------------------------------------------

describe("QuestionService.fileQuestion", () => {
  let questionStore: QuestionStore;
  let conversationStore: ConversationStore;
  let messageStore: MessageStore;
  let wsBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    questionStore = makeQuestionStore();
    conversationStore = makeConversationStore();
    messageStore = makeMessageStore();
    wsBroadcast = vi.fn();
    vi.clearAllMocks();
    vi.mocked(isAPNsConfigured).mockReturnValue(true);
    vi.mocked(sendNotificationToAll).mockResolvedValue({
      success: true,
      data: { sent: 1, failed: 0, results: [] },
    });
  });

  it("should persist the question via questionStore and return it (happy path)", async () => {
    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    const input = {
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "Should we pivot the architecture?",
      urgency: "high" as const,
    };

    const result = await service.fileQuestion(input);

    expect(result.id).toBe("q-uuid-001");
    expect(result.status).toBe("open");
    expect(questionStore.fileQuestion).toHaveBeenCalledWith(input);
  });

  it("should mirror the question as a message into the asker's DM conversation", async () => {
    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "Should we pivot the architecture?",
    });

    expect(conversationStore.getOrCreateDm).toHaveBeenCalledWith("agent-raynor", "user");
    expect(messageStore.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-raynor",
        role: "agent",
        conversationId: "dm_conv_abc123",
      }),
    );
  });

  // adj-i8epe regression: after DM is created, conversationId must be persisted back
  // to the question row via questionStore.setConversationId. Previously the id was
  // captured but never written back, leaving agent_questions.conversation_id = NULL.

  it("adj-i8epe: should persist conversationId back to the question row after DM creation", async () => {
    // The DM gives us conversation id "dm_conv_abc123"
    const setConversationId = vi.fn();
    const storeWithSetConversationId = {
      ...questionStore,
      setConversationId,
    };

    const service = createQuestionService({
      questionStore: storeWithSetConversationId as unknown as typeof questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "Should we pivot the architecture?",
    });

    // setConversationId must have been called with the question id and the DM conv id
    expect(setConversationId).toHaveBeenCalledWith("q-uuid-001", "dm_conv_abc123");
  });

  it("should broadcast a question:new WS event after filing", async () => {
    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "Should we pivot the architecture?",
    });

    expect(wsBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "question:new" }),
    );
  });

  it("should enqueue an APNS push for blocking urgency (always pushes)", async () => {
    const blockingQuestion = makeQuestion({ urgency: "blocking" });
    vi.mocked(questionStore.fileQuestion).mockReturnValue(blockingQuestion);

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "CRITICAL: need access to prod DB",
      urgency: "blocking",
    });

    expect(sendNotificationToAll).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "AGENT_QUESTION",
        data: expect.objectContaining({
          type: "agent_question",
          questionId: "q-uuid-001",
          urgency: "blocking",
        }),
      }),
    );
  });

  it("should enqueue an APNS push for high urgency (always pushes)", async () => {
    const highQuestion = makeQuestion({ urgency: "high" });
    vi.mocked(questionStore.fileQuestion).mockReturnValue(highQuestion);

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "Need a decision on the cache layer",
      urgency: "high",
    });

    expect(sendNotificationToAll).toHaveBeenCalled();
  });

  it("should truncate the notification body to 200 chars", async () => {
    const longBody = "x".repeat(300);
    vi.mocked(questionStore.fileQuestion).mockReturnValue(makeQuestion({ body: longBody }));

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: longBody,
      urgency: "high",
    });

    const callArg = vi.mocked(sendNotificationToAll).mock.calls[0]?.[0];
    expect(callArg?.body.length).toBeLessThanOrEqual(203); // 200 chars + "..."
  });

  it("should skip APNS push for normal urgency when APNS is not configured", async () => {
    vi.mocked(isAPNsConfigured).mockReturnValue(false);
    const normalQuestion = makeQuestion({ urgency: "normal" });
    vi.mocked(questionStore.fileQuestion).mockReturnValue(normalQuestion);

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "A normal urgency question",
      urgency: "normal",
    });

    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });

  // adj-96rtr regression: normal/low must NOT push even when APNS IS configured.
  // The dead-code ternary `isAlways ? isAPNsConfigured() : isAPNsConfigured()` makes
  // both branches identical — normal/low urgency pushes when it should be suppressed.

  it("adj-96rtr: should NOT push for normal urgency even when APNS is configured", async () => {
    vi.mocked(isAPNsConfigured).mockReturnValue(true); // APNS IS configured
    const normalQuestion = makeQuestion({ urgency: "normal" });
    vi.mocked(questionStore.fileQuestion).mockReturnValue(normalQuestion);

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "A normal urgency question — should not push",
      urgency: "normal",
    });

    // normal urgency: no push even when APNS is available (no pref API yet)
    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });

  it("adj-96rtr: should NOT push for low urgency even when APNS is configured", async () => {
    vi.mocked(isAPNsConfigured).mockReturnValue(true); // APNS IS configured
    const lowQuestion = makeQuestion({ urgency: "low" });
    vi.mocked(questionStore.fileQuestion).mockReturnValue(lowQuestion);

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-raynor",
      body: "A low urgency question — should not push",
      urgency: "low",
    });

    // low urgency: no push even when APNS is available (no pref API yet)
    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// answerQuestion
// ---------------------------------------------------------------------------

describe("QuestionService.answerQuestion", () => {
  let questionStore: QuestionStore;
  let conversationStore: ConversationStore;
  let messageStore: MessageStore;
  let wsBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    questionStore = makeQuestionStore();
    conversationStore = makeConversationStore();
    messageStore = makeMessageStore();
    wsBroadcast = vi.fn();
    vi.clearAllMocks();
  });

  it("should call questionStore.answerQuestion and return the updated question", async () => {
    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    const result = await service.answerQuestion("q-uuid-001", {
      answerBody: "Use Redis.",
      answeredBy: "user",
    });

    expect(result.status).toBe("answered");
    expect(questionStore.answerQuestion).toHaveBeenCalledWith("q-uuid-001", {
      answerBody: "Use Redis.",
      answeredBy: "user",
    });
  });

  it("should post the answer into the asker's DM conversation", async () => {
    // Make getQuestion return the original question so service knows the agentId
    vi.mocked(questionStore.getQuestion).mockReturnValue(makeQuestion({ agentId: "agent-raynor" }));

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.answerQuestion("q-uuid-001", {
      answerBody: "Use Redis.",
      answeredBy: "user",
    });

    expect(conversationStore.getOrCreateDm).toHaveBeenCalledWith("agent-raynor", "user");
    expect(messageStore.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "user",
        role: "user",
        conversationId: "dm_conv_abc123",
      }),
    );
  });

  it("should broadcast a question:answered WS event", async () => {
    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.answerQuestion("q-uuid-001", {
      answerBody: "Use Redis.",
    });

    expect(wsBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "question:answered" }),
    );
  });

  it("should NOT send an APNS push on answer", async () => {
    vi.mocked(isAPNsConfigured).mockReturnValue(true);

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.answerQuestion("q-uuid-001", {
      answerBody: "Use Redis.",
    });

    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dismissQuestion
// ---------------------------------------------------------------------------

describe("QuestionService.dismissQuestion", () => {
  let questionStore: QuestionStore;
  let conversationStore: ConversationStore;
  let messageStore: MessageStore;
  let wsBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    questionStore = makeQuestionStore();
    conversationStore = makeConversationStore();
    messageStore = makeMessageStore();
    wsBroadcast = vi.fn();
    vi.clearAllMocks();
  });

  it("should call questionStore.dismissQuestion and return the dismissed question", async () => {
    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    const result = await service.dismissQuestion("q-uuid-001");

    expect(result.status).toBe("dismissed");
    expect(questionStore.dismissQuestion).toHaveBeenCalledWith("q-uuid-001");
  });

  it("should broadcast a question:dismissed WS event", async () => {
    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.dismissQuestion("q-uuid-001");

    expect(wsBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "question:dismissed" }),
    );
  });

  it("should NOT send an APNS push on dismiss", async () => {
    vi.mocked(isAPNsConfigured).mockReturnValue(true);

    const service = createQuestionService({
      questionStore,
      conversationStore,
      messageStore,
      wsBroadcast,
    });

    await service.dismissQuestion("q-uuid-001");

    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listQuestions
// ---------------------------------------------------------------------------

describe("QuestionService.listQuestions", () => {
  it("should pass filter through to the questionStore", () => {
    const questionStore = makeQuestionStore();
    const service = createQuestionService({
      questionStore,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    service.listQuestions({ status: "open", projectId: "proj-abc", urgency: "blocking" });

    expect(questionStore.listQuestions).toHaveBeenCalledWith({
      status: "open",
      projectId: "proj-abc",
      urgency: "blocking",
    });
  });

  it("should return the questions array from the store", () => {
    const questions = [makeQuestion(), makeQuestion({ id: "q-uuid-002" })];
    const questionStore = makeQuestionStore();
    vi.mocked(questionStore.listQuestions).mockReturnValue(questions);

    const service = createQuestionService({
      questionStore,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    const result = service.listQuestions({});
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("q-uuid-001");
  });

  it("should default to empty object when no filter is provided", () => {
    const questionStore = makeQuestionStore();
    const service = createQuestionService({
      questionStore,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    service.listQuestions();

    expect(questionStore.listQuestions).toHaveBeenCalledWith({});
  });
});
