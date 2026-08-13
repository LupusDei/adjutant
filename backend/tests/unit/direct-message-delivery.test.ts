/**
 * Tests for deliverDirectMessage (adj-202.4.1).
 *
 * The single, shared "send a DM to an agent (or the user) and deliver it into the
 * recipient's live session" implementation. Both the user→agent REST route and the
 * avatar's send_message command tool call THIS — no second impl (Rules 4+9). It
 * reuses the same MessageStore + wsBroadcast + session bridge the rest of the system
 * uses; here we mock those collaborators and assert the persist/broadcast/deliver
 * sequence and the returned envelope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWsBroadcast = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: (...args: unknown[]) => mockWsBroadcast(...args),
}));

const mockGetSessionBridge = vi.fn();
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: (...args: unknown[]) => mockGetSessionBridge(...args),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const mockDeliverImageAttachments = vi.fn();
vi.mock("../../src/services/attachment-delivery-service.js", () => ({
  deliverImageAttachments: (...args: unknown[]) => mockDeliverImageAttachments(...args),
}));

import { deliverDirectMessage, deliverDirectMessageAwaited } from "../../src/services/direct-message-delivery.js";

function fakeStore(overrides: Record<string, unknown> = {}) {
  return {
    insertMessage: vi.fn((input: Record<string, unknown>) => ({
      id: "msg-1",
      createdAt: "2026-06-27T20:00:00.000Z",
      body: input["body"],
      threadId: input["threadId"] ?? null,
      conversationId: input["conversationId"] ?? null,
      metadata: input["metadata"] ?? null,
    })),
    markDelivered: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no live sessions for the recipient.
  mockGetSessionBridge.mockReturnValue({
    registry: { findByName: vi.fn(() => []) },
    sendInput: vi.fn(),
  });
  mockDeliverImageAttachments.mockResolvedValue({ injected: false, sessionsDelivered: 0 });
});

describe("deliverDirectMessage", () => {
  it("persists the message with the deterministic DM conversation id and returns the envelope", () => {
    const store = fakeStore();
    const res = deliverDirectMessage(
      { store },
      { from: "adjutant", to: "kerrigan", body: "check the auth epic", role: "agent" },
    );

    expect(store.insertMessage).toHaveBeenCalledTimes(1);
    const insertArg = store.insertMessage.mock.calls[0]![0];
    expect(insertArg).toMatchObject({
      agentId: "adjutant",
      recipient: "kerrigan",
      role: "agent",
      body: "check the auth epic",
    });
    expect(insertArg.conversationId).toMatch(/^dm_/);
    expect(res).toMatchObject({ messageId: "msg-1", conversationId: insertArg.conversationId, deliveredToSessions: 0 });
  });

  it("broadcasts a chat_message attributed to the sender", () => {
    const store = fakeStore();
    deliverDirectMessage({ store }, { from: "adjutant", to: "kerrigan", body: "go", role: "agent" });

    expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
    expect(mockWsBroadcast.mock.calls[0]![0]).toMatchObject({
      type: "chat_message",
      from: "adjutant",
      to: "kerrigan",
      body: "go",
    });
  });

  it("injects into each live recipient session and marks delivered, counting them", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A" }, { id: "sess-B" }]) },
      sendInput,
    });
    const store = fakeStore();

    const res = deliverDirectMessage(
      { store },
      { from: "adjutant", to: "kerrigan", body: "go", role: "agent", deliveryText: "[directive] go" },
    );

    expect(res.deliveredToSessions).toBe(2);
    expect(sendInput).toHaveBeenCalledWith("sess-A", "[directive] go");
    expect(sendInput).toHaveBeenCalledWith("sess-B", "[directive] go");
    // markDelivered fires after the async sendInput resolves.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.markDelivered).toHaveBeenCalledWith("msg-1");
  });

  it("defaults the injected text to the body when no deliveryText is given", () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A" }]) },
      sendInput,
    });
    deliverDirectMessage({ store: fakeStore() }, { from: "user", to: "kerrigan", body: "raw body", role: "user" });
    expect(sendInput).toHaveBeenCalledWith("sess-A", "raw body");
  });

  it("emits a message_sent timeline event only when emitEvent + an eventStore are supplied", () => {
    const eventStore = { insertEvent: vi.fn() };
    deliverDirectMessage(
      { store: fakeStore(), eventStore },
      { from: "adjutant", to: "kerrigan", body: "go", role: "agent", emitEvent: true },
    );
    expect(eventStore.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "message_sent", agentId: "adjutant" }));
  });

  it("does NOT emit an event by default (preserves the user→agent route behaviour)", () => {
    const eventStore = { insertEvent: vi.fn() };
    deliverDirectMessage({ store: fakeStore(), eventStore }, { from: "user", to: "kerrigan", body: "go", role: "user" });
    expect(eventStore.insertEvent).not.toHaveBeenCalled();
  });

  it("survives an uninitialized session bridge (recipient pulls via MCP)", () => {
    mockGetSessionBridge.mockImplementation(() => {
      throw new Error("bridge not ready");
    });
    const store = fakeStore();
    const res = deliverDirectMessage({ store }, { from: "adjutant", to: "kerrigan", body: "go", role: "agent" });
    expect(res.deliveredToSessions).toBe(0);
    expect(store.insertMessage).toHaveBeenCalledTimes(1); // still persisted + broadcast
    expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // The sync export's count means "a live session EXISTS", not "the text
  // arrived". That is a documented property of the fire-and-forget path, and
  // both existing callers depend on it (they answer an HTTP/tool call without
  // blocking on tmux I/O). Pin it, so the awaited sibling added in syl-j8fa.1
  // cannot be "fixed" into this function by accident.
  // ==========================================================================
  it("keeps counting sessions FOUND, not injections that succeeded (unchanged sync behaviour)", async () => {
    const sendInput = vi.fn().mockResolvedValue(false);
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A" }, { id: "sess-B" }]) },
      sendInput,
    });
    const store = fakeStore();

    const res = deliverDirectMessage({ store }, { from: "adjutant", to: "kerrigan", body: "go", role: "agent" });

    expect(res.deliveredToSessions).toBe(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.markDelivered).not.toHaveBeenCalled();
  });
});

// ============================================================================
// deliverDirectMessageAwaited (syl-j8fa.1)
//
// Same persist + broadcast + event core, but the injection leg is AWAITED and
// the returned deliveredToSessions counts only the sends that actually
// resolved true. A zero therefore means "nobody received it" — which is the
// only number an MCP tool can honestly report back to a model.
// ============================================================================
describe("deliverDirectMessageAwaited", () => {
  it("returns the number of injections that actually succeeded", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A" }, { id: "sess-B" }]) },
      sendInput,
    });
    const store = fakeStore();

    const res = await deliverDirectMessageAwaited(
      { store },
      { from: "syl", to: "kerrigan", body: "go", role: "agent", deliveryText: "[dm] go" },
    );

    expect(res.deliveredToSessions).toBe(2);
    expect(sendInput).toHaveBeenCalledWith("sess-A", "[dm] go");
    expect(sendInput).toHaveBeenCalledWith("sess-B", "[dm] go");
    expect(store.markDelivered).toHaveBeenCalledWith("msg-1");
  });

  // THE test. A registry hit is not an arrival.
  it("reports 0 and does NOT mark delivered when a session exists but sendInput resolves false", async () => {
    const sendInput = vi.fn().mockResolvedValue(false);
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A" }]) },
      sendInput,
    });
    const store = fakeStore();

    const res = await deliverDirectMessageAwaited({ store }, { from: "syl", to: "kerrigan", body: "go", role: "agent" });

    expect(sendInput).toHaveBeenCalledTimes(1); // it really tried
    expect(res.deliveredToSessions).toBe(0);
    expect(store.markDelivered).not.toHaveBeenCalled();
  });

  it("counts only the successful sends when some succeed and some fail", async () => {
    const sendInput = vi.fn(async (id: string) => id === "sess-A");
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A" }, { id: "sess-B" }]) },
      sendInput,
    });
    const store = fakeStore();

    const res = await deliverDirectMessageAwaited({ store }, { from: "syl", to: "kerrigan", body: "go", role: "agent" });

    expect(res.deliveredToSessions).toBe(1);
    expect(store.markDelivered).toHaveBeenCalledTimes(1);
  });

  it("reports 0 without throwing when the recipient has no live session, and still persists", async () => {
    const store = fakeStore();

    const res = await deliverDirectMessageAwaited({ store }, { from: "syl", to: "nobody", body: "go", role: "agent" });

    expect(res.deliveredToSessions).toBe(0);
    expect(res.messageId).toBe("msg-1");
    expect(store.insertMessage).toHaveBeenCalledTimes(1);
    expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
    expect(store.markDelivered).not.toHaveBeenCalled();
  });

  it("reports 0 without throwing when sendInput rejects", async () => {
    const sendInput = vi.fn().mockRejectedValue(new Error("tmux pane is gone"));
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A" }]) },
      sendInput,
    });
    const store = fakeStore();

    const res = await deliverDirectMessageAwaited({ store }, { from: "syl", to: "kerrigan", body: "go", role: "agent" });

    expect(res.deliveredToSessions).toBe(0);
    expect(store.markDelivered).not.toHaveBeenCalled();
  });

  it("reports 0 without throwing when the session bridge is uninitialized, and still persists", async () => {
    mockGetSessionBridge.mockImplementation(() => {
      throw new Error("bridge not ready");
    });
    const store = fakeStore();

    const res = await deliverDirectMessageAwaited({ store }, { from: "syl", to: "kerrigan", body: "go", role: "agent" });

    expect(res.deliveredToSessions).toBe(0);
    expect(store.insertMessage).toHaveBeenCalledTimes(1);
    expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
  });

  it("persists with the deterministic DM conversation id and returns the same envelope shape", async () => {
    const store = fakeStore();
    const res = await deliverDirectMessageAwaited(
      { store },
      { from: "syl", to: "kerrigan", body: "check the auth epic", role: "agent", threadId: "t-9", metadata: { k: 1 } },
    );

    const insertArg = store.insertMessage.mock.calls[0]![0];
    expect(insertArg).toMatchObject({
      agentId: "syl",
      recipient: "kerrigan",
      role: "agent",
      body: "check the auth epic",
      threadId: "t-9",
      metadata: { k: 1 },
    });
    expect(insertArg.conversationId).toMatch(/^dm_/);
    expect(res).toMatchObject({
      messageId: "msg-1",
      timestamp: "2026-06-27T20:00:00.000Z",
      conversationId: insertArg.conversationId,
      deliveredToSessions: 0,
    });
  });

  it("emits a message_sent timeline event only when emitEvent + an eventStore are supplied", async () => {
    const eventStore = { insertEvent: vi.fn() };
    await deliverDirectMessageAwaited(
      { store: fakeStore(), eventStore },
      { from: "syl", to: "kerrigan", body: "go", role: "agent", emitEvent: true },
    );
    expect(eventStore.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "message_sent", agentId: "syl" }),
    );

    const quiet = { insertEvent: vi.fn() };
    await deliverDirectMessageAwaited({ store: fakeStore(), eventStore: quiet }, { from: "syl", to: "kerrigan", body: "go", role: "agent" });
    expect(quiet.insertEvent).not.toHaveBeenCalled();
  });

  it("awaits the image-attachment leg and reports the sessions it actually delivered to", async () => {
    const store = fakeStore({
      insertMessage: vi.fn(() => ({
        id: "msg-1",
        createdAt: "2026-06-27T20:00:00.000Z",
        body: "look at this",
        threadId: null,
        conversationId: "dm_x",
        metadata: null,
        attachments: [{ id: "att-1", kind: "image" }],
      })),
    });
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A", status: "idle" }]) },
      inputRouter: {},
      sendInput: vi.fn(),
    });
    mockDeliverImageAttachments.mockResolvedValue({ injected: true, sessionsDelivered: 1 });

    const res = await deliverDirectMessageAwaited(
      { store },
      { from: "syl", to: "kerrigan", body: "look at this", role: "agent" },
    );

    expect(mockDeliverImageAttachments).toHaveBeenCalledTimes(1);
    expect(res.deliveredToSessions).toBe(1);
    expect(store.markDelivered).toHaveBeenCalledWith("msg-1");
  });

  it("reports 0 when the image-attachment leg reaches no session", async () => {
    const store = fakeStore({
      insertMessage: vi.fn(() => ({
        id: "msg-1",
        createdAt: "2026-06-27T20:00:00.000Z",
        body: "look at this",
        threadId: null,
        conversationId: "dm_x",
        metadata: null,
        attachments: [{ id: "att-1", kind: "image" }],
      })),
    });
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A", status: "idle" }]) },
      inputRouter: {},
      sendInput: vi.fn(),
    });
    mockDeliverImageAttachments.mockResolvedValue({ injected: false, sessionsDelivered: 0 });

    const res = await deliverDirectMessageAwaited(
      { store },
      { from: "syl", to: "kerrigan", body: "look at this", role: "agent" },
    );

    expect(res.deliveredToSessions).toBe(0);
    expect(store.markDelivered).not.toHaveBeenCalled();
  });
});
