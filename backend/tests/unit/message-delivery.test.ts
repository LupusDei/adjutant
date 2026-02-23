import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../../src/services/event-bus.js", () => {
  const handlers = new Map<string, Function>();
  return {
    getEventBus: () => ({
      on: (event: string, handler: Function) => { handlers.set(event, handler); },
      emit: (event: string, data: unknown) => { handlers.get(event)?.(data); },
    }),
    _handlers: handlers,
  };
});

vi.mock("../../src/services/session-bridge.js", () => {
  const mockBridge = {
    registry: {
      findByName: vi.fn(() => []),
    },
    sendInput: vi.fn(async () => true),
  };
  return {
    getSessionBridge: () => mockBridge,
    _mockBridge: mockBridge,
  };
});

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

describe("message-delivery", () => {
  let store: any;
  let mockBridge: any;
  let handlers: Map<string, Function>;

  beforeEach(async () => {
    vi.resetModules();

    const eventBusMod = await import("../../src/services/event-bus.js") as any;
    handlers = eventBusMod._handlers;
    handlers.clear();

    const bridgeMod = await import("../../src/services/session-bridge.js") as any;
    mockBridge = bridgeMod._mockBridge;
    mockBridge.registry.findByName.mockReset();
    mockBridge.sendInput.mockReset();

    store = {
      getPendingForRecipient: vi.fn(() => []),
      markDelivered: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should register listener on mcp:agent_connected", async () => {
    const { initMessageDelivery } = await import("../../src/services/message-delivery.js");
    initMessageDelivery(store);

    expect(handlers.has("mcp:agent_connected")).toBe(true);
  });

  it("should deliver pending messages when agent connects", async () => {
    const { initMessageDelivery } = await import("../../src/services/message-delivery.js");
    initMessageDelivery(store);

    store.getPendingForRecipient.mockReturnValue([
      { id: "msg-1", body: "Hello agent", deliveryStatus: "pending" },
      { id: "msg-2", body: "Second message", deliveryStatus: "pending" },
    ]);

    mockBridge.registry.findByName.mockReturnValue([
      { id: "session-1", status: "idle" },
    ]);
    mockBridge.sendInput.mockResolvedValue(true);

    const handler = handlers.get("mcp:agent_connected")!;
    await handler({ agentId: "test-agent", sessionId: "mcp-session-1" });

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(store.getPendingForRecipient).toHaveBeenCalledWith("test-agent");
    expect(mockBridge.sendInput).toHaveBeenCalledTimes(2);
    expect(mockBridge.sendInput).toHaveBeenCalledWith("session-1", "Hello agent");
    expect(mockBridge.sendInput).toHaveBeenCalledWith("session-1", "Second message");
    expect(store.markDelivered).toHaveBeenCalledWith("msg-1");
    expect(store.markDelivered).toHaveBeenCalledWith("msg-2");
  });

  it("should not mark delivered when sendInput fails", async () => {
    const { initMessageDelivery } = await import("../../src/services/message-delivery.js");
    initMessageDelivery(store);

    store.getPendingForRecipient.mockReturnValue([
      { id: "msg-1", body: "Hello", deliveryStatus: "pending" },
    ]);

    mockBridge.registry.findByName.mockReturnValue([
      { id: "session-1", status: "idle" },
    ]);
    mockBridge.sendInput.mockResolvedValue(false);

    const handler = handlers.get("mcp:agent_connected")!;
    await handler({ agentId: "test-agent", sessionId: "mcp-session-1" });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockBridge.sendInput).toHaveBeenCalledTimes(1);
    expect(store.markDelivered).not.toHaveBeenCalled();
  });

  it("should skip delivery when no sessions found", async () => {
    const { initMessageDelivery } = await import("../../src/services/message-delivery.js");
    initMessageDelivery(store);

    store.getPendingForRecipient.mockReturnValue([
      { id: "msg-1", body: "Hello", deliveryStatus: "pending" },
    ]);

    mockBridge.registry.findByName.mockReturnValue([]);

    const handler = handlers.get("mcp:agent_connected")!;
    await handler({ agentId: "test-agent", sessionId: "mcp-session-1" });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockBridge.sendInput).not.toHaveBeenCalled();
    expect(store.markDelivered).not.toHaveBeenCalled();
  });

  it("should try next session when first fails", async () => {
    const { initMessageDelivery } = await import("../../src/services/message-delivery.js");
    initMessageDelivery(store);

    store.getPendingForRecipient.mockReturnValue([
      { id: "msg-1", body: "Hello", deliveryStatus: "pending" },
    ]);

    mockBridge.registry.findByName.mockReturnValue([
      { id: "session-1", status: "offline" },
      { id: "session-2", status: "idle" },
    ]);
    mockBridge.sendInput
      .mockResolvedValueOnce(false)   // session-1 fails (offline)
      .mockResolvedValueOnce(true);   // session-2 succeeds

    const handler = handlers.get("mcp:agent_connected")!;
    await handler({ agentId: "test-agent", sessionId: "mcp-session-1" });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockBridge.sendInput).toHaveBeenCalledTimes(2);
    expect(mockBridge.sendInput).toHaveBeenCalledWith("session-1", "Hello");
    expect(mockBridge.sendInput).toHaveBeenCalledWith("session-2", "Hello");
    expect(store.markDelivered).toHaveBeenCalledWith("msg-1");
  });

  it("should do nothing when no pending messages exist", async () => {
    const { initMessageDelivery } = await import("../../src/services/message-delivery.js");
    initMessageDelivery(store);

    store.getPendingForRecipient.mockReturnValue([]);

    const handler = handlers.get("mcp:agent_connected")!;
    await handler({ agentId: "test-agent", sessionId: "mcp-session-1" });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockBridge.sendInput).not.toHaveBeenCalled();
  });
});
