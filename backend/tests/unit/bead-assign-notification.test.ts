import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MessageStore } from "../../src/services/message-store.js";
import { getEventBus, resetEventBus } from "../../src/services/event-bus.js";

// Mock session bridge
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: vi.fn(),
}));

// Mock wsBroadcast
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: vi.fn(),
}));

import { initBeadAssignNotification } from "../../src/services/bead-assign-notification.js";
import { getSessionBridge } from "../../src/services/session-bridge.js";
import { wsBroadcast } from "../../src/services/ws-server.js";

function createMockStore(): MessageStore {
  return {
    insertMessage: vi.fn().mockReturnValue({
      id: "msg-001",
      agentId: "user",
      recipient: "raynor",
      role: "user",
      body: "test",
      createdAt: "2026-02-23T00:00:00Z",
      threadId: null,
      metadata: null,
    }),
    getMessage: vi.fn(),
    getMessages: vi.fn(),
    getThreads: vi.fn(),
    getUnreadCounts: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    markDelivered: vi.fn(),
    getPendingForRecipient: vi.fn(),
    searchMessages: vi.fn(),
    getAgentConversationSummary: vi.fn(),
  } as unknown as MessageStore;
}

describe("bead-assign-notification", () => {
  let store: MessageStore;

  beforeEach(() => {
    resetEventBus();
    store = createMockStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetEventBus();
  });

  it("should send a message when bead:updated has an assignee", () => {
    initBeadAssignNotification(store);

    getEventBus().emit("bead:updated", {
      id: "adj-001",
      status: "in_progress",
      title: "Test bead",
      updatedAt: "2026-02-23T00:00:00Z",
      assignee: "raynor",
    });

    expect(store.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "user",
        recipient: "raynor",
        role: "user",
        body: expect.stringContaining("adj-001"),
      })
    );
  });

  it("should broadcast via WebSocket after inserting message", () => {
    initBeadAssignNotification(store);

    getEventBus().emit("bead:updated", {
      id: "adj-001",
      status: "in_progress",
      title: "Test bead",
      updatedAt: "2026-02-23T00:00:00Z",
      assignee: "raynor",
    });

    expect(wsBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chat_message",
        from: "user",
        to: "raynor",
      })
    );
  });

  it("should NOT send a message when bead:updated has no assignee", () => {
    initBeadAssignNotification(store);

    getEventBus().emit("bead:updated", {
      id: "adj-001",
      status: "in_progress",
      title: "Test bead",
      updatedAt: "2026-02-23T00:00:00Z",
    });

    expect(store.insertMessage).not.toHaveBeenCalled();
    expect(wsBroadcast).not.toHaveBeenCalled();
  });

  it("should attempt to deliver to agent tmux pane", () => {
    const mockSendInput = vi.fn().mockResolvedValue(true);
    const mockBridge = {
      registry: {
        findByName: vi.fn().mockReturnValue([{ id: "session-1" }]),
      },
      sendInput: mockSendInput,
    };
    vi.mocked(getSessionBridge).mockReturnValue(mockBridge as any);

    initBeadAssignNotification(store);

    getEventBus().emit("bead:updated", {
      id: "adj-002",
      status: "open",
      title: "Another bead",
      updatedAt: "2026-02-23T00:00:00Z",
      assignee: "zeratul",
    });

    expect(mockBridge.registry.findByName).toHaveBeenCalledWith("zeratul");
  });

  it("should include bead ID in the notification message body", () => {
    initBeadAssignNotification(store);

    getEventBus().emit("bead:updated", {
      id: "hq-xyz123",
      status: "open",
      title: "Fix the thing",
      updatedAt: "2026-02-23T00:00:00Z",
      assignee: "artanis",
    });

    const call = vi.mocked(store.insertMessage).mock.calls[0]![0] as any;
    expect(call.body).toContain("hq-xyz123");
    expect(call.body).toContain("assigned");
  });

  it("should gracefully handle session bridge not initialized", () => {
    vi.mocked(getSessionBridge).mockImplementation(() => {
      throw new Error("Not initialized");
    });

    initBeadAssignNotification(store);

    // Should not throw
    expect(() => {
      getEventBus().emit("bead:updated", {
        id: "adj-001",
        status: "open",
        title: "Test",
        updatedAt: "2026-02-23T00:00:00Z",
        assignee: "nova",
      });
    }).not.toThrow();

    // Message should still be inserted
    expect(store.insertMessage).toHaveBeenCalled();
  });

  it("should mark message as delivered on successful tmux send", async () => {
    const mockSendInput = vi.fn().mockResolvedValue(true);
    const mockBridge = {
      registry: {
        findByName: vi.fn().mockReturnValue([{ id: "session-1" }]),
      },
      sendInput: mockSendInput,
    };
    vi.mocked(getSessionBridge).mockReturnValue(mockBridge as any);

    initBeadAssignNotification(store);

    getEventBus().emit("bead:updated", {
      id: "adj-003",
      status: "open",
      title: "Task",
      updatedAt: "2026-02-23T00:00:00Z",
      assignee: "kerrigan",
    });

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(store.markDelivered).toHaveBeenCalledWith("msg-001");
  });
});
