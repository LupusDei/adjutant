/**
 * Tests for APNS push on question:new (adj-181.3.6 / adj-181.3.7).
 *
 * Verifies that:
 *   - blocking urgency always enqueues a push (even if APNS is configured)
 *   - high urgency always enqueues a push
 *   - normal/low urgency respect configuration (skip if not configured)
 *   - the push payload carries asker, urgency, truncated body, and deep-link data
 *   - no push is sent on answer or dismiss
 *
 * The APNS sender (`sendNotificationToAll`) is mocked with its REAL call
 * signature from apns-service.ts (adj-067: mock shape must match reality).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentQuestion } from "../../src/types/index.js";
import type { QuestionStore } from "../../src/services/question-store.js";
import type { ConversationStore } from "../../src/services/conversation-store.js";
import type { MessageStore } from "../../src/services/message-store.js";

// ---------------------------------------------------------------------------
// Mock APNS with real call signatures from apns-service.ts
// ---------------------------------------------------------------------------

vi.mock("../../src/services/apns-service.js", () => ({
  isAPNsConfigured: vi.fn(),
  sendNotificationToAll: vi.fn(),
}));

import { createQuestionService } from "../../src/services/question-service.js";
import { isAPNsConfigured, sendNotificationToAll } from "../../src/services/apns-service.js";
import type { APNsNotification } from "../../src/types/apns.js";

// ---------------------------------------------------------------------------
// Helpers — real-shaped mocks (adj-067)
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<AgentQuestion> = {}): AgentQuestion {
  return {
    id: "q-push-001",
    projectId: "proj-push-001",
    agentId: "agent-zeratul",
    body: "Need access to the production database credentials",
    urgency: "blocking",
    status: "open",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}

// Real sendNotificationToAll return shape:
// APNsServiceResult<{ sent: number; failed: number; results: PushNotificationResult[] }>
const PUSH_SUCCESS_RESULT = {
  success: true as const,
  data: { sent: 1, failed: 0, results: [{ success: true, deviceToken: "abc123" }] },
};
const PUSH_NO_RESULT = {
  success: true as const,
  data: { sent: 0, failed: 0, results: [] },
};

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
      id: "dm_push_conv",
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
      id: "msg-push-001",
      sessionId: null,
      agentId: "agent-zeratul",
      recipient: "user",
      role: "agent",
      body: "Need access to the production database credentials",
      metadata: null,
      deliveryStatus: "pending",
      eventType: null,
      threadId: null,
      conversationId: "dm_push_conv",
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
// Urgency-gated push behaviour
// ---------------------------------------------------------------------------

describe("APNS push: blocking urgency always pushes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAPNsConfigured).mockReturnValue(true);
    vi.mocked(sendNotificationToAll).mockResolvedValue(PUSH_SUCCESS_RESULT);
  });

  it("should call sendNotificationToAll when urgency=blocking", async () => {
    const q = makeQuestion({ urgency: "blocking" });
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.fileQuestion({
      projectId: "proj-push-001",
      agentId: "agent-zeratul",
      body: "Need prod DB access",
      urgency: "blocking",
    });

    expect(sendNotificationToAll).toHaveBeenCalledOnce();
  });

  it("should call sendNotificationToAll when urgency=high", async () => {
    const q = makeQuestion({ urgency: "high" });
    vi.mocked(makeQuestionStore(q).fileQuestion).mockReturnValue(q);

    const qs = makeQuestionStore(q);
    vi.mocked(qs.fileQuestion).mockReturnValue(q);

    const service = createQuestionService({
      questionStore: qs,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.fileQuestion({
      projectId: "proj-push-001",
      agentId: "agent-zeratul",
      body: "High urgency issue",
      urgency: "high",
    });

    expect(sendNotificationToAll).toHaveBeenCalledOnce();
  });
});

describe("APNS push: normal/low urgency skip when APNS not configured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAPNsConfigured).mockReturnValue(false);
    vi.mocked(sendNotificationToAll).mockResolvedValue(PUSH_NO_RESULT);
  });

  it("should NOT call sendNotificationToAll when urgency=normal and APNS not configured", async () => {
    const q = makeQuestion({ urgency: "normal" });
    const qs = makeQuestionStore(q);

    const service = createQuestionService({
      questionStore: qs,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.fileQuestion({
      projectId: "proj-push-001",
      agentId: "agent-zeratul",
      body: "Normal urgency question",
      urgency: "normal",
    });

    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });

  it("should NOT call sendNotificationToAll when urgency=low and APNS not configured", async () => {
    const q = makeQuestion({ urgency: "low" });
    const qs = makeQuestionStore(q);

    const service = createQuestionService({
      questionStore: qs,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.fileQuestion({
      projectId: "proj-push-001",
      agentId: "agent-zeratul",
      body: "Low urgency question",
      urgency: "low",
    });

    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Push payload shape
// ---------------------------------------------------------------------------

describe("APNS push: payload shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAPNsConfigured).mockReturnValue(true);
    vi.mocked(sendNotificationToAll).mockResolvedValue(PUSH_SUCCESS_RESULT);
  });

  it("should send the correct payload structure with real APNsNotification shape", async () => {
    const q = makeQuestion({ urgency: "blocking", agentId: "agent-zeratul" });
    const qs = makeQuestionStore(q);

    const service = createQuestionService({
      questionStore: qs,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.fileQuestion({
      projectId: "proj-push-001",
      agentId: "agent-zeratul",
      body: "Need prod DB access",
      urgency: "blocking",
    });

     
    const notification = vi.mocked(sendNotificationToAll).mock.calls[0]![0];
    // title and body are required by APNsNotification
    expect(typeof notification.title).toBe("string");
    expect(notification.title.length).toBeGreaterThan(0);
    expect(typeof notification.body).toBe("string");
    expect(notification.body.length).toBeGreaterThan(0);
    // category distinguishes the notification type for iOS UNUserNotificationCenter
    expect(notification.category).toBe("AGENT_QUESTION");
    // data.type drives the deep-link in AppDelegate
    const data = notification.data!;
    // data.type drives the deep-link in AppDelegate
    expect(data["type"]).toBe("agent_question");
    // questionId for deep-link navigation
    expect(data["questionId"]).toBe("q-push-001");
    // urgency so iOS can colour/sort the notification
    expect(data["urgency"]).toBe("blocking");
  });

  it("should truncate the body to ≤200 chars with ellipsis in the push payload", async () => {
    const longBody = "A".repeat(300);
    const q = makeQuestion({ body: longBody, urgency: "high" });
    const qs = makeQuestionStore(q);

    const service = createQuestionService({
      questionStore: qs,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.fileQuestion({
      projectId: "proj-push-001",
      agentId: "agent-zeratul",
      body: longBody,
      urgency: "high",
    });

     
    const notification = vi.mocked(sendNotificationToAll).mock.calls[0]![0];
    // Body in notification must be truncated — "...".length = 3, so total ≤ 203
    expect(notification.body.length).toBeLessThanOrEqual(203);
    expect(notification.body.endsWith("...")).toBe(true);
  });

  it("should include the asker agentId in the notification title", async () => {
    const q = makeQuestion({ urgency: "blocking", agentId: "agent-zeratul" });
    const qs = makeQuestionStore(q);

    const service = createQuestionService({
      questionStore: qs,
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.fileQuestion({
      projectId: "proj-push-001",
      agentId: "agent-zeratul",
      body: "Question body",
      urgency: "blocking",
    });

     
    const notification = vi.mocked(sendNotificationToAll).mock.calls[0]![0];
    expect(notification.title).toContain("agent-zeratul");
  });
});

// ---------------------------------------------------------------------------
// No push on answer / dismiss
// ---------------------------------------------------------------------------

describe("APNS push: no push on answer or dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAPNsConfigured).mockReturnValue(true);
    vi.mocked(sendNotificationToAll).mockResolvedValue(PUSH_SUCCESS_RESULT);
  });

  it("should NOT send a push notification when a question is answered", async () => {
    const q = makeQuestion({ urgency: "blocking" });
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.answerQuestion("q-push-001", { answerBody: "Done." });

    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });

  it("should NOT send a push notification when a question is dismissed", async () => {
    const q = makeQuestion({ urgency: "blocking" });
    const service = createQuestionService({
      questionStore: makeQuestionStore(q),
      conversationStore: makeConversationStore(),
      messageStore: makeMessageStore(),
      wsBroadcast: vi.fn(),
    });

    await service.dismissQuestion("q-push-001");

    expect(sendNotificationToAll).not.toHaveBeenCalled();
  });
});
