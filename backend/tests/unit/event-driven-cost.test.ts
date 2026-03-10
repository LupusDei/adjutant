/**
 * Tests for event-driven cost/context extraction (adj-066.5).
 *
 * Covers:
 * - adj-066.5.4: AgentStatusEvent extended fields in EventMap
 * - adj-066.5.2: set_status emits agent:status_changed on EventBus
 * - adj-066.5.1: extractCostOnce one-shot cost extraction
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Task 1 (adj-066.5.4): AgentStatusEvent extended fields
// ============================================================================

describe("AgentStatusEvent type (adj-066.5.4)", () => {
  it("should accept events with agentId, beadId, and task fields", async () => {
    const { getEventBus, resetEventBus } = await vi.importActual<
      typeof import("../../src/services/event-bus.js")
    >("../../src/services/event-bus.js");
    resetEventBus();
    const bus = getEventBus();
    const handler = vi.fn();

    bus.on("agent:status_changed", handler);
    bus.emit("agent:status_changed", {
      agent: "engineer-7",
      status: "working",
      agentId: "engineer-7",
      beadId: "adj-066.5.4",
      task: "Adding event type",
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "engineer-7",
        agentId: "engineer-7",
        beadId: "adj-066.5.4",
        task: "Adding event type",
      }),
      expect.any(Number),
    );
    resetEventBus();
  });

  it("should remain backward compatible with old-style events (agent + activity)", async () => {
    const { getEventBus, resetEventBus } = await vi.importActual<
      typeof import("../../src/services/event-bus.js")
    >("../../src/services/event-bus.js");
    resetEventBus();
    const bus = getEventBus();
    const handler = vi.fn();

    bus.on("agent:status_changed", handler);
    bus.emit("agent:status_changed", {
      agent: "onyx",
      status: "idle",
      activity: "resting",
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "onyx", status: "idle", activity: "resting" }),
      expect.any(Number),
    );
    resetEventBus();
  });
});

// ============================================================================
// Task 2 (adj-066.5.2): set_status emits agent:status_changed on EventBus
// ============================================================================

// Mock logger
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock event-bus with spy
const { mockBus } = vi.hoisted(() => {
  const mockBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  return { mockBus };
});

vi.mock("../../src/services/event-bus.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/services/event-bus.js")>();
  return {
    ...original,
    getEventBus: vi.fn(() => mockBus),
  };
});

// Mock ws-server
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: vi.fn(),
}));

// Mock mcp-server
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: vi.fn((sessionId: string) =>
    sessionId === "sess-123" ? "engineer-7" : undefined,
  ),
  getProjectContextBySession: vi.fn(() => undefined),
}));

// Mock session-bridge
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: vi.fn(() => ({
    isInitialized: false,
    listSessions: vi.fn(() => []),
    updateSessionStatus: vi.fn(),
  })),
}));

// Mock apns-service
vi.mock("../../src/services/apns-service.js", () => ({
  isAPNsConfigured: vi.fn(() => false),
  sendNotificationToAll: vi.fn(),
}));

// Mock child_process for extractCostOnce tests
const { mockExecFile } = vi.hoisted(() => {
  const mockExecFile = vi.fn();
  return { mockExecFile };
});

vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>();
  return {
    ...original,
    execFile: mockExecFile,
  };
});

describe("set_status EventBus emit (adj-066.5.2)", () => {
  let registerStatusTools: typeof import("../../src/services/mcp-tools/status.js").registerStatusTools;
  let resetAgentStatuses: typeof import("../../src/services/mcp-tools/status.js").resetAgentStatuses;

  // Capture registered tool handlers
  const toolHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      toolHandlers.set(name, handler);
    }),
  };

  const mockMessageStore = {
    insertMessage: vi.fn(() => ({
      id: "msg-1",
      createdAt: new Date().toISOString(),
      body: "test",
      metadata: null,
    })),
  };

  const mockEventStore = {
    insertEvent: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const statusModule = await import("../../src/services/mcp-tools/status.js");
    registerStatusTools = statusModule.registerStatusTools;
    resetAgentStatuses = statusModule.resetAgentStatuses;
    resetAgentStatuses();

    // Safe cast: mock server only needs .tool() for registration
    registerStatusTools(
      mockServer as unknown as Parameters<typeof registerStatusTools>[0],
      mockMessageStore as unknown as Parameters<typeof registerStatusTools>[1],
      mockEventStore as unknown as Parameters<typeof registerStatusTools>[2],
    );
  });

  it("should emit agent:status_changed on EventBus when set_status is called", async () => {
    const handler = toolHandlers.get("set_status");
    expect(handler).toBeDefined();

    await handler!(
      { status: "working", task: "writing tests", beadId: "adj-066.5.2" },
      { sessionId: "sess-123" },
    );

    expect(mockBus.emit).toHaveBeenCalledWith("agent:status_changed", {
      agentId: "engineer-7",
      agent: "engineer-7",
      status: "working",
      beadId: "adj-066.5.2",
      task: "writing tests",
    });
  });

  it("should emit agent:status_changed with resolved task/beadId from previous status", async () => {
    const handler = toolHandlers.get("set_status");

    // First call sets task and beadId
    await handler!(
      { status: "working", task: "coding", beadId: "adj-001" },
      { sessionId: "sess-123" },
    );
    vi.clearAllMocks();

    // Second call without task/beadId should preserve them
    await handler!(
      { status: "idle" },
      { sessionId: "sess-123" },
    );

    expect(mockBus.emit).toHaveBeenCalledWith("agent:status_changed", {
      agentId: "engineer-7",
      agent: "engineer-7",
      status: "idle",
      beadId: "adj-001",
      task: "coding",
    });
  });

  it("should not emit agent:status_changed when agent is unknown", async () => {
    const handler = toolHandlers.get("set_status");
    await handler!(
      { status: "working" },
      { sessionId: "unknown-session" },
    );

    expect(mockBus.emit).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Task 3 (adj-066.5.1): extractCostOnce one-shot cost extraction
// ============================================================================

describe("extractCostOnce (adj-066.5.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should extract cost and context from tmux capture-pane output", async () => {
    const statusBarLine = "~/code/ai/adjutant main $1.23 31% ❯❯❯";
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        const output = [
          "⏺ Working on the implementation...",
          "  Reading files and making changes.",
          "─────────────────────────────────────",
          statusBarLine,
        ].join("\n");
        cb(null, output, "");
      },
    );

    const { extractCostOnce } = await import("../../src/services/session-connector.js");
    const result = await extractCostOnce("my-session", "my-session:0.0");

    expect(result).not.toBeNull();
    expect(result?.cost).toBe(1.23);
    expect(result?.contextPercent).toBe(69); // 100 - 31
    expect(result?.tokens?.input).toBe(138000); // 69% of 200k
  });

  it("should return null when tmux command fails", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(new Error("no server running"), "", "no server running");
      },
    );

    const { extractCostOnce } = await import("../../src/services/session-connector.js");
    const result = await extractCostOnce("my-session", "my-session:0.0");

    expect(result).toBeNull();
  });

  it("should return null when no status bar is found in output", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, "just some regular output\nno status bar here\n", "");
      },
    );

    const { extractCostOnce } = await import("../../src/services/session-connector.js");
    const result = await extractCostOnce("my-session", "my-session:0.0");

    expect(result).toBeNull();
  });

  it("should extract context without cost when dollar amount is absent", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, "~/code/project main 50% ❯❯❯\n", "");
      },
    );

    const { extractCostOnce } = await import("../../src/services/session-connector.js");
    const result = await extractCostOnce("my-session", "my-session:0.0");

    expect(result).not.toBeNull();
    expect(result?.cost).toBeUndefined();
    expect(result?.contextPercent).toBe(50); // 100 - 50
  });
});

// ============================================================================
// parseStatusBarCost standalone function
// ============================================================================

describe("parseStatusBarCost (adj-066.5.1 helper)", () => {
  it("should parse status bar with cost and context", async () => {
    const { parseStatusBarCost } = await import("../../src/services/session-connector.js");

    const result = parseStatusBarCost([
      "~/code/ai/adjutant main $2.50 25% ❯❯❯",
    ]);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("cost_update");
    if (result?.type === "cost_update") {
      expect(result.cost).toBe(2.50);
      expect(result.contextPercent).toBe(75); // 100 - 25
    }
  });

  it("should return null for lines without status bar", async () => {
    const { parseStatusBarCost } = await import("../../src/services/session-connector.js");
    const result = parseStatusBarCost(["hello world", "no status here"]);
    expect(result).toBeNull();
  });
});
