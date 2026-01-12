import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMail } from "../../../src/hooks/useMail";
import { api } from "../../../src/services/api";
import type { Message, SendMessageRequest } from "../../../src/types";

// Mock the API module
vi.mock("../../../src/services/api", () => ({
  api: {
    mail: {
      list: vi.fn(),
      get: vi.fn(),
      send: vi.fn(),
      markRead: vi.fn(),
    },
  },
}));

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    from: "mayor/",
    to: "operator",
    subject: "Test Subject",
    body: "Test body content",
    timestamp: "2026-01-11T10:00:00Z",
    read: false,
    priority: 2,
    type: "notification",
    threadId: "thread-1",
    pinned: false,
    ...overrides,
  };
}

function createMockMessageList(count: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    createMockMessage({
      id: `msg-${i + 1}`,
      subject: `Subject ${i + 1}`,
      read: i % 2 === 0, // alternate read/unread
    })
  );
}

// =============================================================================
// Tests
// =============================================================================

describe("useMail", () => {
  const mockList = api.mail.list as ReturnType<typeof vi.fn>;
  const mockGet = api.mail.get as ReturnType<typeof vi.fn>;
  const mockSend = api.mail.send as ReturnType<typeof vi.fn>;
  const mockMarkRead = api.mail.markRead as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // Initial State & Fetching
  // ===========================================================================

  describe("initial state and fetching", () => {
    it("should fetch messages immediately on mount", async () => {
      const mockMessages = createMockMessageList(3);
      mockList.mockResolvedValue({
        items: mockMessages,
        total: 3,
        hasMore: false,
      });

      const { result } = renderHook(() => useMail());

      expect(result.current.loading).toBe(true);
      expect(mockList).toHaveBeenCalledTimes(1);

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.messages).toEqual(mockMessages);
      expect(result.current.error).toBeNull();
    });

    it("should start with empty messages array", () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });

      const { result } = renderHook(() => useMail());

      // Before fetch resolves, messages should be empty
      expect(result.current.messages).toEqual([]);
    });

    it("should expose total count and hasMore from paginated response", async () => {
      mockList.mockResolvedValue({
        items: createMockMessageList(10),
        total: 25,
        hasMore: true,
      });

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.total).toBe(25);
      expect(result.current.hasMore).toBe(true);
    });

    it("should handle empty inbox", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.messages).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.hasMore).toBe(false);
    });
  });

  // ===========================================================================
  // Polling Behavior
  // ===========================================================================

  describe("polling", () => {
    it("should poll for new messages at specified interval", async () => {
      const mockMessages = createMockMessageList(2);
      mockList.mockResolvedValue({
        items: mockMessages,
        total: 2,
        hasMore: false,
      });

      const pollInterval = 10000; // 10 seconds
      const { result } = renderHook(() => useMail({ pollInterval }));

      // Wait for initial fetch
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.loading).toBe(false);
      expect(mockList).toHaveBeenCalledTimes(1);

      // Advance to first poll
      await act(async () => {
        vi.advanceTimersByTime(pollInterval);
        await Promise.resolve();
      });

      expect(mockList).toHaveBeenCalledTimes(2);

      // Advance to second poll
      await act(async () => {
        vi.advanceTimersByTime(pollInterval);
        await Promise.resolve();
      });

      expect(mockList).toHaveBeenCalledTimes(3);
    });

    it("should use default poll interval of 30 seconds", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });

      renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockList).toHaveBeenCalledTimes(1);

      // Advance by less than default (30s)
      vi.advanceTimersByTime(25000);
      expect(mockList).toHaveBeenCalledTimes(1);

      // Advance past default interval
      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });

      expect(mockList).toHaveBeenCalledTimes(2);
    });

    it("should stop polling when enabled is false", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });

      renderHook(() => useMail({ enabled: false }));

      expect(mockList).not.toHaveBeenCalled();

      // Advance timers - should still not fetch
      vi.advanceTimersByTime(60000);
      expect(mockList).not.toHaveBeenCalled();
    });

    it("should cleanup polling on unmount", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });

      const { unmount } = renderHook(() => useMail({ pollInterval: 5000 }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockList).toHaveBeenCalledTimes(1);

      unmount();

      // Advance timers after unmount
      vi.advanceTimersByTime(30000);

      expect(mockList).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Manual Refresh
  // ===========================================================================

  describe("manual refresh", () => {
    it("should allow manual refresh", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockList).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockList).toHaveBeenCalledTimes(2);
    });

    it("should update messages on refresh", async () => {
      const initialMessages = createMockMessageList(2);
      const updatedMessages = createMockMessageList(3);

      mockList
        .mockResolvedValueOnce({
          items: initialMessages,
          total: 2,
          hasMore: false,
        })
        .mockResolvedValueOnce({
          items: updatedMessages,
          total: 3,
          hasMore: false,
        });

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.messages).toEqual(initialMessages);

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.messages).toEqual(updatedMessages);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("should handle fetch errors", async () => {
      const error = new Error("Network error");
      mockList.mockRejectedValue(error);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve(); // Extra tick for catch block
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(result.current.error).toEqual(error);
    });

    it("should clear error on successful fetch", async () => {
      const error = new Error("Temporary error");
      mockList
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ items: [], total: 0, hasMore: false });

      const { result } = renderHook(() => useMail({ pollInterval: 1000 }));

      // Wait for first fetch (error)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.error).toEqual(error);

      // Trigger next poll
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(result.current.error).toBeNull();
    });

    it("should preserve existing messages on fetch error", async () => {
      const messages = createMockMessageList(3);
      mockList
        .mockResolvedValueOnce({ items: messages, total: 3, hasMore: false })
        .mockRejectedValueOnce(new Error("Fetch failed"));

      const { result } = renderHook(() => useMail({ pollInterval: 1000 }));

      // Wait for successful initial fetch
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.messages).toEqual(messages);

      // Trigger failed poll
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
      });

      // Messages should be preserved despite error
      expect(result.current.messages).toEqual(messages);
      expect(result.current.error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Sending Messages
  // ===========================================================================

  describe("sendMessage", () => {
    it("should send a message successfully", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });
      mockSend.mockResolvedValue({ messageId: "new-msg-1" });

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      const request: SendMessageRequest = {
        subject: "Hello Mayor",
        body: "This is a test message",
      };

      await act(async () => {
        await result.current.sendMessage(request);
      });

      expect(mockSend).toHaveBeenCalledWith(request);
    });

    it("should set sending state during send operation", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });

      // Create a deferred promise to control timing
      let resolveSend: (value: { messageId: string }) => void = () => {};
      mockSend.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSend = resolve;
          })
      );

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.sending).toBe(false);

      // Start send but don't await
      let sendPromise: Promise<void>;
      act(() => {
        sendPromise = result.current.sendMessage({
          subject: "Test",
          body: "Test body",
        });
      });

      // Should be sending now
      expect(result.current.sending).toBe(true);

      // Resolve the send
      await act(async () => {
        resolveSend({ messageId: "new-msg" });
        await sendPromise;
      });

      expect(result.current.sending).toBe(false);
    });

    it("should refresh messages after successful send", async () => {
      const initialMessages = createMockMessageList(1);
      const updatedMessages = createMockMessageList(2);

      mockList
        .mockResolvedValueOnce({
          items: initialMessages,
          total: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce({
          items: updatedMessages,
          total: 2,
          hasMore: false,
        });
      mockSend.mockResolvedValue({ messageId: "new-msg" });

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.messages).toEqual(initialMessages);
      expect(mockList).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.sendMessage({
          subject: "Test",
          body: "Body",
        });
      });

      // Should have triggered a refresh
      expect(mockList).toHaveBeenCalledTimes(2);
      expect(result.current.messages).toEqual(updatedMessages);
    });

    it("should handle send errors", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });
      const sendError = new Error("Failed to send");
      mockSend.mockRejectedValue(sendError);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      // Handle error inside act to ensure state updates are flushed
      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.sendMessage({
            subject: "Test",
            body: "Body",
          });
        } catch (e) {
          caughtError = e as Error;
        }
        // Allow React to flush state updates
        await Promise.resolve();
      });

      expect(caughtError?.message).toBe("Failed to send");
      expect(result.current.sendError).toEqual(sendError);
      expect(result.current.sending).toBe(false);
    });

    it("should clear send error on successful send", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });
      const sendError = new Error("First attempt failed");
      mockSend
        .mockRejectedValueOnce(sendError)
        .mockResolvedValueOnce({ messageId: "new-msg" });

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      // First send fails - handle error inside act to ensure state updates are flushed
      await act(async () => {
        try {
          await result.current.sendMessage({ subject: "Test", body: "Body" });
        } catch {
          // Expected to throw
        }
        await Promise.resolve();
      });

      expect(result.current.sendError).toEqual(sendError);

      // Second send succeeds
      await act(async () => {
        await result.current.sendMessage({ subject: "Test 2", body: "Body 2" });
      });

      expect(result.current.sendError).toBeNull();
    });
  });

  // ===========================================================================
  // Mark as Read
  // ===========================================================================

  describe("markAsRead", () => {
    it("should mark a message as read", async () => {
      const messages = [
        createMockMessage({ id: "msg-1", read: false }),
        createMockMessage({ id: "msg-2", read: false }),
      ];
      mockList.mockResolvedValue({ items: messages, total: 2, hasMore: false });
      mockMarkRead.mockResolvedValue(undefined);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.markAsRead("msg-1");
      });

      expect(mockMarkRead).toHaveBeenCalledWith("msg-1");
    });

    it("should optimistically update message read status", async () => {
      const messages = [
        createMockMessage({ id: "msg-1", read: false }),
        createMockMessage({ id: "msg-2", read: false }),
      ];
      mockList.mockResolvedValue({ items: messages, total: 2, hasMore: false });

      // Delay the markRead response
      let resolveMarkRead: () => void = () => {};
      mockMarkRead.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveMarkRead = resolve;
          })
      );

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.messages[0]?.read).toBe(false);

      // Start marking as read
      let markPromise: Promise<void>;
      act(() => {
        markPromise = result.current.markAsRead("msg-1");
      });

      // Should be optimistically updated immediately
      expect(result.current.messages[0]?.read).toBe(true);

      await act(async () => {
        resolveMarkRead();
        await markPromise;
      });

      expect(result.current.messages[0]?.read).toBe(true);
    });

    it("should revert optimistic update on error", async () => {
      const messages = [createMockMessage({ id: "msg-1", read: false })];
      mockList.mockResolvedValue({ items: messages, total: 1, hasMore: false });
      mockMarkRead.mockRejectedValue(new Error("Failed to mark as read"));

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.messages[0]?.read).toBe(false);

      await expect(
        act(async () => {
          await result.current.markAsRead("msg-1");
        })
      ).rejects.toThrow("Failed to mark as read");

      // Should revert to original state
      expect(result.current.messages[0]?.read).toBe(false);
    });

    it("should not fail if message not found", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });
      mockMarkRead.mockResolvedValue(undefined);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      // Should not throw
      await act(async () => {
        await result.current.markAsRead("nonexistent-msg");
      });

      // Still calls API (server might have the message)
      expect(mockMarkRead).toHaveBeenCalledWith("nonexistent-msg");
    });
  });

  // ===========================================================================
  // Selected Message
  // ===========================================================================

  describe("selectMessage", () => {
    it("should select and fetch full message details", async () => {
      const listMessages = [
        createMockMessage({ id: "msg-1", body: "Preview..." }),
      ];
      const fullMessage = createMockMessage({
        id: "msg-1",
        body: "Full message content here",
      });

      mockList.mockResolvedValue({
        items: listMessages,
        total: 1,
        hasMore: false,
      });
      mockGet.mockResolvedValue(fullMessage);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.selectedMessage).toBeNull();

      await act(async () => {
        await result.current.selectMessage("msg-1");
      });

      expect(mockGet).toHaveBeenCalledWith("msg-1");
      expect(result.current.selectedMessage).toEqual(fullMessage);
    });

    it("should set loading state while fetching selected message", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });

      let resolveGet: (value: Message) => void = () => {};
      mockGet.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          })
      );

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.selectedLoading).toBe(false);

      let selectPromise: Promise<void>;
      act(() => {
        selectPromise = result.current.selectMessage("msg-1");
      });

      expect(result.current.selectedLoading).toBe(true);

      await act(async () => {
        resolveGet(createMockMessage({ id: "msg-1" }));
        await selectPromise;
      });

      expect(result.current.selectedLoading).toBe(false);
    });

    it("should clear selection with clearSelection", async () => {
      const fullMessage = createMockMessage({ id: "msg-1" });
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });
      mockGet.mockResolvedValue(fullMessage);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.selectMessage("msg-1");
      });
      expect(result.current.selectedMessage).toEqual(fullMessage);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedMessage).toBeNull();
    });

    it("should handle select error", async () => {
      mockList.mockResolvedValue({ items: [], total: 0, hasMore: false });
      const selectError = new Error("Message not found");
      mockGet.mockRejectedValue(selectError);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      // Handle error inside act to ensure state updates are flushed
      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.selectMessage("msg-1");
        } catch (e) {
          caughtError = e as Error;
        }
        await Promise.resolve();
      });

      expect(caughtError?.message).toBe("Message not found");
      expect(result.current.selectedMessage).toBeNull();
      expect(result.current.selectedError).toEqual(selectError);
    });

    it("should mark message as read when selected", async () => {
      const messages = [createMockMessage({ id: "msg-1", read: false })];
      const fullMessage = createMockMessage({ id: "msg-1", read: true });

      mockList.mockResolvedValue({ items: messages, total: 1, hasMore: false });
      mockGet.mockResolvedValue(fullMessage);
      mockMarkRead.mockResolvedValue(undefined);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.selectMessage("msg-1");
      });

      // Should automatically mark as read when selecting
      expect(mockMarkRead).toHaveBeenCalledWith("msg-1");
    });

    it("should not mark already-read messages", async () => {
      const messages = [createMockMessage({ id: "msg-1", read: true })];
      const fullMessage = createMockMessage({ id: "msg-1", read: true });

      mockList.mockResolvedValue({ items: messages, total: 1, hasMore: false });
      mockGet.mockResolvedValue(fullMessage);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.selectMessage("msg-1");
      });

      expect(mockMarkRead).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Unread Count
  // ===========================================================================

  describe("unread count", () => {
    it("should calculate unread count from messages", async () => {
      const messages = [
        createMockMessage({ id: "msg-1", read: false }),
        createMockMessage({ id: "msg-2", read: true }),
        createMockMessage({ id: "msg-3", read: false }),
        createMockMessage({ id: "msg-4", read: true }),
      ];
      mockList.mockResolvedValue({ items: messages, total: 4, hasMore: false });

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.unreadCount).toBe(2);
    });

    it("should update unread count when message marked as read", async () => {
      const messages = [
        createMockMessage({ id: "msg-1", read: false }),
        createMockMessage({ id: "msg-2", read: false }),
      ];
      mockList.mockResolvedValue({ items: messages, total: 2, hasMore: false });
      mockMarkRead.mockResolvedValue(undefined);

      const { result } = renderHook(() => useMail());

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.unreadCount).toBe(2);

      await act(async () => {
        await result.current.markAsRead("msg-1");
      });

      expect(result.current.unreadCount).toBe(1);
    });
  });
});
