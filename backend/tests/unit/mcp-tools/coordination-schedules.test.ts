import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be declared before any imports that use them
// ============================================================================

vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const { mockEmit } = vi.hoisted(() => {
  const mockEmit = vi.fn();
  return { mockEmit };
});

vi.mock("../../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: mockEmit }),
}));

const { mockGetAgentBySession } = vi.hoisted(() => {
  const mockGetAgentBySession = vi.fn();
  return { mockGetAgentBySession };
});

vi.mock("../../../src/services/mcp-server.js", () => ({
  getAgentBySession: (...args: unknown[]) => mockGetAgentBySession(...args),
}));

vi.mock("../../../src/services/agent-spawner-service.js", () => ({
  spawnAgent: vi.fn(),
}));

vi.mock("../../../src/services/beads/beads-mutations.js", () => ({
  updateBead: vi.fn(),
}));

vi.mock("../../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => ({
    sendInput: vi.fn(),
    registry: { findByName: vi.fn() },
    listSessions: vi.fn(),
  }),
}));

vi.mock("../../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
}));

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

// ============================================================================
// Imports
// ============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCoordinationTools } from "../../../src/services/mcp-tools/coordination.js";
import type { AdjutantState } from "../../../src/services/adjutant/state-store.js";
import type { MessageStore } from "../../../src/services/message-store.js";
import type { StimulusEngine } from "../../../src/services/adjutant/stimulus-engine.js";
import type { EventStore } from "../../../src/services/event-store.js";
import type { CronScheduleStore, CronSchedule } from "../../../src/services/adjutant/cron-schedule-store.js";

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
    insertMessage: vi.fn().mockReturnValue({
      id: "msg-123",
      createdAt: "2026-03-09T00:00:00Z",
    }),
  } as unknown as MessageStore;
}

function createMockStimulusEngine(): StimulusEngine {
  return {
    scheduleCheck: vi.fn().mockReturnValue("check-uuid-1"),
    registerWatch: vi.fn().mockReturnValue("watch-uuid-1"),
    registerRecurringSchedule: vi.fn(),
    cancelRecurringSchedule: vi.fn(),
    cancelCheck: vi.fn(),
    cancelWatch: vi.fn(),
    getPendingSchedule: vi.fn().mockReturnValue({ checks: [], watches: [], recurringSchedules: [] }),
    handleCriticalSignal: vi.fn(),
    onWake: vi.fn(),
    triggerWatch: vi.fn(),
    destroy: vi.fn(),
    loadRecurringSchedules: vi.fn(),
  } as unknown as StimulusEngine;
}

function createMockEventStore(): EventStore {
  return {
    insertEvent: vi.fn().mockReturnValue({
      id: "evt-mock-1",
      eventType: "coordinator_action",
      agentId: "adjutant",
      action: "test",
      detail: null,
      beadId: null,
      messageId: null,
      createdAt: "2026-03-09T00:00:00Z",
    }),
    getEvents: vi.fn().mockReturnValue([]),
    pruneOldEvents: vi.fn().mockReturnValue(0),
  } as unknown as EventStore;
}

function createMockCronScheduleStore(): CronScheduleStore {
  return {
    create: vi.fn().mockReturnValue({
      id: "sched-uuid-1",
      cronExpr: "*/15 * * * *",
      reason: "Test schedule",
      createdBy: "adjutant",
      createdAt: "2026-03-24T00:00:00Z",
      lastFiredAt: null,
      nextFireAt: "2026-03-24T00:15:00Z",
      enabled: true,
      maxFires: null,
      fireCount: 0,
      targetAgent: "adjutant-coordinator",
      targetTmuxSession: "adj-swarm-adjutant-coordinator",
    } satisfies CronSchedule),
    getById: vi.fn(),
    listAll: vi.fn().mockReturnValue([]),
    listByAgent: vi.fn().mockReturnValue([]),
    listEnabled: vi.fn().mockReturnValue([]),
    update: vi.fn().mockReturnValue(true),
    delete: vi.fn().mockReturnValue(true),
    incrementFireCount: vi.fn().mockReturnValue(true),
    disable: vi.fn().mockReturnValue(true),
    disableByAgent: vi.fn().mockReturnValue(0),
  } as unknown as CronScheduleStore;
}

/**
 * Register tools and extract the handler for a specific tool by name.
 */
/** Sentinel to explicitly pass undefined for an optional dependency. */
const NONE = Symbol("none");

function getToolHandler(
  toolName: string,
  opts?: {
    state?: AdjutantState;
    messageStore?: MessageStore;
    stimulusEngine?: StimulusEngine | typeof NONE;
    eventStore?: EventStore;
    cronScheduleStore?: CronScheduleStore | typeof NONE;
  },
): (...args: unknown[]) => Promise<unknown> {
  const server = createMockServer();
  registerCoordinationTools(
    server,
    opts?.state ?? createMockState(),
    opts?.messageStore ?? createMockMessageStore(),
    opts?.stimulusEngine === NONE ? undefined : (opts?.stimulusEngine ?? createMockStimulusEngine()),
    opts?.eventStore ?? createMockEventStore(),
    opts?.cronScheduleStore === NONE ? undefined : (opts?.cronScheduleStore ?? createMockCronScheduleStore()),
  );

  const call = mockTool.mock.calls.find(
    (c: unknown[]) => c[0] === toolName,
  );
  if (!call) {
    throw new Error(
      `Tool "${toolName}" was not registered. Registered: ${mockTool.mock.calls.map((c: unknown[]) => c[0]).join(", ")}`,
    );
  }
  return call[3] as (...args: unknown[]) => Promise<unknown>;
}

function parseResult(result: unknown): Record<string, unknown> {
  const r = result as { content: { text: string }[] };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

// ============================================================================
// Tests
// ============================================================================

describe("MCP Coordination Schedule Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // create_schedule
  // ==========================================================================

  describe("create_schedule", () => {
    it("should create a schedule and register it with stimulus engine", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();

      const handler = getToolHandler("create_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { cron: "*/15 * * * *", reason: "Check agent health", maxFires: 10 },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.id).toBe("sched-uuid-1");
      expect(parsed.cronExpr).toBe("*/15 * * * *");
      expect(parsed.nextFireAt).toBeDefined();

      // Verify store.create was called
      expect(cronScheduleStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cronExpr: "*/15 * * * *",
          reason: "Check agent health",
          createdBy: "adjutant",
          maxFires: 10,
        }),
      );

      // Verify stimulus engine registration
      expect(stimulusEngine.registerRecurringSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ id: "sched-uuid-1" }),
        cronScheduleStore,
      );
    });

    it("should reject invalid cron expressions", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const handler = getToolHandler("create_schedule");

      const result = await handler(
        { cron: "invalid cron", reason: "Test" },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBeDefined();
    });

    it("should allow non-coordinator agents (adj-163.4: self-scheduling)", async () => {
      mockGetAgentBySession.mockReturnValue("random-agent");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.create as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-random-1",
        cronExpr: "*/15 * * * *",
        reason: "Test",
        createdBy: "random-agent",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:15:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "random-agent",
        targetTmuxSession: "adj-swarm-random-agent",
      } satisfies CronSchedule);

      const handler = getToolHandler("create_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { cron: "*/15 * * * *", reason: "Test" },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
    });

    it("should return error when stimulus engine is not available", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const handler = getToolHandler("create_schedule", {
        stimulusEngine: NONE,
      });

      const result = await handler(
        { cron: "*/15 * * * *", reason: "Test" },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("not available");
    });
  });

  // ==========================================================================
  // list_schedules
  // ==========================================================================

  describe("list_schedules", () => {
    it("should return all schedules from the store", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const cronScheduleStore = createMockCronScheduleStore();
      const schedules: CronSchedule[] = [
        {
          id: "sched-1",
          cronExpr: "*/15 * * * *",
          reason: "Health check",
          createdBy: "adjutant",
          createdAt: "2026-03-24T00:00:00Z",
          lastFiredAt: null,
          nextFireAt: "2026-03-24T00:15:00Z",
          enabled: true,
          maxFires: null,
          fireCount: 0,
          targetAgent: "adjutant-coordinator",
          targetTmuxSession: "adj-swarm-adjutant-coordinator",
        },
        {
          id: "sched-2",
          cronExpr: "0 * * * *",
          reason: "Hourly review",
          createdBy: "adjutant",
          createdAt: "2026-03-24T00:00:00Z",
          lastFiredAt: "2026-03-24T01:00:00Z",
          nextFireAt: "2026-03-24T02:00:00Z",
          enabled: true,
          maxFires: 5,
          fireCount: 1,
          targetAgent: "adjutant-coordinator",
          targetTmuxSession: "adj-swarm-adjutant-coordinator",
        },
      ];
      (cronScheduleStore.listAll as ReturnType<typeof vi.fn>).mockReturnValue(schedules);

      const handler = getToolHandler("list_schedules", { cronScheduleStore });

      const result = await handler({}, { sessionId: "session-1" });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.schedules).toEqual(schedules);
    });

    it("should allow non-coordinator agents with scoped results (adj-163.4)", async () => {
      mockGetAgentBySession.mockReturnValue("random-agent");
      const cronScheduleStore = createMockCronScheduleStore();
      const handler = getToolHandler("list_schedules", { cronScheduleStore });

      const result = await handler({}, { sessionId: "session-1" });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      // Non-coordinator should use listByAgent, not listAll
      expect(cronScheduleStore.listByAgent).toHaveBeenCalledWith("random-agent");
    });
  });

  // ==========================================================================
  // cancel_schedule
  // ==========================================================================

  describe("cancel_schedule", () => {
    it("should delete the schedule and cancel the timer", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();

      const handler = getToolHandler("cancel_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { id: "sched-1" },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.id).toBe("sched-1");
      expect(cronScheduleStore.delete).toHaveBeenCalledWith("sched-1");
      expect(stimulusEngine.cancelRecurringSchedule).toHaveBeenCalledWith("sched-1");
    });

    it("should return error when schedule not found", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.delete as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const handler = getToolHandler("cancel_schedule", { cronScheduleStore });

      const result = await handler(
        { id: "nonexistent" },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
    });
  });

  // ==========================================================================
  // pause_schedule
  // ==========================================================================

  describe("pause_schedule", () => {
    it("should disable the schedule and cancel the timer", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();

      const handler = getToolHandler("pause_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { id: "sched-1" },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.id).toBe("sched-1");
      expect(parsed.enabled).toBe(false);
      expect(cronScheduleStore.disable).toHaveBeenCalledWith("sched-1");
      expect(stimulusEngine.cancelRecurringSchedule).toHaveBeenCalledWith("sched-1");
    });

    it("should allow non-coordinator agents to pause own schedule (adj-163.4)", async () => {
      mockGetAgentBySession.mockReturnValue("random-agent");
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-1",
        targetAgent: "random-agent",
      });
      const stimulusEngine = createMockStimulusEngine();

      const handler = getToolHandler("pause_schedule", { cronScheduleStore, stimulusEngine });

      const result = await handler({ id: "sched-1" }, { sessionId: "session-1" });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
    });
  });

  // ==========================================================================
  // resume_schedule
  // ==========================================================================

  describe("resume_schedule", () => {
    it("should re-enable the schedule and register a new timer", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      const existingSchedule: CronSchedule = {
        id: "sched-1",
        cronExpr: "*/15 * * * *",
        reason: "Health check",
        createdBy: "adjutant",
        createdAt: "2026-03-24T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-03-24T00:15:00Z",
        enabled: false,
        maxFires: null,
        fireCount: 0,
        targetAgent: "adjutant-coordinator",
        targetTmuxSession: "adj-swarm-adjutant-coordinator",
      };
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(existingSchedule);

      const handler = getToolHandler("resume_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { id: "sched-1" },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.id).toBe("sched-1");
      expect(parsed.enabled).toBe(true);
      expect(parsed.nextFireAt).toBeDefined();
      expect(cronScheduleStore.update).toHaveBeenCalledWith(
        "sched-1",
        expect.objectContaining({ enabled: true }),
      );
      expect(stimulusEngine.registerRecurringSchedule).toHaveBeenCalled();
    });

    it("should return error when schedule not found", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant");
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const handler = getToolHandler("resume_schedule", { cronScheduleStore });

      const result = await handler(
        { id: "nonexistent" },
        { sessionId: "session-1" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("not found");
    });
  });

  // ==========================================================================
  // Phase 4: Agent-scoped access control (adj-163.4)
  // ==========================================================================

  describe("adj-163.4: self-scheduling — non-coordinator agents can use scheduling tools", () => {
    it("should allow a non-coordinator agent to create a schedule for itself", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.create as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-nova-1",
        cronExpr: "*/30 * * * *",
        reason: "Self health check",
        createdBy: "nova",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:30:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      } satisfies CronSchedule);

      const handler = getToolHandler("create_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { cron: "*/30 * * * *", reason: "Self health check" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.id).toBe("sched-nova-1");

      // Verify store.create was called with targetAgent = caller
      expect(cronScheduleStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: "nova",
          targetAgent: "nova",
          targetTmuxSession: "adj-swarm-nova",
        }),
      );
    });

    it("should default targetAgent to caller when not provided (backwards compat for coordinator)", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant-coordinator");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();

      const handler = getToolHandler("create_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      await handler(
        { cron: "*/15 * * * *", reason: "Check agent health" },
        { sessionId: "session-coord" },
      );

      // Should default targetAgent to the caller (coordinator)
      expect(cronScheduleStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: "adjutant-coordinator",
          targetAgent: "adjutant-coordinator",
          targetTmuxSession: "adj-swarm-adjutant-coordinator",
        }),
      );
    });
  });

  describe("adj-163.4: targetAgent parameter on create_schedule", () => {
    it("should allow coordinator to create a schedule targeting another agent", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant-coordinator");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.create as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-targeted-1",
        cronExpr: "0 * * * *",
        reason: "Hourly wake for nova",
        createdBy: "adjutant-coordinator",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T01:00:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      } satisfies CronSchedule);

      const handler = getToolHandler("create_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { cron: "0 * * * *", reason: "Hourly wake for nova", targetAgent: "nova" },
        { sessionId: "session-coord" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);

      expect(cronScheduleStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          targetAgent: "nova",
          targetTmuxSession: "adj-swarm-nova",
        }),
      );
    });

    it("should reject non-coordinator agent trying to target another agent", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();

      const handler = getToolHandler("create_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { cron: "*/30 * * * *", reason: "Poke raynor", targetAgent: "raynor" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("only create schedules for yourself");
    });

    it("should allow non-coordinator agent to explicitly target itself", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.create as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-self-1",
        cronExpr: "*/30 * * * *",
        reason: "Self-reminder",
        createdBy: "nova",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:30:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      } satisfies CronSchedule);

      const handler = getToolHandler("create_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { cron: "*/30 * * * *", reason: "Self-reminder", targetAgent: "nova" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe("adj-163.4: ownership filtering on list_schedules", () => {
    const allSchedules: CronSchedule[] = [
      {
        id: "sched-coord-1",
        cronExpr: "*/15 * * * *",
        reason: "Coordinator schedule",
        createdBy: "adjutant-coordinator",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:15:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "adjutant-coordinator",
        targetTmuxSession: "adj-swarm-adjutant-coordinator",
      },
      {
        id: "sched-nova-1",
        cronExpr: "*/30 * * * *",
        reason: "Nova schedule",
        createdBy: "nova",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:30:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      },
    ];

    it("should return all schedules when called by coordinator", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant-coordinator");
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.listAll as ReturnType<typeof vi.fn>).mockReturnValue(allSchedules);

      const handler = getToolHandler("list_schedules", { cronScheduleStore });
      const result = await handler({}, { sessionId: "session-coord" });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.schedules).toEqual(allSchedules);
      expect(cronScheduleStore.listAll).toHaveBeenCalled();
    });

    it("should return only own schedules when called by non-coordinator agent", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const cronScheduleStore = createMockCronScheduleStore();
      const novaSchedules = [allSchedules[1]];
      (cronScheduleStore.listByAgent as ReturnType<typeof vi.fn>).mockReturnValue(novaSchedules);

      const handler = getToolHandler("list_schedules", { cronScheduleStore });
      const result = await handler({}, { sessionId: "session-nova" });

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.schedules).toEqual(novaSchedules);
      expect(cronScheduleStore.listByAgent).toHaveBeenCalledWith("nova");
    });
  });

  describe("adj-163.4: ownership enforcement on cancel_schedule", () => {
    it("should allow an agent to cancel its own schedule", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-nova-1",
        cronExpr: "*/30 * * * *",
        reason: "Nova schedule",
        createdBy: "nova",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:30:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      } satisfies CronSchedule);

      const handler = getToolHandler("cancel_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { id: "sched-nova-1" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(cronScheduleStore.delete).toHaveBeenCalledWith("sched-nova-1");
    });

    it("should reject a non-coordinator agent canceling another agent's schedule", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-raynor-1",
        cronExpr: "*/15 * * * *",
        reason: "Raynor schedule",
        createdBy: "raynor",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:15:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "raynor",
        targetTmuxSession: "adj-swarm-raynor",
      } satisfies CronSchedule);

      const handler = getToolHandler("cancel_schedule", { cronScheduleStore });

      const result = await handler(
        { id: "sched-raynor-1" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("Access denied");
    });

    it("should allow coordinator to cancel any agent's schedule", async () => {
      mockGetAgentBySession.mockReturnValue("adjutant-coordinator");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-nova-1",
        cronExpr: "*/30 * * * *",
        reason: "Nova schedule",
        createdBy: "nova",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:30:00Z",
        enabled: true,
        maxFires: null,
        fireCount: 0,
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      } satisfies CronSchedule);

      const handler = getToolHandler("cancel_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { id: "sched-nova-1" },
        { sessionId: "session-coord" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe("adj-163.4: ownership enforcement on pause_schedule", () => {
    it("should allow an agent to pause its own schedule", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-nova-1",
        targetAgent: "nova",
      });

      const handler = getToolHandler("pause_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { id: "sched-nova-1" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(cronScheduleStore.disable).toHaveBeenCalledWith("sched-nova-1");
    });

    it("should reject a non-coordinator agent pausing another agent's schedule", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-raynor-1",
        targetAgent: "raynor",
      });

      const handler = getToolHandler("pause_schedule", { cronScheduleStore });

      const result = await handler(
        { id: "sched-raynor-1" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("Access denied");
    });
  });

  describe("adj-163.4: ownership enforcement on resume_schedule", () => {
    it("should allow an agent to resume its own schedule", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const stimulusEngine = createMockStimulusEngine();
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-nova-1",
        cronExpr: "*/30 * * * *",
        reason: "Nova schedule",
        createdBy: "nova",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:30:00Z",
        enabled: false,
        maxFires: null,
        fireCount: 0,
        targetAgent: "nova",
        targetTmuxSession: "adj-swarm-nova",
      } satisfies CronSchedule);

      const handler = getToolHandler("resume_schedule", {
        stimulusEngine,
        cronScheduleStore,
      });

      const result = await handler(
        { id: "sched-nova-1" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.enabled).toBe(true);
    });

    it("should reject a non-coordinator agent resuming another agent's schedule", async () => {
      mockGetAgentBySession.mockReturnValue("nova");
      const cronScheduleStore = createMockCronScheduleStore();
      (cronScheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "sched-raynor-1",
        cronExpr: "*/15 * * * *",
        reason: "Raynor schedule",
        createdBy: "raynor",
        createdAt: "2026-04-21T00:00:00Z",
        lastFiredAt: null,
        nextFireAt: "2026-04-21T00:15:00Z",
        enabled: false,
        maxFires: null,
        fireCount: 0,
        targetAgent: "raynor",
        targetTmuxSession: "adj-swarm-raynor",
      } satisfies CronSchedule);

      const handler = getToolHandler("resume_schedule", { cronScheduleStore });

      const result = await handler(
        { id: "sched-raynor-1" },
        { sessionId: "session-nova" },
      );

      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("Access denied");
    });
  });
});
