import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock event bus
const mockEmit = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockEventBus = { emit: mockEmit, on: mockOn, off: mockOff };

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => mockEventBus,
}));

// Mock session bridge
const mockBridgeCreateSession = vi.fn();
const mockDiscoverSessions = vi.fn();
const mockRegistrySave = vi.fn();
const mockFindByTmuxSession = vi.fn();
const mockLifecycle = { discoverSessions: mockDiscoverSessions };
const mockRegistry = {
  findByTmuxSession: mockFindByTmuxSession,
  save: mockRegistrySave,
};
const mockBridge = {
  lifecycle: mockLifecycle,
  registry: mockRegistry,
  createSession: mockBridgeCreateSession,
  init: vi.fn(),
};

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => mockBridge,
}));

// Mock tmux
const mockListTmuxSessions = vi.fn();
vi.mock("../../src/services/tmux.js", () => ({
  listTmuxSessions: () => mockListTmuxSessions(),
}));

import {
  spawnAgent,
  cancelSpawnHealthCheck,
  pendingHealthCheckCount,
  wireSpawnHealthChecks,
  SPAWN_HEALTH_CHECK_DELAY_MS,
} from "../../src/services/agent-spawner-service.js";

describe("spawn-health-check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Cancel any pending health checks to avoid leaking timers
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // ==========================================================================
  // SPAWN_HEALTH_CHECK_DELAY_MS
  // ==========================================================================

  it("should use 30 second delay constant", () => {
    expect(SPAWN_HEALTH_CHECK_DELAY_MS).toBe(30_000);
  });

  // ==========================================================================
  // Timer scheduling after spawn
  // ==========================================================================

  describe("health check timer scheduling", () => {
    it("should schedule a health check timer after successful spawn", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      const countBefore = pendingHealthCheckCount();
      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(pendingHealthCheckCount()).toBe(countBefore + 1);
    });

    it("should NOT schedule a health check when spawn fails", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: false,
        error: "session limit reached",
      });

      const countBefore = pendingHealthCheckCount();
      await spawnAgent({
        name: "failed-agent",
        projectPath: "/tmp/project",
      });

      expect(pendingHealthCheckCount()).toBe(countBefore);
    });

    it("should NOT schedule a health check when session already exists", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set(["adj-swarm-existing"]));
      mockFindByTmuxSession.mockReturnValue({ name: "existing" });

      const countBefore = pendingHealthCheckCount();
      await spawnAgent({
        name: "existing",
        projectPath: "/tmp/project",
      });

      expect(pendingHealthCheckCount()).toBe(countBefore);
    });
  });

  // ==========================================================================
  // Duplicate spawn race condition
  // ==========================================================================

  describe("duplicate spawn for same agent", () => {
    it("should cancel first timer when spawning same agent twice", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      // First spawn
      await spawnAgent({
        name: "dup-agent",
        projectPath: "/tmp/project",
      });
      expect(pendingHealthCheckCount()).toBe(1);

      // Second spawn for same agent (simulates retry)
      // Need to reset tmux mock so it doesn't see existing session
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s2",
      });

      await spawnAgent({
        name: "dup-agent",
        projectPath: "/tmp/project",
      });

      // Should still only have 1 pending check (not 2)
      expect(pendingHealthCheckCount()).toBe(1);

      // Advance past timeout — should only get ONE spawn_failed event
      vi.advanceTimersByTime(SPAWN_HEALTH_CHECK_DELAY_MS + 1);

      const spawnFailedCalls = mockEmit.mock.calls.filter(
        (call: unknown[]) => call[0] === "agent:spawn_failed",
      );
      expect(spawnFailedCalls).toHaveLength(1);
    });
  });

  // ==========================================================================
  // spawn_failed event on timer expiry
  // ==========================================================================

  describe("spawn_failed event emission", () => {
    it("should emit agent:spawn_failed when timer expires", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "slow-agent",
        projectPath: "/tmp/project",
      });

      // Timer hasn't expired yet
      expect(mockEmit).not.toHaveBeenCalledWith(
        "agent:spawn_failed",
        expect.anything(),
      );

      // Advance past the health check delay
      vi.advanceTimersByTime(SPAWN_HEALTH_CHECK_DELAY_MS + 1);

      expect(mockEmit).toHaveBeenCalledWith("agent:spawn_failed", {
        agentId: "slow-agent",
        reason: "no_mcp_connect",
        tmuxSession: "adj-swarm-slow-agent",
      });
    });

    it("should remove agent from pending checks after timer expires", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "expired-agent",
        projectPath: "/tmp/project",
      });

      const countAfterSpawn = pendingHealthCheckCount();
      vi.advanceTimersByTime(SPAWN_HEALTH_CHECK_DELAY_MS + 1);

      expect(pendingHealthCheckCount()).toBe(countAfterSpawn - 1);
    });
  });

  // ==========================================================================
  // cancelSpawnHealthCheck
  // ==========================================================================

  describe("cancelSpawnHealthCheck", () => {
    it("should return true and cancel timer for a pending agent", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "cancel-me",
        projectPath: "/tmp/project",
      });

      const countBefore = pendingHealthCheckCount();
      const result = cancelSpawnHealthCheck("cancel-me");

      expect(result).toBe(true);
      expect(pendingHealthCheckCount()).toBe(countBefore - 1);
    });

    it("should prevent spawn_failed event after cancellation", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "cancelled-agent",
        projectPath: "/tmp/project",
      });

      cancelSpawnHealthCheck("cancelled-agent");

      // Advance past timeout — event should NOT fire
      vi.advanceTimersByTime(SPAWN_HEALTH_CHECK_DELAY_MS + 1);

      expect(mockEmit).not.toHaveBeenCalledWith(
        "agent:spawn_failed",
        expect.objectContaining({ agentId: "cancelled-agent" }),
      );
    });

    it("should return false for unknown agent", () => {
      const result = cancelSpawnHealthCheck("nonexistent-agent");
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // wireSpawnHealthChecks
  // ==========================================================================

  describe("wireSpawnHealthChecks", () => {
    it("should subscribe to mcp:agent_connected events", () => {
      wireSpawnHealthChecks();

      expect(mockOn).toHaveBeenCalledWith(
        "mcp:agent_connected",
        expect.any(Function),
      );
    });

    it("should cancel health check when agent connects via MCP", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      // Spawn an agent to create a pending health check
      await spawnAgent({
        name: "wired-agent",
        projectPath: "/tmp/project",
      });

      // Capture the handler registered by wireSpawnHealthChecks
      wireSpawnHealthChecks();
      const handler = mockOn.mock.calls.find(
        (call: unknown[]) => call[0] === "mcp:agent_connected",
      )?.[1] as ((data: { agentId: string; sessionId: string }) => void) | undefined;

      expect(handler).toBeDefined();

      const countBefore = pendingHealthCheckCount();

      // Simulate MCP connection event
      handler!({ agentId: "wired-agent", sessionId: "mcp-session-1" });

      expect(pendingHealthCheckCount()).toBe(countBefore - 1);

      // Advance past timeout — event should NOT fire
      vi.advanceTimersByTime(SPAWN_HEALTH_CHECK_DELAY_MS + 1);
      expect(mockEmit).not.toHaveBeenCalledWith(
        "agent:spawn_failed",
        expect.objectContaining({ agentId: "wired-agent" }),
      );
    });
  });
});
