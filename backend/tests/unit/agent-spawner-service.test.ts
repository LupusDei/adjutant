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

import { logInfo, logWarn } from "../../src/utils/index.js";

describe("agent-spawner-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // getAgentTmuxSession
  // ==========================================================================

  describe("getAgentTmuxSession", () => {
    it("should compute correct session name", () => {
      expect(getAgentTmuxSession("foo")).toBe("adj-swarm-foo");
    });

    it("should handle multi-word names", () => {
      expect(getAgentTmuxSession("adjutant-coordinator")).toBe(
        "adj-swarm-adjutant-coordinator"
      );
    });
  });

  // ==========================================================================
  // spawnAgent
  // ==========================================================================

  describe("spawnAgent", () => {
    it("should spawn agent via session bridge createSession", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledOnce();
      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "test-agent",
          projectPath: "/tmp/project",
          mode: "swarm",
        })
      );
    });

    it("should return success with sessionId on successful spawn", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "session-123",
      });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe("session-123");
      expect(result.tmuxSession).toBe("adj-swarm-test-agent");
    });

    it("should skip spawn if tmux session already exists", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent", "adj-swarm-other"])
      );
      mockFindByTmuxSession.mockReturnValue({ name: "test-agent" });

      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
    });

    it("should re-register orphaned session via discoverSessions", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent"])
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

      expect(mockDiscoverSessions).toHaveBeenCalledWith(
        "adj-swarm-test-agent"
      );
      expect(rediscovered.name).toBe("test-agent");
      expect(rediscovered.projectPath).toBe("/tmp/project");
      expect(mockRegistrySave).toHaveBeenCalled();
      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
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
        agentFile: "myagent",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          claudeArgs: expect.arrayContaining(["--agent", "myagent"]),
        })
      );
    });

    it("should not include --agent flag when agentFile omitted", async () => {
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
      // claudeArgs should either not exist or not contain "--agent"
      if (callArgs.claudeArgs) {
        expect(callArgs.claudeArgs).not.toContain("--agent");
      }
    });

    it("should merge additional claudeArgs with --agent flag", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        agentFile: "myagent",
        claudeArgs: ["--verbose"],
      });

      const callArgs = mockBridgeCreateSession.mock.calls[0][0];
      expect(callArgs.claudeArgs).toContain("--agent");
      expect(callArgs.claudeArgs).toContain("myagent");
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
      // Mock everything to throw
      mockListTmuxSessions.mockRejectedValue(new Error("tmux died"));

      // Also make bridge throw if reached
      mockBridgeCreateSession.mockRejectedValue(
        new Error("bridge exploded")
      );

      // Should not throw
      const result = await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should use 'swarm' as default mode", async () => {
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

    it("should pass custom mode through to createSession", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
        mode: "standalone",
      });

      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "standalone" })
      );
    });

    it("should log spawn info on success", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: true,
        sessionId: "s1",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(logInfo).toHaveBeenCalledWith(
        "Agent spawned",
        expect.objectContaining({ name: "test-agent", sessionId: "s1" })
      );
    });

    it("should log warning on spawn failure", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
        success: false,
        error: "limit exceeded",
      });

      await spawnAgent({
        name: "test-agent",
        projectPath: "/tmp/project",
      });

      expect(logWarn).toHaveBeenCalledWith(
        "Agent spawn failed",
        expect.objectContaining({ name: "test-agent", error: "limit exceeded" })
      );
    });
  });

  // ==========================================================================
  // isAgentAlive
  // ==========================================================================

  describe("isAgentAlive", () => {
    it("should return true when session exists", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-test-agent", "adj-swarm-other"])
      );

      const alive = await isAgentAlive("test-agent");
      expect(alive).toBe(true);
    });

    it("should return false when session missing", async () => {
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
