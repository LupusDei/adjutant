import { describe, it, expect, vi, beforeEach } from "vitest";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
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
  isAgentAlive,
  getAgentTmuxSession,
} from "../../src/services/agent-spawner-service.js";

import { logInfo } from "../../src/utils/index.js";

describe("agent-spawner-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // getAgentTmuxSession
  // ==========================================================================

  describe("getAgentTmuxSession", () => {
    it("should compute correct tmux session name", () => {
      expect(getAgentTmuxSession("my-agent")).toBe("adj-swarm-my-agent");
    });

    it("should handle complex names", () => {
      expect(getAgentTmuxSession("adjutant-coordinator")).toBe(
        "adj-swarm-adjutant-coordinator"
      );
    });
  });

  // ==========================================================================
  // spawnAgent
  // ==========================================================================

  describe("spawnAgent", () => {
    it("should spawn agent via createSession when no existing session", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set(["adj-swarm-other"]));
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe("s1");
      expect(mockBridgeCreateSession).toHaveBeenCalledOnce();
      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "test-agent",
          projectPath: "/tmp/project",
          mode: "swarm",
        })
      );
    });

    it("should return success with sessionId", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "abc-123",
      });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe("abc-123");
    });

    it("should skip spawn if tmux session exists and is in registry", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent", "adj-swarm-other"])
      );
      mockFindByTmuxSession.mockReturnValue({ name: "test-agent" });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.tmuxSession).toBe("adj-swarm-test-agent");
      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
      expect(mockDiscoverSessions).not.toHaveBeenCalled();
    });

    it("should re-register orphaned session via discoverSessions", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent", "adj-swarm-other"])
      );
      // First call: not in registry. Second call (after discover): found.
      const rediscovered = {
        name: "adj-swarm-test-agent",
        projectPath: ".",
      };
      mockFindByTmuxSession
        .mockReturnValueOnce(undefined) // Before discover
        .mockReturnValueOnce(rediscovered); // After discover
      mockDiscoverSessions.mockResolvedValue(["s1"]);
      mockRegistrySave.mockResolvedValue(undefined);

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(mockDiscoverSessions).toHaveBeenCalledWith(
        "adj-swarm-test-agent"
      );
      expect(rediscovered.name).toBe("test-agent");
      expect(rediscovered.projectPath).toBe("/tmp/project");
      expect(mockRegistrySave).toHaveBeenCalled();
      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining("Re-registered orphaned"),
        expect.objectContaining({ name: "test-agent" })
      );
    });

    it("should include --agent flag when agentFile provided", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        agentFile: "adjutant",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          claudeArgs: expect.arrayContaining(["--agent", "adjutant"]),
        })
      );
    });

    it("should not include --agent when agentFile omitted", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      // claudeArgs should either be undefined/empty or not contain --agent
      if (callArgs.claudeArgs) {
        expect(callArgs.claudeArgs).not.toContain("--agent");
      }
    });

    it("should merge extra claudeArgs with agentFile args", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        agentFile: "adjutant",
        claudeArgs: ["--verbose"],
      });

      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      expect(callArgs.claudeArgs).toContain("--agent");
      expect(callArgs.claudeArgs).toContain("adjutant");
      expect(callArgs.claudeArgs).toContain("--verbose");
    });

    it("should return error on spawn failure", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: false,
        error: "session limit reached",
      });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("session limit reached");
    });

    it("should never throw", async () => {
      // Simulate tmux listing throwing
      mockListTmuxSessions.mockRejectedValue(new Error("tmux not running"));

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      // Should return error result, not throw
      expect(result.success).toBeDefined();
    });

    it("should never throw even when createSession throws", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockRejectedValue(
        new Error("unexpected error")
      );

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should use default mode 'swarm' when not specified", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "swarm" })
      );
    });

    it("should use provided mode when specified", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        mode: "swarm",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "swarm" })
      );
    });

    it("should return tmuxSession name on success", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.tmuxSession).toBe("adj-swarm-test-agent");
    });
  });

  // ==========================================================================
  // isAgentAlive
  // ==========================================================================

  describe("isAgentAlive", () => {
    it("should return true when tmux session exists", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent", "adj-swarm-other"])
      );

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(true);
    });

    it("should return false when tmux session does not exist", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-other"])
      );

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(false);
    });

    it("should return false when no tmux sessions exist", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(false);
    });

    it("should return false when listTmuxSessions fails", async () => {
      mockListTmuxSessions.mockRejectedValue(new Error("tmux not running"));

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(false);
    });
  });
});
