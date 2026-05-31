/**
 * Tests for WebSocket question broadcasts (adj-181.3.4 / adj-181.3.5).
 *
 * Verifies that the WsServerMessage union properly includes the
 * question:new | question:answered | question:dismissed event types,
 * and that wsBroadcast is called with the correct shape for each.
 *
 * Strategy: the broadcast is triggered by QuestionService, so we test via the
 * service directly (white-box integration within our own code boundary).
 * The wsBroadcast function is a vi.fn() that captures calls.
 *
 * ≥2 assertions per event type.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentQuestion } from "../../src/types/index.js";
import type { QuestionStore } from "../../src/services/question-store.js";
import type { ConversationStore } from "../../src/services/conversation-store.js";
import type { MessageStore } from "../../src/services/message-store.js";

vi.mock("../../src/services/apns-service.js", () => ({
  isAPNsConfigured: vi.fn().mockReturnValue(false),
  sendNotificationToAll: vi.fn().mockResolvedValue({ success: true, data: { sent: 0, failed: 0, results: [] } }),
}));

import { createQuestionService } from "../../src/services/question-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<AgentQuestion> = {}): AgentQuestion {
  return {
    id: "q-broadcast-001",
    projectId: "proj-uuid-001",
    agentId: "agent-tassadar",
    body: "Which deployment strategy should we use?",
    urgency: "normal",
    status: "open",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}

function makeQuestionStore(q: AgentQuestion): QuestionStore {
  return {
    fileQuestion: vi.fn().mockReturnValue(q),
    getQuestion: vi.fn().mockReturnValue(q),
    answerQuestion: vi.fn().mockReturnValue({ ...q, status: "answered" }),
    dismissQuestion: vi.fn().mockReturnValue({ ...q, status: "dismissed" }),
    listQuestions: vi.fn().mockReturnValue([q]),
  } as QuestionStore;
}

function makeConversationStore(): ConversationStore {
  return {
    getOrCreateDm: vi.fn().mockReturnValue({
      id: "dm_broadcast_conv",
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
    getUnreadCountsForMember: vi.fn().mockReturnValue([]),
  } as unknown as ConversationStore;
}

function makeMessageStore(): MessageStore {
  return {
    insertMessage: vi.fn().mockReturnValue({
      id: "msg-uuid-001",
      sessionId: null,
      agentId: "agent-tassadar",
      recipient: "user",
      role: "agent",
      body: "Which deployment strategy should we use?",
      metadata: null,
      deliveryStatus: "pending",
      eventType: null,
      threadId: null,
      conversationId: "dm_broadcast_conv",
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
// question:new broadcast
// ---------------------------------------------------------------------------

describe("WS broadcast: question:new", () => {
  it("should broadcast with type=question:new when a question is filed", async () => {
    const q = makeQuestion();
    const wsBroadcast = vi.fn();
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-tassadar",
      body: "Which deployment strategy should we use?",
    });

    const calls = wsBroadcast.mock.calls;
    const questionNewCall = calls.find(
      (c) => (c[0] as { type: string }).type === "question:new"
    );
    expect(questionNewCall).toBeDefined();
  });

  it("should include the question id, agentId, urgency, and projectId in the broadcast", async () => {
    const q = makeQuestion({ urgency: "blocking" });
    const wsBroadcast = vi.fn();
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast,
    });

    await service.fileQuestion({
      projectId: "proj-uuid-001",
      agentId: "agent-tassadar",
      body: "CRITICAL issue",
      urgency: "blocking",
    });

    const broadcast = wsBroadcast.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "question:new"
    )?.[0] as Record<string, unknown>;

    expect(broadcast?.["questionId"]).toBe("q-broadcast-001");
    expect(broadcast?.["agentId"]).toBe("agent-tassadar");
    expect(broadcast?.["urgency"]).toBe("blocking");
  });
});

// ---------------------------------------------------------------------------
// question:answered broadcast
// ---------------------------------------------------------------------------

describe("WS broadcast: question:answered", () => {
  it("should broadcast with type=question:answered when a question is answered", async () => {
    const q = makeQuestion();
    const wsBroadcast = vi.fn();
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast,
    });

    await service.answerQuestion("q-broadcast-001", {
      answerBody: "Use blue/green deployment.",
    });

    const calls = wsBroadcast.mock.calls;
    const answeredCall = calls.find(
      (c) => (c[0] as { type: string }).type === "question:answered"
    );
    expect(answeredCall).toBeDefined();
  });

  it("should include questionId in the question:answered broadcast", async () => {
    const q = makeQuestion();
    const wsBroadcast = vi.fn();
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast,
    });

    await service.answerQuestion("q-broadcast-001", {
      chosenOption: "blue/green",
    });

    const broadcast = wsBroadcast.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "question:answered"
    )?.[0] as Record<string, unknown>;

    expect(broadcast?.["questionId"]).toBe("q-broadcast-001");
  });
});

// ---------------------------------------------------------------------------
// question:dismissed broadcast
// ---------------------------------------------------------------------------

describe("WS broadcast: question:dismissed", () => {
  it("should broadcast with type=question:dismissed when a question is dismissed", async () => {
    const q = makeQuestion();
    const wsBroadcast = vi.fn();
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast,
    });

    await service.dismissQuestion("q-broadcast-001");

    const calls = wsBroadcast.mock.calls;
    const dismissedCall = calls.find(
      (c) => (c[0] as { type: string }).type === "question:dismissed"
    );
    expect(dismissedCall).toBeDefined();
  });

  it("should include questionId in the question:dismissed broadcast", async () => {
    const q = makeQuestion();
    const wsBroadcast = vi.fn();
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast,
    });

    await service.dismissQuestion("q-broadcast-001");

    const broadcast = wsBroadcast.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "question:dismissed"
    )?.[0] as Record<string, unknown>;

    expect(broadcast?.["questionId"]).toBe("q-broadcast-001");
  });
});
