/**
 * Tests for event-driven cost extraction (adj-066.5.3, adj-066.5.5).
 *
 * Verifies that agent:status_changed events trigger one-shot cost extraction
 * from tmux sessions, with proper debouncing and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories can only reference hoisted variables
// ---------------------------------------------------------------------------

const {
  handlers,
  mockOn,
  mockOff,
  mockEmit,
  mockFindByName,
  mockExtractCostOnce,
  mockRecordCostUpdate,
  mockGetAgentStatuses,
} = vi.hoisted(() => {
  const handlers = new Map<string, ((data: unknown, seq: number) => void)[]>();
  return {
    handlers,
    mockOn: vi.fn((event: string, handler: (data: unknown, seq: number) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    mockOff: vi.fn((event: string, handler: (data: unknown, seq: number) => void) => {
      const arr = handlers.get(event);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }),
    mockEmit: vi.fn(),
    mockFindByName: vi.fn(),
    mockExtractCostOnce: vi.fn(),
    mockRecordCostUpdate: vi.fn(),
    mockGetAgentStatuses: vi.fn(() => new Map()),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({
    on: mockOn,
    off: mockOff,
    emit: mockEmit,
  }),
}));

vi.mock("../../src/services/session-registry.js", () => ({
  SessionRegistry: vi.fn(),
  getSessionRegistry: () => ({
    findByName: mockFindByName,
  }),
  resetSessionRegistry: vi.fn(),
}));

vi.mock("../../src/services/session-connector.js", () => ({
  extractCostOnce: mockExtractCostOnce,
  SessionConnector: vi.fn(),
}));

vi.mock("../../src/services/cost-tracker.js", () => ({
  recordCostUpdate: mockRecordCostUpdate,
  clearSessionCost: vi.fn(),
  finalizeOrphanedSessions: vi.fn(),
}));

vi.mock("../../src/services/mcp-tools/status.js", () => ({
  getAgentStatuses: mockGetAgentStatuses,
}));

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

import {
  initEventDrivenCostExtraction,
  stopEventDrivenCostExtraction,
  DEBOUNCE_MS,
} from "../../src/services/event-driven-cost.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitStatusChanged(agent: string, status = "working") {
  const eventHandlers = handlers.get("agent:status_changed") ?? [];
  for (const handler of eventHandlers) {
    handler({ agent, status }, 1);
  }
}

function makeManagedSession(overrides: Partial<{
  id: string;
  name: string;
  tmuxSession: string;
  tmuxPane: string;
  projectPath: string;
}> = {}) {
  return {
    id: overrides.id ?? "session-123",
    name: overrides.name ?? "engineer-1",
    tmuxSession: overrides.tmuxSession ?? "adj-engineer-1",
    tmuxPane: overrides.tmuxPane ?? "adj-engineer-1:0.0",
    projectPath: overrides.projectPath ?? "/code/project",
    status: "working",
    mode: "swarm",
    workspaceType: "primary",
    connectedClients: new Set<string>(),
    outputBuffer: [],
    pipeActive: false,
    createdAt: new Date(),
    lastActivity: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Event-driven cost extraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    mockOn.mockClear();
    mockOff.mockClear();
    mockEmit.mockClear();
    mockFindByName.mockReset();
    mockExtractCostOnce.mockReset();
    mockRecordCostUpdate.mockReset();
    mockGetAgentStatuses.mockReturnValue(new Map());

    // Initialize the subscription
    initEventDrivenCostExtraction();
  });

  afterEach(() => {
    stopEventDrivenCostExtraction();
    vi.useRealTimers();
  });

  it("should subscribe to agent:status_changed on init", () => {
    expect(mockOn).toHaveBeenCalledWith(
      "agent:status_changed",
      expect.any(Function)
    );
  });

  it("should extract cost and record update on status change (happy path)", async () => {
    const session = makeManagedSession();
    mockFindByName.mockReturnValue([session]);
    mockExtractCostOnce.mockResolvedValue({
      cost: 1.23,
      contextPercent: 42,
      tokens: { input: 50000 },
    });
    mockGetAgentStatuses.mockReturnValue(
      new Map([["engineer-1", { beadId: "adj-066.5" }]])
    );

    emitStatusChanged("engineer-1", "working");

    // Advance past debounce and flush async
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);

    expect(mockExtractCostOnce).toHaveBeenCalledWith(
      "adj-engineer-1",
      "adj-engineer-1:0.0"
    );
    expect(mockRecordCostUpdate).toHaveBeenCalledWith(
      "session-123",
      "/code/project",
      expect.objectContaining({
        cost: 1.23,
        contextPercent: 42,
        tokens: { input: 50000 },
        agentId: "engineer-1",
        beadId: "adj-066.5",
      })
    );
  });

  it("should skip silently when no session found for agent", async () => {
    mockFindByName.mockReturnValue([]);

    emitStatusChanged("unknown-agent");

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);

    expect(mockExtractCostOnce).not.toHaveBeenCalled();
    expect(mockRecordCostUpdate).not.toHaveBeenCalled();
  });

  it("should debounce rapid status changes for the same agent", async () => {
    const session = makeManagedSession();
    mockFindByName.mockReturnValue([session]);
    mockExtractCostOnce.mockResolvedValue({ cost: 1.0, contextPercent: 30 });

    // Emit 5 rapid status changes
    emitStatusChanged("engineer-1", "working");
    emitStatusChanged("engineer-1", "idle");
    emitStatusChanged("engineer-1", "working");
    emitStatusChanged("engineer-1", "blocked");
    emitStatusChanged("engineer-1", "working");

    // Advance past debounce and flush async
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);

    // Should only have called extractCostOnce once
    expect(mockExtractCostOnce).toHaveBeenCalledTimes(1);
  });

  it("should NOT call recordCostUpdate when extraction returns null", async () => {
    const session = makeManagedSession();
    mockFindByName.mockReturnValue([session]);
    mockExtractCostOnce.mockResolvedValue(null);

    emitStatusChanged("engineer-1");

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);

    expect(mockExtractCostOnce).toHaveBeenCalledTimes(1);
    expect(mockRecordCostUpdate).not.toHaveBeenCalled();
  });

  it("should handle multiple agents independently", async () => {
    const sessionA = makeManagedSession({
      id: "session-a",
      name: "engineer-1",
      tmuxSession: "adj-eng-1",
      tmuxPane: "adj-eng-1:0.0",
      projectPath: "/code/a",
    });
    const sessionB = makeManagedSession({
      id: "session-b",
      name: "engineer-2",
      tmuxSession: "adj-eng-2",
      tmuxPane: "adj-eng-2:0.0",
      projectPath: "/code/b",
    });

    mockFindByName.mockImplementation((name: string) => {
      if (name === "engineer-1") return [sessionA];
      if (name === "engineer-2") return [sessionB];
      return [];
    });
    mockExtractCostOnce.mockResolvedValue({ cost: 0.5, contextPercent: 10 });

    emitStatusChanged("engineer-1");
    emitStatusChanged("engineer-2");

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);

    expect(mockExtractCostOnce).toHaveBeenCalledTimes(2);
    expect(mockExtractCostOnce).toHaveBeenCalledWith("adj-eng-1", "adj-eng-1:0.0");
    expect(mockExtractCostOnce).toHaveBeenCalledWith("adj-eng-2", "adj-eng-2:0.0");
    expect(mockRecordCostUpdate).toHaveBeenCalledTimes(2);
  });

  it("should skip extraction when session has no tmuxSession", async () => {
    const session = makeManagedSession({ tmuxSession: "", tmuxPane: "" });
    mockFindByName.mockReturnValue([session]);

    emitStatusChanged("engineer-1");

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);

    expect(mockExtractCostOnce).not.toHaveBeenCalled();
    expect(mockRecordCostUpdate).not.toHaveBeenCalled();
  });

  it("should clean up subscription on stop", () => {
    stopEventDrivenCostExtraction();

    expect(mockOff).toHaveBeenCalledWith(
      "agent:status_changed",
      expect.any(Function)
    );
  });
});
