import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MailTransport } from "../../src/services/transport/mail-transport.js";
import type { Message } from "../../src/types/index.js";

// Create a mock transport that all tests share
const mockTransport: MailTransport = {
  name: "mock",
  listMail: vi.fn(),
  getMessage: vi.fn(),
  sendMessage: vi.fn(),
  markRead: vi.fn(),
  getSenderIdentity: vi.fn(() => "overseer"),
};

vi.mock("../../src/services/transport/index.js", () => ({
  getTransport: vi.fn(() => mockTransport),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
  })),
}));

import { getMessage, listMail, markRead, sendMail } from "../../src/services/mail-service.js";

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-001",
    from: "mayor/",
    to: "overseer",
    subject: "Test Subject",
    body: "Test body",
    timestamp: "2026-01-11T12:00:00Z",
    read: false,
    priority: 2,
    type: "task",
    threadId: "thread-001",
    ...overrides,
  };
}

describe("mail-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockTransport.getSenderIdentity).mockReturnValue("overseer");
  });

  describe("listMail", () => {
    it("returns messages sorted by newest first", async () => {
      const older = createMessage({ id: "msg-001", timestamp: "2026-01-10T12:00:00Z" });
      const newer = createMessage({ id: "msg-002", timestamp: "2026-01-11T12:00:00Z" });
      vi.mocked(mockTransport.listMail).mockResolvedValue({
        success: true,
        data: [newer, older],
      });

      const result = await listMail();

      expect(result.success).toBe(true);
      expect(result.data?.[0].id).toBe("msg-002");
      expect(result.data?.[1].id).toBe("msg-001");
    });

    it("returns error when list fails", async () => {
      vi.mocked(mockTransport.listMail).mockResolvedValue({
        success: false,
        error: { code: "LIST_MAIL_ERROR", message: "bd failure" },
      });

      const result = await listMail();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("LIST_MAIL_ERROR");
    });

    it("returns both received and sent messages for chat view", async () => {
      const received = createMessage({
        id: "msg-received",
        from: "mayor/",
        to: "overseer",
        timestamp: "2026-01-10T12:00:00Z",
      });
      const sent = createMessage({
        id: "msg-sent",
        from: "overseer",
        to: "mayor/",
        timestamp: "2026-01-11T12:00:00Z",
      });
      vi.mocked(mockTransport.listMail).mockResolvedValue({
        success: true,
        data: [sent, received],
      });

      const result = await listMail();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      const ids = result.data?.map((m) => m.id);
      expect(ids).toContain("msg-received");
      expect(ids).toContain("msg-sent");
    });
  });

  describe("getMessage", () => {
    it("returns a message by ID", async () => {
      vi.mocked(mockTransport.getMessage).mockResolvedValue({
        success: true,
        data: createMessage({ id: "msg-123" }),
      });

      const result = await getMessage("msg-123");

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("msg-123");
    });

    it("returns NOT_FOUND when message missing", async () => {
      vi.mocked(mockTransport.getMessage).mockResolvedValue({
        success: false,
        error: { code: "NOT_FOUND", message: "not found" },
      });

      const result = await getMessage("msg-999");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });
  });

  describe("sendMail", () => {
    it("sends a message with priority and type", async () => {
      vi.mocked(mockTransport.sendMessage).mockResolvedValue({
        success: true,
        data: { messageId: "new-msg-001" },
      });

      const result = await sendMail({
        subject: "Hello",
        body: "Body",
        to: "mayor/",
        type: "task",
        priority: 1,
      });

      expect(result.success).toBe(true);
      expect(mockTransport.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "mayor/",
          from: "overseer",
          subject: "Hello",
          body: "Body",
          priority: 1,
          type: "task",
        })
      );
    });

    it("passes includeReplyInstructions to transport", async () => {
      vi.mocked(mockTransport.sendMessage).mockResolvedValue({
        success: true,
        data: { messageId: "new-msg-002" },
      });

      const result = await sendMail({
        subject: "Quick message",
        body: "Please check the convoy status",
        to: "mayor/",
        type: "task",
        includeReplyInstructions: true,
      });

      expect(result.success).toBe(true);
      expect(mockTransport.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Quick message",
          body: "Please check the convoy status",
          includeReplyInstructions: true,
        })
      );
    });
  });

  describe("markRead", () => {
    it("marks a message as read", async () => {
      vi.mocked(mockTransport.markRead).mockResolvedValue({
        success: true,
      });

      const result = await markRead("msg-001");

      expect(result.success).toBe(true);
      expect(mockTransport.markRead).toHaveBeenCalledWith("msg-001");
    });
  });
});
