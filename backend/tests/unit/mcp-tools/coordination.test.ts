import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be declared before any imports that use them
// ============================================================================

// Mock logger
vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock event-bus
const { mockEmit } = vi.hoisted(() => {
  const mockEmit = vi.fn();
  return { mockEmit };
});

vi.mock("../../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: mockEmit }),
}));

// Mock mcp-server (agent identity resolution)
const { mockGetAgentBySession } = vi.hoisted(() => {
  const mockGetAgentBySession = vi.fn();
  return { mockGetAgentBySession };
});

vi.mock("../../../src/services/mcp-server.js", () => ({
  getAgentBySession: (...args: unknown[]) => mockGetAgentBySession(...args),
}));

// Mock agent-spawner-service
const { mockSpawnAgent } = vi.hoisted(() => {
  const mockSpawnAgent = vi.fn();
  return { mockSpawnAgent };
});

vi.mock("../../../src/services/agent-spawner-service.js", () => ({
  spawnAgent: mockSpawnAgent,
}));

// Mock beads-mutations
const { mockUpdateBead } = vi.hoisted(() => {
  const mockUpdateBead = vi.fn();
  return { mockUpdateBead };
});

vi.mock("../../../src/services/beads/beads-mutations.js", () => ({
  updateBead: mockUpdateBead,
}));

// Mock session-bridge
const { mockSendInput, mockFindByName, mockListSessions } = vi.hoisted(() => {
  const mockSendInput = vi.fn();
  const mockFindByName = vi.fn();
  const mockListSessions = vi.fn();
  return { mockSendInput, mockFindByName, mockListSessions };
});

vi.mock("../../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => ({
    sendInput: mockSendInput,
    registry: {
      findByName: mockFindByName,
    },
    listSessions: mockListSessions,
  }),
}));

// Mock bd-client
const { mockExecBd } = vi.hoisted(() => {
  const mockExecBd = vi.fn();
  return { mockExecBd };
});

vi.mock("../../../src/services/bd-client.js", () => ({
  execBd: mockExecBd,
}));

// Mock MCP SDK
const { mockTool, MockMcpServer } = vi.hoisted(() => {
  const mockTool = vi.fn();
  const MockMcpServer = vi.fn().mockImplementation(function () {
    return {
      tool: mockTool,
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      server: {},
    };
  });
  return { mockTool, MockMcpServer };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: MockMcpServer,
}));

// Mock message store
const { mockInsertMessage } = vi.hoisted(() => {
  const mockInsertMessage = vi.fn();
  return { mockInsertMessage };
});

// ============================================================================
// Imports
// ============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCoordinationTools, _resetAutoNameCounter } from "../../../src/services/mcp-tools/coordination.js";
import type { AdjutantState } from "../../../src/services/adjutant/state-store.js";
import type { MessageStore } from "../../../src/services/message-store.js";
import type { StimulusEngine } from "../../../src/services/adjutant/stimulus-engine.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockServer(): McpServer {
  return new MockMcpServer() as unknown as McpServer;
}

function createMockState(): AdjutantState {
  return {
    getAgentProfile: vi.fn(),
    upsertAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn().mockReturnValue([]),
    incrementAssignmentCount: vi.fn(),
    logDecision: vi.fn(),
    getRecentDecisions: vi.fn().mockReturnValue([]),
    getMeta: vi.fn().mockReturnValue(null),
    setMeta: vi.fn(),
    pruneOldDecisions: vi.fn().mockReturnValue(0),
    logSpawn: vi.fn().mockReturnValue(1),
    getSpawnHistory: vi.fn().mockReturnValue([]),
    getAgentSpawnHistory: vi.fn().mockReturnValue([]),
    markDecommissioned: vi.fn(),
    getLastSpawn: vi.fn().mockReturnValue(null),
    countActiveSpawns: vi.fn().mockReturnValue(0),
    markAllDisconnected: vi.fn().mockReturnValue(0),
    recordOutcome: vi.fn(),
    getRecentDecisionsWithOutcomes: vi.fn().mockReturnValue([]),
    getDecisionsForTarget: vi.fn().mockReturnValue([]),
  };
}

function createMockMessageStore(): MessageStore {
  return {
    insertMessage: mockInsertMessage.mockReturnValue({
      id: "msg-123",
      createdAt: "2026-03-09T00:00:00Z",
    }),
  } as unknown as MessageStore;
}

function createMockStimulusEngine(): StimulusEngine {
  return {
    scheduleCheck: vi.fn().mockReturnValue("check-uuid-1"),
    registerWatch: vi.fn().mockReturnValue("watch-uuid-1"),
    cancelCheck: vi.fn(),
    cancelWatch: vi.fn(),
    getPendingSchedule: vi.fn().mockReturnValue({ checks: [], watches: [] }),
    handleCriticalSignal: vi.fn(),
    onWake: vi.fn(),
    triggerWatch: vi.fn(),
    destroy: vi.fn(),
  } as unknown as StimulusEngine;
}

/**
 * Register tools and extract the handler for a specific tool by name.
 * Tools are registered as (name, description, schema, handler) — handler is arg index 3.
 */
function getToolHandler(
  toolName: string,
  state?: AdjutantState,
  messageStore?: MessageStore,
  stimulusEngine?: StimulusEngine,
): (...args: unknown[]) => Promise<unknown> {
  const server = createMockServer();
  registerCoordinationTools(
    server,
    state ?? createMockState(),
    messageStore ?? createMockMessageStore(),
    stimulusEngine ?? createMockStimulusEngine(),
  );

  const call = mockTool.mock.calls.find(
    (c: unknown[]) => c[0] === toolName,
  );
  if (!call) {
    throw new Error(
      `Tool "${toolName}" was not registered. Registered: ${mockTool.mock.calls.map((c: unknown[]) => c[0]).join(", ")}`,
    );
  }
  // server.tool(name, description, schema, handler) -> handler is index 3
  return call[3] as (...args: unknown[]) => Promise<unknown>;
}

function parseResult(result: unknown): Record<string, unknown> {
  const r = result as { content: Array<{ text: string }> };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

// ============================================================================
// Tests
// ============================================================================

describe("MCP Coordination Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAutoNameCounter();
  });

  // ==========================================================================
  // Registration
  // ==========================================================================

  describe("registerCoordinationTools", () => {
    it("should register all coordination tools", () => {
      const server = createMockServer();
      registerCoordinationTools(server, createMockState(), createMockMessageStore(), createMockStimulusEngine());

      const toolNames = mockTool.mock.calls.map((c: unknown[]) => c[0]);
      expect(toolNames).toContain("spawn_worker");
      expect(toolNames).toContain("assign_bead");
      expect(toolNames).toContain("nudge_agent");
      expect(toolNames).toContain("decommission_agent");
      expect(toolNames).toContain("rebalance_work");
      expect(toolNames).toContain("schedule_check");
      expect(toolNames).toContain("watch_for");
    });
  });

  // ==========================================================================
  // spawn_worker
  // ==========================================================================

  describe("spawn_worker", () => {
    it("should spawn an agent and return success", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({
        success: true,
        sessionId: "session-42",
        tmuxSession: "adj-swarm-worker-1",
      });

      const state = createMockState();
      const handler = getToolHandler("spawn_worker", state);
      const result = await handler(
        { prompt: "Build the feature", agentName: "worker-1" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(data.agentName).toBe("worker-1");
      expect(data.sessionId).toBe("session-42");

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "worker-1",
          initialPrompt: "Build the feature",
        }),
      );

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "adjutant",
          action: "spawn_worker",
          target: "worker-1",
        }),
      );
    });

    it("should auto-generate agent name when omitted", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({
        success: true,
        sessionId: "session-99",
        tmuxSession: "adj-swarm-agent-1",
      });

      const handler = getToolHandler("spawn_worker");
      const result = await handler(
        { prompt: "Do the thing" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
      // Auto-generated name should be defined
      expect(data.agentName).toBeDefined();
      expect(typeof data.agentName).toBe("string");
    });

    it("should pass caller-supplied projectPath to spawnAgent", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({
        success: true,
        sessionId: "session-42",
        tmuxSession: "adj-swarm-worker-1",
      });

      const handler = getToolHandler("spawn_worker");
      await handler(
        { prompt: "Build the feature", agentName: "worker-1", projectPath: "/Users/test/code/ai/adjutant" },
        { sessionId: "adj-session" },
      );

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: "/Users/test/code/ai/adjutant",
        }),
      );
    });

    it("should fall back to env/cwd when projectPath is not provided", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({
        success: true,
        sessionId: "session-42",
        tmuxSession: "adj-swarm-worker-1",
      });

      const handler = getToolHandler("spawn_worker");
      await handler(
        { prompt: "Build the feature", agentName: "worker-1" },
        { sessionId: "adj-session" },
      );

      // When no projectPath is passed, it should still call spawnAgent with some projectPath
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: expect.any(String),
        }),
      );
    });

    it("should return error when spawn fails", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({
        success: false,
        error: "tmux not available",
      });

      const handler = getToolHandler("spawn_worker");
      const result = await handler(
        { prompt: "Build the thing" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toBe("tmux not available");
    });

    it("should log spawn to state store", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({
        success: true,
        sessionId: "session-77",
      });

      const state = createMockState();
      const handler = getToolHandler("spawn_worker", state);
      await handler(
        { prompt: "Work on adj-054", beadId: "adj-054.3.1", agentName: "eng-1" },
        { sessionId: "adj-session" },
      );

      expect(state.logSpawn).toHaveBeenCalledWith("eng-1", expect.any(String), "adj-054.3.1");
    });
  });

  // ==========================================================================
  // assign_bead
  // ==========================================================================

  describe("assign_bead", () => {
    it("should assign a bead to an agent", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockUpdateBead.mockResolvedValue({ success: true, data: { id: "adj-042", assignee: "worker-1" } });

      const state = createMockState();
      const handler = getToolHandler("assign_bead", state);
      const result = await handler(
        { beadId: "adj-042", agentId: "worker-1", reason: "Best fit for this task" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);

      expect(mockUpdateBead).toHaveBeenCalledWith("adj-042", {
        assignee: "worker-1",
        status: "in_progress",
      });
    });

    it("should emit bead:assigned event", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockUpdateBead.mockResolvedValue({ success: true, data: { id: "adj-042" } });

      const handler = getToolHandler("assign_bead");
      await handler(
        { beadId: "adj-042", agentId: "worker-1", reason: "Test" },
        { sessionId: "adj-session" },
      );

      expect(mockEmit).toHaveBeenCalledWith("bead:assigned", {
        beadId: "adj-042",
        agentId: "worker-1",
        assignedBy: "adjutant",
      });
    });

    it("should update agent profile in state store", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockUpdateBead.mockResolvedValue({ success: true, data: { id: "adj-042" } });

      const state = createMockState();
      const handler = getToolHandler("assign_bead", state);
      await handler(
        { beadId: "adj-042", agentId: "worker-1", reason: "Test" },
        { sessionId: "adj-session" },
      );

      expect(state.upsertAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "worker-1",
          currentBeadId: "adj-042",
        }),
      );
    });

    it("should log decision to state store", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockUpdateBead.mockResolvedValue({ success: true, data: { id: "adj-042" } });

      const state = createMockState();
      const handler = getToolHandler("assign_bead", state);
      await handler(
        { beadId: "adj-042", agentId: "worker-1", reason: "Epic affinity match" },
        { sessionId: "adj-session" },
      );

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "adjutant",
          action: "assign_bead",
          target: "adj-042",
          reason: "Epic affinity match",
        }),
      );
    });

    it("should return error when update fails", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockUpdateBead.mockResolvedValue({
        success: false,
        error: { code: "NOT_FOUND", message: "Bead not found" },
      });

      const handler = getToolHandler("assign_bead");
      const result = await handler(
        { beadId: "adj-999", agentId: "worker-1", reason: "Test" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Bead not found");
    });
  });

  // ==========================================================================
  // nudge_agent
  // ==========================================================================

  describe("nudge_agent", () => {
    it("should send a nudge message to agent tmux session", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockFindByName.mockReturnValue([{ id: "session-42", status: "idle" }]);
      mockSendInput.mockResolvedValue(true);

      const state = createMockState();
      const handler = getToolHandler("nudge_agent", state);
      const result = await handler(
        { agentId: "worker-1", message: "Please check your build" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);

      expect(mockFindByName).toHaveBeenCalledWith("worker-1");
      expect(mockSendInput).toHaveBeenCalledWith(
        "session-42",
        "Please check your build",
      );
    });

    it("should collapse multiline messages to single line", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockFindByName.mockReturnValue([{ id: "session-42", status: "idle" }]);
      mockSendInput.mockResolvedValue(true);

      const handler = getToolHandler("nudge_agent");
      await handler(
        { agentId: "worker-1", message: "Line one\nLine two\nLine three" },
        { sessionId: "adj-session" },
      );

      expect(mockSendInput).toHaveBeenCalledWith(
        "session-42",
        "Line one Line two Line three",
      );
    });

    it("should return error when agent session not found", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockFindByName.mockReturnValue([]);

      const handler = getToolHandler("nudge_agent");
      const result = await handler(
        { agentId: "ghost-agent", message: "Hello?" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });

    it("should log decision to state store", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockFindByName.mockReturnValue([{ id: "session-42", status: "idle" }]);
      mockSendInput.mockResolvedValue(true);

      const state = createMockState();
      const handler = getToolHandler("nudge_agent", state);
      await handler(
        { agentId: "worker-1", message: "Check build" },
        { sessionId: "adj-session" },
      );

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "adjutant",
          action: "nudge_agent",
          target: "worker-1",
        }),
      );
    });
  });

  // ==========================================================================
  // decommission_agent
  // ==========================================================================

  describe("decommission_agent", () => {
    it("should send shutdown message to agent", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const messageStore = createMockMessageStore();
      const state = createMockState();
      const handler = getToolHandler("decommission_agent", state, messageStore);
      const result = await handler(
        { agentId: "worker-1", reason: "No more work" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);

      // Should have sent a shutdown message via message store
      expect(mockInsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "adjutant",
          recipient: "worker-1",
          role: "agent",
        }),
      );
    });

    it("should reject decommissioning protected agents", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const handler = getToolHandler("decommission_agent");

      // Try adjutant-coordinator
      const result1 = await handler(
        { agentId: "adjutant-coordinator", reason: "Cleanup" },
        { sessionId: "adj-session" },
      );
      const data1 = parseResult(result1);
      expect(data1.success).toBe(false);
      expect(data1.error).toContain("protected");

      // Try adjutant
      const result2 = await handler(
        { agentId: "adjutant", reason: "Cleanup" },
        { sessionId: "adj-session" },
      );
      const data2 = parseResult(result2);
      expect(data2.success).toBe(false);
      expect(data2.error).toContain("protected");
    });

    it("should log decision to state store", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      const handler = getToolHandler("decommission_agent", state);
      await handler(
        { agentId: "worker-1", reason: "Idle for 30min" },
        { sessionId: "adj-session" },
      );

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "adjutant",
          action: "decommission_agent",
          target: "worker-1",
          reason: "Idle for 30min",
        }),
      );
    });

    it("should mark spawn as decommissioned", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      (state.getLastSpawn as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 5,
        agentId: "worker-1",
        spawnedAt: "2026-03-09T00:00:00Z",
        decommissionedAt: null,
      });

      const handler = getToolHandler("decommission_agent", state);
      await handler(
        { agentId: "worker-1", reason: "Done" },
        { sessionId: "adj-session" },
      );

      expect(state.markDecommissioned).toHaveBeenCalledWith(5);
    });
  });

  // ==========================================================================
  // rebalance_work
  // ==========================================================================

  describe("rebalance_work", () => {
    it("should unassign all in-progress beads from agent", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockExecBd.mockResolvedValue({
        success: true,
        data: [
          { id: "adj-042", title: "Task A", status: "in_progress" },
          { id: "adj-043", title: "Task B", status: "in_progress" },
        ],
      });
      mockUpdateBead.mockResolvedValue({ success: true, data: {} });

      const state = createMockState();
      const handler = getToolHandler("rebalance_work", state);
      const result = await handler(
        { agentId: "worker-1", reason: "Agent disconnected" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(data.rebalancedBeads).toEqual(["adj-042", "adj-043"]);

      // Should have called updateBead for each bead
      expect(mockUpdateBead).toHaveBeenCalledTimes(2);
      expect(mockUpdateBead).toHaveBeenCalledWith("adj-042", {
        status: "open",
        assignee: "",
      });
      expect(mockUpdateBead).toHaveBeenCalledWith("adj-043", {
        status: "open",
        assignee: "",
      });
    });

    it("should return empty list when no beads found", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockExecBd.mockResolvedValue({
        success: true,
        data: [],
      });

      const handler = getToolHandler("rebalance_work");
      const result = await handler(
        { agentId: "worker-1" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(data.rebalancedBeads).toEqual([]);
    });

    it("should log decision for each rebalanced bead", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockExecBd.mockResolvedValue({
        success: true,
        data: [{ id: "adj-042", title: "Task A", status: "in_progress" }],
      });
      mockUpdateBead.mockResolvedValue({ success: true, data: {} });

      const state = createMockState();
      const handler = getToolHandler("rebalance_work", state);
      await handler(
        { agentId: "worker-1", reason: "Agent disconnected" },
        { sessionId: "adj-session" },
      );

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "adjutant",
          action: "rebalance_work",
          target: "adj-042",
        }),
      );
    });
  });

  // ==========================================================================
  // schedule_check
  // ==========================================================================

  describe("schedule_check", () => {
    it("should schedule a check via stimulus engine", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const engine = createMockStimulusEngine();
      const state = createMockState();
      const handler = getToolHandler("schedule_check", state, undefined, engine);
      const result = await handler(
        { delay: "15m", reason: "Check worker-5 progress" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(data.checkId).toBe("check-uuid-1");
      expect(data.firesAt).toBeDefined();

      // 15m = 900_000 ms
      expect(engine.scheduleCheck).toHaveBeenCalledWith(900_000, "Check worker-5 progress");
    });

    it("should parse various delay formats", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const engine = createMockStimulusEngine();
      const handler = getToolHandler("schedule_check", undefined, undefined, engine);

      // Test "30s"
      await handler({ delay: "30s", reason: "Quick" }, { sessionId: "adj-session" });
      expect(engine.scheduleCheck).toHaveBeenCalledWith(30_000, "Quick");

      vi.clearAllMocks();

      // Test "1h"
      (engine.scheduleCheck as ReturnType<typeof vi.fn>).mockReturnValue("check-uuid-2");
      await handler({ delay: "1h", reason: "Hour check" }, { sessionId: "adj-session" });
      expect(engine.scheduleCheck).toHaveBeenCalledWith(3_600_000, "Hour check");
    });

    it("should return error for invalid delay format", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const handler = getToolHandler("schedule_check");
      const result = await handler(
        { delay: "invalid", reason: "Bad" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Invalid delay");
    });

    it("should log decision to state store", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      const handler = getToolHandler("schedule_check", state);
      await handler(
        { delay: "5m", reason: "Follow up" },
        { sessionId: "adj-session" },
      );

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "adjutant",
          action: "schedule_check",
        }),
      );
    });
  });

  // ==========================================================================
  // watch_for
  // ==========================================================================

  describe("watch_for", () => {
    it("should register a watch via stimulus engine", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const engine = createMockStimulusEngine();
      const handler = getToolHandler("watch_for", undefined, undefined, engine);
      const result = await handler(
        { event: "bead:closed", reason: "Wait for task completion" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(data.watchId).toBe("watch-uuid-1");
      expect(data.watching).toBe("bead:closed");

      expect(engine.registerWatch).toHaveBeenCalledWith(
        "bead:closed",
        undefined,
        undefined,
        "Wait for task completion",
      );
    });

    it("should pass filter and timeout to engine", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const engine = createMockStimulusEngine();
      const handler = getToolHandler("watch_for", undefined, undefined, engine);
      await handler(
        {
          event: "bead:closed",
          filter: { id: "adj-042.1.2" },
          timeout: "30m",
          reason: "Track bead outcome",
        },
        { sessionId: "adj-session" },
      );

      expect(engine.registerWatch).toHaveBeenCalledWith(
        "bead:closed",
        { id: "adj-042.1.2" },
        1_800_000, // 30m
        "Track bead outcome",
      );
    });

    it("should return error for invalid timeout format", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const handler = getToolHandler("watch_for");
      const result = await handler(
        { event: "bead:closed", timeout: "bad", reason: "test" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Invalid timeout");
    });

    it("should log decision to state store", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      const handler = getToolHandler("watch_for", state);
      await handler(
        { event: "bead:closed", reason: "Track" },
        { sessionId: "adj-session" },
      );

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "adjutant",
          action: "watch_for",
        }),
      );
    });
  });

  // ==========================================================================
  // Access Guard (adj-054.3.6)
  // ==========================================================================

  describe("access guard", () => {
    it("should allow adjutant agent to use tools", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({ success: true, sessionId: "s1" });

      const handler = getToolHandler("spawn_worker");
      const result = await handler(
        { prompt: "Do work" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
    });

    it("should allow adjutant-coordinator to use tools", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant-coordinator");
      mockSpawnAgent.mockResolvedValue({ success: true, sessionId: "s1" });

      const handler = getToolHandler("spawn_worker");
      const result = await handler(
        { prompt: "Do work" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
    });

    it("should reject non-adjutant agents from all tools", async () => {
      mockGetAgentBySession.mockReturnValue("worker-5");

      const toolNames = ["spawn_worker", "assign_bead", "nudge_agent", "decommission_agent", "rebalance_work", "schedule_check", "watch_for"];

      for (const toolName of toolNames) {
        const handler = getToolHandler(toolName);

        // Build appropriate args for each tool
        let args: Record<string, unknown>;
        switch (toolName) {
          case "spawn_worker":
            args = { prompt: "test" };
            break;
          case "assign_bead":
            args = { beadId: "adj-1", agentId: "x", reason: "r" };
            break;
          case "nudge_agent":
            args = { agentId: "x", message: "m" };
            break;
          case "decommission_agent":
            args = { agentId: "x", reason: "r" };
            break;
          case "rebalance_work":
            args = { agentId: "x" };
            break;
          case "schedule_check":
            args = { delay: "5m", reason: "r" };
            break;
          case "watch_for":
            args = { event: "bead:closed", reason: "r" };
            break;
          default:
            args = {};
        }

        const result = await handler(args, { sessionId: "worker-session" });
        const data = parseResult(result);
        expect(data.error).toContain("restricted");
      }
    });

    it("should reject when session is unknown", async () => {
      mockGetAgentBySession.mockReturnValue(undefined);

      const handler = getToolHandler("spawn_worker");
      const result = await handler(
        { prompt: "test" },
        { sessionId: "unknown-session" },
      );

      const r = result as { content: Array<{ text: string }>; isError?: boolean };
      expect(r.isError).toBe(true);
    });

    it("should set isError on restricted result for non-adjutant agents", async () => {
      mockGetAgentBySession.mockReturnValue("worker-5");

      const handler = getToolHandler("spawn_worker");
      const result = await handler(
        { prompt: "test" },
        { sessionId: "worker-session" },
      );

      const r = result as { content: Array<{ text: string }>; isError?: boolean };
      expect(r.isError).toBe(true);
    });
  });

  // ==========================================================================
  // Auto-name counter (adj-054.7 — QA)
  // ==========================================================================

  describe("auto-name counter", () => {
    it("should generate sequential agent names", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({ success: true, sessionId: "s1" });

      const handler = getToolHandler("spawn_worker");
      const result1 = await handler({ prompt: "work 1" }, { sessionId: "adj-session" });
      const result2 = await handler({ prompt: "work 2" }, { sessionId: "adj-session" });

      const data1 = parseResult(result1);
      const data2 = parseResult(result2);
      expect(data1.agentName).toBe("agent-1");
      expect(data2.agentName).toBe("agent-2");
    });

    it("should reset counter between tests via _resetAutoNameCounter", () => {
      // _resetAutoNameCounter is called in beforeEach, so counter starts at 0
      // This test verifies the reset worked by checking names start fresh
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockSpawnAgent.mockResolvedValue({ success: true, sessionId: "s1" });

      const handler = getToolHandler("spawn_worker");
      return handler({ prompt: "first spawn" }, { sessionId: "adj-session" }).then((result) => {
        const data = parseResult(result);
        expect(data.agentName).toBe("agent-1");
      });
    });
  });

  // ==========================================================================
  // schedule_check edge cases (adj-054.7 — QA)
  // ==========================================================================

  describe("schedule_check edge cases", () => {
    it("should reject zero-value delays like '0s'", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const handler = getToolHandler("schedule_check");
      const result = await handler(
        { delay: "0s", reason: "Immediate" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Invalid delay");
    });

    it("should reject zero-value delays like '0m'", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const handler = getToolHandler("schedule_check");
      const result = await handler(
        { delay: "0m", reason: "Immediate" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Invalid delay");
    });

    it("should return error when stimulus engine is unavailable", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const server = createMockServer();
      const state = createMockState();
      const messageStore = createMockMessageStore();
      // Register without stimulus engine
      registerCoordinationTools(server, state, messageStore, undefined);

      const call = mockTool.mock.calls.find((c: unknown[]) => c[0] === "schedule_check");
      const handler = call![3] as (...args: unknown[]) => Promise<unknown>;
      const result = await handler(
        { delay: "5m", reason: "test" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not available");
    });
  });

  // ==========================================================================
  // watch_for edge cases (adj-054.7 — QA)
  // ==========================================================================

  describe("watch_for edge cases", () => {
    it("should reject zero-value timeout like '0m'", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const handler = getToolHandler("watch_for");
      const result = await handler(
        { event: "bead:closed", timeout: "0m", reason: "test" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Invalid timeout");
    });

    it("should return error when stimulus engine is unavailable", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const server = createMockServer();
      const state = createMockState();
      const messageStore = createMockMessageStore();
      registerCoordinationTools(server, state, messageStore, undefined);

      const call = mockTool.mock.calls.find((c: unknown[]) => c[0] === "watch_for");
      const handler = call![3] as (...args: unknown[]) => Promise<unknown>;
      const result = await handler(
        { event: "bead:closed", reason: "test" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not available");
    });
  });

  // ==========================================================================
  // nudge_agent edge cases (adj-054.7 — QA)
  // ==========================================================================

  describe("nudge_agent edge cases", () => {
    it("should return error when sendInput fails", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockFindByName.mockReturnValue([{ id: "session-42", status: "idle" }]);
      mockSendInput.mockResolvedValue(false);

      const handler = getToolHandler("nudge_agent");
      const result = await handler(
        { agentId: "worker-1", message: "Hello" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Failed to send");
    });

    it("should return error when findByName returns null", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      mockFindByName.mockReturnValue(null);

      const handler = getToolHandler("nudge_agent");
      const result = await handler(
        { agentId: "ghost", message: "Hello" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });
  });

  // ==========================================================================
  // decommission_agent edge cases (adj-054.7 — QA)
  // ==========================================================================

  describe("decommission_agent edge cases", () => {
    it("should skip markDecommissioned when no spawn record exists", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      (state.getLastSpawn as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const handler = getToolHandler("decommission_agent", state);
      await handler(
        { agentId: "worker-1", reason: "Done" },
        { sessionId: "adj-session" },
      );

      expect(state.markDecommissioned).not.toHaveBeenCalled();
    });

    it("should refuse to decommission an agent with status 'working'", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "worker-1",
        lastStatus: "working",
        lastStatusAt: new Date().toISOString(),
        currentTask: "Implementing feature X",
        disconnectedAt: null,
      });

      const handler = getToolHandler("decommission_agent", state);
      const result = await handler(
        { agentId: "worker-1", reason: "Idle cleanup" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("working");
      expect(mockInsertMessage).not.toHaveBeenCalled();
    });

    it("should refuse to decommission an agent active within last 10 minutes", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "worker-1",
        lastStatus: "idle",
        lastStatusAt: fiveMinutesAgo,
        currentTask: null,
        disconnectedAt: null,
      });

      const handler = getToolHandler("decommission_agent", state);
      const result = await handler(
        { agentId: "worker-1", reason: "Idle cleanup" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.error).toContain("recently active");
      expect(mockInsertMessage).not.toHaveBeenCalled();
    });

    it("should allow decommission of agent idle for over 10 minutes", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "worker-1",
        lastStatus: "idle",
        lastStatusAt: twentyMinutesAgo,
        currentTask: null,
        disconnectedAt: null,
      });

      const messageStore = createMockMessageStore();
      const handler = getToolHandler("decommission_agent", state, messageStore);
      const result = await handler(
        { agentId: "worker-1", reason: "Idle cleanup" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(mockInsertMessage).toHaveBeenCalled();
    });

    it("should allow decommission when agent has status 'done'", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue({
        agentId: "worker-1",
        lastStatus: "done",
        lastStatusAt: twoMinutesAgo,
        currentTask: "Completed feature X",
        disconnectedAt: null,
      });

      const messageStore = createMockMessageStore();
      const handler = getToolHandler("decommission_agent", state, messageStore);
      const result = await handler(
        { agentId: "worker-1", reason: "Work complete" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(mockInsertMessage).toHaveBeenCalled();
    });

    it("should allow decommission when no agent profile exists", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      (state.getAgentProfile as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const messageStore = createMockMessageStore();
      const handler = getToolHandler("decommission_agent", state, messageStore);
      const result = await handler(
        { agentId: "unknown-agent", reason: "Cleanup" },
        { sessionId: "adj-session" },
      );

      const data = parseResult(result);
      expect(data.success).toBe(true);
    });

    it("should skip markDecommissioned when spawn is already decommissioned", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");

      const state = createMockState();
      (state.getLastSpawn as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 5,
        agentId: "worker-1",
        spawnedAt: "2026-03-09T00:00:00Z",
        decommissionedAt: "2026-03-09T01:00:00Z",
      });

      const handler = getToolHandler("decommission_agent", state);
      await handler(
        { agentId: "worker-1", reason: "Done" },
        { sessionId: "adj-session" },
      );

      expect(state.markDecommissioned).not.toHaveBeenCalled();
    });
  });
});
