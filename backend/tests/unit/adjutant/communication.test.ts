import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MessageStore } from "../../../src/services/message-store.js";

vi.mock("../../../src/services/ws-server.js", () => ({
  wsBroadcast: vi.fn(),
}));

vi.mock("../../../src/services/apns-service.js", () => ({
  isAPNsConfigured: vi.fn(),
  sendNotificationToAll: vi.fn(),
}));

import { wsBroadcast } from "../../../src/services/ws-server.js";
import {
  isAPNsConfigured,
  sendNotificationToAll,
} from "../../../src/services/apns-service.js";
import { createCommunicationManager } from "../../../src/services/adjutant/communication.js";

function createMockStore(): MessageStore {
  return {
    insertMessage: vi.fn((input) => ({
      id: "msg-1",
      agentId: input.agentId,
      recipient: input.recipient ?? null,
      role: input.role,
      body: input.body,
      sessionId: null,
      metadata: null,
      deliveryStatus: "pending" as const,
      eventType: null,
      threadId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })),
    getMessage: vi.fn(),
    getMessages: vi.fn(),
    getPendingForRecipient: vi.fn(),
    markDelivered: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    searchMessages: vi.fn(),
    getUnreadCounts: vi.fn(),
    getUnreadSummaries: vi.fn(),
    getThreads: vi.fn(),
  };
}

describe("CommunicationManager", () => {
  let store: MessageStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createMockStore();
  });

  describe("queueRoutine", () => {
    it("should add message to internal queue", () => {
      const cm = createCommunicationManager(store);
      cm.queueRoutine("test message");
      expect(cm.getRoutineQueueLength()).toBe(1);
    });

    it("should accumulate multiple messages", () => {
      const cm = createCommunicationManager(store);
      cm.queueRoutine("message 1");
      cm.queueRoutine("message 2");
      cm.queueRoutine("message 3");
      expect(cm.getRoutineQueueLength()).toBe(3);
    });
  });

  describe("flushRoutineQueue", () => {
    it("should return all queued messages and clear queue", () => {
      const cm = createCommunicationManager(store);
      cm.queueRoutine("msg a");
      cm.queueRoutine("msg b");

      const flushed = cm.flushRoutineQueue();
      expect(flushed).toEqual(["msg a", "msg b"]);
      expect(cm.getRoutineQueueLength()).toBe(0);
    });

    it("should return empty array when no messages queued", () => {
      const cm = createCommunicationManager(store);
      const flushed = cm.flushRoutineQueue();
      expect(flushed).toEqual([]);
    });
  });

  describe("getRoutineQueueLength", () => {
    it("should return correct count", () => {
      const cm = createCommunicationManager(store);
      expect(cm.getRoutineQueueLength()).toBe(0);
      cm.queueRoutine("one");
      expect(cm.getRoutineQueueLength()).toBe(1);
      cm.queueRoutine("two");
      expect(cm.getRoutineQueueLength()).toBe(2);
    });
  });

  describe("sendImportant", () => {
    it("should insert message via store with correct params", async () => {
      const cm = createCommunicationManager(store);
      await cm.sendImportant("important update");

      expect(store.insertMessage).toHaveBeenCalledWith({
        agentId: "adjutant-core",
        recipient: "user",
        role: "agent",
        body: "important update",
      });
    });

    it("should broadcast via wsBroadcast", async () => {
      const cm = createCommunicationManager(store);
      await cm.sendImportant("broadcast me");

      expect(wsBroadcast).toHaveBeenCalledWith({
        type: "chat_message",
        id: "msg-1",
        from: "adjutant-core",
        to: "user",
        body: "broadcast me",
        timestamp: "2026-01-01T00:00:00Z",
      });
    });
  });

  describe("escalate", () => {
    it("should insert message via store", async () => {
      vi.mocked(isAPNsConfigured).mockReturnValue(false);
      const cm = createCommunicationManager(store);
      await cm.escalate("urgent issue");

      expect(store.insertMessage).toHaveBeenCalledWith({
        agentId: "adjutant-core",
        recipient: "user",
        role: "agent",
        body: "urgent issue",
      });
    });

    it("should broadcast via wsBroadcast", async () => {
      vi.mocked(isAPNsConfigured).mockReturnValue(false);
      const cm = createCommunicationManager(store);
      await cm.escalate("urgent broadcast");

      expect(wsBroadcast).toHaveBeenCalledWith({
        type: "chat_message",
        id: "msg-1",
        from: "adjutant-core",
        to: "user",
        body: "urgent broadcast",
        timestamp: "2026-01-01T00:00:00Z",
      });
    });

    it("should send APNS when configured", async () => {
      vi.mocked(isAPNsConfigured).mockReturnValue(true);
      vi.mocked(sendNotificationToAll).mockResolvedValue({
        success: true,
        data: { sent: 1, failed: 0, results: [] },
      });

      const cm = createCommunicationManager(store);
      await cm.escalate("push this");

      expect(sendNotificationToAll).toHaveBeenCalledWith({
        title: "Adjutant Alert",
        body: "push this",
        sound: "default",
        category: "ADJUTANT_ESCALATION",
        threadId: "adjutant",
        data: { type: "adjutant_escalation", messageId: "msg-1" },
      });
    });

    it("should not send APNS when not configured", async () => {
      vi.mocked(isAPNsConfigured).mockReturnValue(false);

      const cm = createCommunicationManager(store);
      await cm.escalate("no push");

      expect(sendNotificationToAll).not.toHaveBeenCalled();
    });

    it("should truncate APNS body to 200 chars but store full message", async () => {
      vi.mocked(isAPNsConfigured).mockReturnValue(true);
      vi.mocked(sendNotificationToAll).mockResolvedValue({
        success: true,
        data: { sent: 1, failed: 0, results: [] },
      });

      const longMessage = "A".repeat(250);
      const expectedTruncated = "A".repeat(197) + "...";

      const cm = createCommunicationManager(store);
      await cm.escalate(longMessage);

      // Full message should be stored in the message store (not truncated)
      expect(store.insertMessage).toHaveBeenCalledWith({
        agentId: "adjutant-core",
        recipient: "user",
        role: "agent",
        body: longMessage,
      });

      // APNS notification body should be truncated to exactly 200 chars
      expect(sendNotificationToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expectedTruncated,
        }),
      );
      expect(expectedTruncated).toHaveLength(200);
    });

    it("should handle APNS error gracefully", async () => {
      vi.mocked(isAPNsConfigured).mockReturnValue(true);
      vi.mocked(sendNotificationToAll).mockRejectedValue(
        new Error("APNS failed")
      );

      const cm = createCommunicationManager(store);
      // Should not throw
      await expect(cm.escalate("error push")).resolves.toBeUndefined();
    });
  });

  describe("messageAgent", () => {
    it("should insert message with correct recipient", async () => {
      const cm = createCommunicationManager(store);
      await cm.messageAgent("agent-007", "hello agent");

      expect(store.insertMessage).toHaveBeenCalledWith({
        agentId: "adjutant-core",
        recipient: "agent-007",
        role: "agent",
        body: "hello agent",
      });
    });

    it("should broadcast to correct agent", async () => {
      const cm = createCommunicationManager(store);
      await cm.messageAgent("agent-007", "agent broadcast");

      expect(wsBroadcast).toHaveBeenCalledWith({
        type: "chat_message",
        id: "msg-1",
        from: "adjutant-core",
        to: "agent-007",
        body: "agent broadcast",
        timestamp: "2026-01-01T00:00:00Z",
      });
    });
  });
});
