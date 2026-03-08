import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  spawnAdjutant,
  isAdjutantAlive,
  ensureAdjutantAlive,
} from "../../src/services/adjutant-spawner.js";

import { logInfo } from "../../src/utils/index.js";

describe("adjutant-spawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // spawnAdjutant
  // ==========================================================================

  describe("spawnAdjutant", () => {
    it("should spawn via bridge.createSession when no existing session", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set(["adj-swarm-other"]));
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });

      await spawnAdjutant("/tmp/project");

      expect(mockBridgeCreateSession).toHaveBeenCalledOnce();
      expect(mockBridgeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "adjutant-coordinator",
          projectPath: "/tmp/project",
          mode: "swarm",
          claudeArgs: ["--agent", "adjutant"],
        })
      );
    });

    it("should skip spawn when session already exists and is in registry", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-adjutant-coordinator", "adj-swarm-other"])
      );
      mockFindByTmuxSession.mockReturnValue({ name: "adjutant-coordinator" });

      await spawnAdjutant("/tmp/project");

      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
      expect(mockDiscoverSessions).not.toHaveBeenCalled();
    });

    it("should re-register orphaned session when tmux exists but not in registry", async () => {
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-adjutant-coordinator", "adj-swarm-other"])
      );
      // First call: not in registry. Second call (after discover): found.
      const rediscovered = { name: "adj-swarm-adjutant-coordinator", projectPath: "." };
      mockFindByTmuxSession
        .mockReturnValueOnce(undefined)   // Before discover
        .mockReturnValueOnce(rediscovered); // After discover
      mockDiscoverSessions.mockResolvedValue(["s1"]);
      mockRegistrySave.mockResolvedValue(undefined);

      await spawnAdjutant("/tmp/project");

      expect(mockDiscoverSessions).toHaveBeenCalledWith("adj-swarm-adjutant-coordinator");
      expect(rediscovered.name).toBe("adjutant-coordinator");
      expect(rediscovered.projectPath).toBe("/tmp/project");
      expect(mockRegistrySave).toHaveBeenCalled();
      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
      expect(logInfo).toHaveBeenCalledWith(
        "Re-registered orphaned agent session",
        expect.objectContaining({ name: "adjutant-coordinator" })
      );
    });

    it("should not throw when createSession fails", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({
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
        new Set(["adj-swarm-adjutant-coordinator", "adj-swarm-other"])
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

  // ==========================================================================
  // ensureAdjutantAlive
  // ==========================================================================

  describe("ensureAdjutantAlive", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return false when Adjutant agent is alive (no recovery needed)", async () => {
      // Adjutant session exists — no recovery needed
      mockListTmuxSessions.mockResolvedValue(
        new Set(["adj-swarm-adjutant-coordinator", "adj-swarm-other"])
      );

      const result = await ensureAdjutantAlive("/tmp/project");
      expect(result).toBe(false);
      // spawnAdjutant should NOT have been called (we mock createSession to verify)
      expect(mockBridgeCreateSession).not.toHaveBeenCalled();
    });

    it("should respawn and return true when Adjutant agent is dead", async () => {
      // First call (isAdjutantAlive): no adjutant session
      // Second call (spawnAdjutant internal check): still no adjutant session
      mockListTmuxSessions.mockResolvedValue(new Set(["adj-swarm-other"]));
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });

      const promise = ensureAdjutantAlive("/tmp/project");

      // Advance past the 10-second stabilization wait
      await vi.advanceTimersByTimeAsync(10_000);

      const result = await promise;
      expect(result).toBe(true);
      expect(mockBridgeCreateSession).toHaveBeenCalledOnce();
    });

    it("should wait 10 seconds during recovery for stabilization", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set());
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });

      let resolved = false;
      const promise = ensureAdjutantAlive("/tmp/project").then((r) => {
        resolved = true;
        return r;
      });

      // Should NOT resolve before 10 seconds
      await vi.advanceTimersByTimeAsync(9_999);
      expect(resolved).toBe(false);

      // Should resolve at 10 seconds
      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);

      await promise;
    });

    it("should return false on recovery error (graceful)", async () => {
      vi.useRealTimers(); // Undo fake timers for this test

      mockListTmuxSessions.mockResolvedValue(new Set()); // dead
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });

      // Replace setTimeout so the stabilization wait throws
      const origSetTimeout = globalThis.setTimeout;
      // Safe cast: we're replacing setTimeout with a function that throws
      // to simulate an unexpected runtime error in the stabilization wait
      globalThis.setTimeout = (() => {
        throw new Error("runtime error");
      }) as unknown as typeof globalThis.setTimeout;

      try {
        const result = await ensureAdjutantAlive("/tmp/project");
        expect(result).toBe(false);
      } finally {
        globalThis.setTimeout = origSetTimeout;
      }
    });

    it("should log recovery event when respawning", async () => {
      mockListTmuxSessions.mockResolvedValue(new Set(["adj-swarm-other"]));
      mockBridgeCreateSession.mockResolvedValue({ success: true, sessionId: "s1" });

      const promise = ensureAdjutantAlive("/tmp/project");
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;

      expect(logInfo).toHaveBeenCalledWith(
        "Adjutant agent recovered",
        expect.objectContaining({ projectPath: "/tmp/project" })
      );
    });
  });
});
