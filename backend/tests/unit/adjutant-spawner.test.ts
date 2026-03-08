import { describe, it, expect, vi, beforeEach } from "vitest";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock session bridge
const mockCreateSession = vi.fn();
const mockLifecycle = { createSession: mockCreateSession };
const mockBridge = {
  lifecycle: mockLifecycle,
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
  spawnAdjutant,
  isAdjutantAlive,
} from "../../src/services/adjutant-spawner.js";

describe("adjutant-spawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // spawnAdjutant
  // ==========================================================================

  describe("spawnAdjutant", () => {
    it("should spawn when no existing session", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set(["adj-swarm-other"]));
      mockCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });

      await spawnAdjutant("/tmp/project");

      expect(mockCreateSession).toHaveBeenCalledOnce();
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "adjutant",
          projectPath: "/tmp/project",
          mode: "swarm",
        })
      );
    });

    it("should skip spawn when session already exists", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-adjutant", "adj-swarm-other"])
      );

      await spawnAdjutant("/tmp/project");

      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it("should not throw when createSession fails", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockCreateSession.mockResolvedValue({
        success: false,
        error: "session limit reached",
      });

      // Should not throw
      await expect(spawnAdjutant("/tmp/project")).resolves.toBeUndefined();
    });

    it("should not throw when listTmuxSessions fails", async () => {
      mockListTmuxSessions.mockRejectedValue(new Error("tmux not running"));

      // Should not throw — treat as "no session exists" and try to spawn
      await expect(spawnAdjutant("/tmp/project")).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // isAdjutantAlive
  // ==========================================================================

  describe("isAdjutantAlive", () => {
    it("should return true when session exists", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-adjutant", "adj-swarm-other"])
      );

      const alive = await isAdjutantAlive();
      expect(alive).toBe(true);
    });

    it("should return false when session does not exist", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-other"])
      );

      const alive = await isAdjutantAlive();
      expect(alive).toBe(false);
    });

    it("should return false when no tmux sessions exist", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());

      const alive = await isAdjutantAlive();
      expect(alive).toBe(false);
    });

    it("should return false when listTmuxSessions fails", async () => {
      mockListTmuxSessions.mockRejectedValue(new Error("tmux not running"));

      const alive = await isAdjutantAlive();
      expect(alive).toBe(false);
    });
  });
});
