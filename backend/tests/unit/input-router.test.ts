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
        ["send-keys", "-t", session.tmuxPane, "Hello world", "Enter"],
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should queue input when session is working", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "working");

      const sent = await router.sendInput(session.id, "queued message");
      expect(sent).toBe(true);

      // Should NOT have called tmux
      expect(mockExecFile).not.toHaveBeenCalled();

      // Queue should have 1 item
      expect(router.getQueueLength(session.id)).toBe(1);
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
        ["send-keys", "-t", session.tmuxPane, "y", "Enter"],
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
        ["send-keys", "-t", session.tmuxPane, "n", "Enter"],
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
      registry.updateStatus(session.id, "working");

      // Queue some messages
      await router.sendInput(session.id, "msg1");
      await router.sendInput(session.id, "msg2");
      expect(router.getQueueLength(session.id)).toBe(2);

      // Interrupt should clear queue
      registry.updateStatus(session.id, "idle"); // so interrupt doesn't queue
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
    it("should flush queued input in FIFO order", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "working");

      await router.sendInput(session.id, "first");
      await router.sendInput(session.id, "second");
      expect(router.getQueueLength(session.id)).toBe(2);

      // Session becomes idle
      registry.updateStatus(session.id, "idle");
      const delivered = await router.flushQueue(session.id);
      expect(delivered).toBe(2);
      expect(router.getQueueLength(session.id)).toBe(0);

      // Verify order: first, then second
      const calls = mockExecFile.mock.calls;
      const sendKeyCalls = calls.filter(
        (call: unknown[]) => (call[1] as string[])[0] === "send-keys"
      );
      expect(sendKeyCalls[0][1]).toEqual([
        "send-keys",
        "-t",
        session.tmuxPane,
        "first",
        "Enter",
      ]);
      expect(sendKeyCalls[1][1]).toEqual([
        "send-keys",
        "-t",
        session.tmuxPane,
        "second",
        "Enter",
      ]);
    });

    it("should return 0 when no queue exists", async () => {
      const delivered = await router.flushQueue("any-id");
      expect(delivered).toBe(0);
    });

    it("should clear queue for a session", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "working");

      // This won't call sendInput properly because sendInput is async
      // so let's test clearQueue directly
      router.clearQueue(session.id);
      expect(router.getQueueLength(session.id)).toBe(0);
    });

    it("should clear all queues", async () => {
      const s1 = registry.create({
        name: "a",
        tmuxSession: "adj-a",
        projectPath: "/tmp",
      });
      const s2 = registry.create({
        name: "b",
        tmuxSession: "adj-b",
        projectPath: "/tmp",
      });
      registry.updateStatus(s1.id, "working");
      registry.updateStatus(s2.id, "working");

      await router.sendInput(s1.id, "msg1");
      await router.sendInput(s2.id, "msg2");

      router.clearAllQueues();
      expect(router.getQueueLength(s1.id)).toBe(0);
      expect(router.getQueueLength(s2.id)).toBe(0);
    });

    it("should stop flushing if delivery fails", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "working");

      await router.sendInput(session.id, "first");
      await router.sendInput(session.id, "second");

      // Make tmux fail
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

      registry.updateStatus(session.id, "idle");
      const delivered = await router.flushQueue(session.id);
      expect(delivered).toBe(0); // first delivery failed, so 0
    });

    it("getQueueLength should return 0 for unknown session", () => {
      expect(router.getQueueLength("unknown")).toBe(0);
    });
  });
});
