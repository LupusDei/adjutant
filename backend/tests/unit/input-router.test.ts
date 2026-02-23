import { describe, it, expect, vi, beforeEach } from "vitest";
import { InputRouter } from "../../src/services/input-router.js";
import { SessionRegistry } from "../../src/services/session-registry.js";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock child_process
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

describe("InputRouter", () => {
  let registry: SessionRegistry;
  let router: InputRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new SessionRegistry("/tmp/test-sessions.json");
    router = new InputRouter(registry);

    // Default: tmux commands succeed
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(null, "", "");
      }
    );
  });

  // ==========================================================================
  // Send input
  // ==========================================================================

  describe("sendInput", () => {
    it("should send text to an idle session via tmux send-keys", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      const sent = await router.sendInput(session.id, "Hello world");
      expect(sent).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "-l", "Hello world"],
        expect.anything(),
        expect.any(Function)
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "Enter"],
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should deliver input immediately even when session is working", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "working");

      const sent = await router.sendInput(session.id, "immediate message");
      expect(sent).toBe(true);

      // Should have called tmux directly, not queued
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "-l", "immediate message"],
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should return false for unknown session", async () => {
      const sent = await router.sendInput("nonexistent", "hello");
      expect(sent).toBe(false);
    });

    it("should return false for offline session", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "offline");

      const sent = await router.sendInput(session.id, "hello");
      expect(sent).toBe(false);
    });

    it("should return false if tmux send-keys fails on idle session", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          cb(new Error("tmux error"), "", "tmux error");
        }
      );

      const sent = await router.sendInput(session.id, "hello");
      expect(sent).toBe(false);
    });
  });

  // ==========================================================================
  // Permission response
  // ==========================================================================

  describe("sendPermissionResponse", () => {
    it("should send 'y' for approved permission", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const sent = await router.sendPermissionResponse(session.id, true);
      expect(sent).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "-l", "y"],
        expect.anything(),
        expect.any(Function)
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "Enter"],
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should send 'n' for denied permission", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const sent = await router.sendPermissionResponse(session.id, false);
      expect(sent).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "-l", "n"],
        expect.anything(),
        expect.any(Function)
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "Enter"],
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should return false for unknown session", async () => {
      const sent = await router.sendPermissionResponse("unknown", true);
      expect(sent).toBe(false);
    });
  });

  // ==========================================================================
  // Interrupt
  // ==========================================================================

  describe("sendInterrupt", () => {
    it("should send C-c to session", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const sent = await router.sendInterrupt(session.id);
      expect(sent).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "C-c"],
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should clear the input queue on interrupt", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      // Interrupt should clear queue (queue is empty but should not error)
      await router.sendInterrupt(session.id);
      expect(router.getQueueLength(session.id)).toBe(0);
    });

    it("should return false for unknown session", async () => {
      const sent = await router.sendInterrupt("nonexistent");
      expect(sent).toBe(false);
    });

    it("should return false if tmux command fails", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          cb(new Error("fail"), "", "fail");
        }
      );

      const sent = await router.sendInterrupt(session.id);
      expect(sent).toBe(false);
    });
  });

  // ==========================================================================
  // Queue management
  // ==========================================================================

  describe("queue management", () => {
    it("should return 0 when no queue exists", async () => {
      const delivered = await router.flushQueue("any-id");
      expect(delivered).toBe(0);
    });

    it("should clear queue for a session without error", () => {
      router.clearQueue("any-id");
      expect(router.getQueueLength("any-id")).toBe(0);
    });

    it("should clear all queues without error", () => {
      router.clearAllQueues();
      expect(router.getQueueLength("any")).toBe(0);
    });

    it("getQueueLength should return 0 for unknown session", () => {
      expect(router.getQueueLength("unknown")).toBe(0);
    });
  });
});
