import { describe, it, expect, vi, beforeEach } from "vitest";
import { LifecycleManager } from "../../src/services/lifecycle-manager.js";
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

describe("LifecycleManager", () => {
  let registry: SessionRegistry;
  let lifecycle: LifecycleManager;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new SessionRegistry("/tmp/test-sessions.json");
    lifecycle = new LifecycleManager(registry, 5);

    // Default: tmux commands succeed; list-panes returns a valid pane
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        if (args[0] === "list-panes") {
          // Find the session name from -t arg and return a realistic pane reference
          const tIdx = args.indexOf("-t");
          const sessionName = tIdx >= 0 ? args[tIdx + 1] : "test";
          cb(null, `${sessionName}:1.1\n`, "");
        } else {
          cb(null, "", "");
        }
      }
    );
  });

  /**
   * Helper to build a mock that handles has-session (fail) and list-panes
   * (return correct pane reference). The list-panes response respects the
   * tmux session name passed to createSession.
   */
  function mockTmuxForCreate(sessionName: string) {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        if (args[0] === "has-session") {
          cb(new Error("no session"), "", "no session");
        } else if (args[0] === "list-panes") {
          // Return a pane reference like tmux would with base-index 1
          cb(null, `${sessionName}:1.1\n`, "");
        } else {
          cb(null, "", "");
        }
      }
    );
  }

  // ==========================================================================
  // Create session
  // ==========================================================================

  describe("createSession", () => {

    it("should create a tmux session and register it", async () => {
      mockTmuxForCreate("adj-test-agent");

      const result = await lifecycle.createSession({
        name: "test-agent",
        projectPath: "/home/user/project",
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(registry.size).toBe(1);
    });

    it("should register the correct tmux pane from list-panes", async () => {
      mockTmuxForCreate("adj-pane-test");

      const result = await lifecycle.createSession({
        name: "pane-test",
        projectPath: "/home/user/project",
      });

      expect(result.success).toBe(true);
      const session = registry.get(result.sessionId!);
      // Should use the pane reference returned by list-panes, not a hardcoded :0.0
      expect(session?.tmuxPane).toBe("adj-pane-test:1.1");
    });

    it("should use default claudeArgs", async () => {
      mockTmuxForCreate("adj-test");

      await lifecycle.createSession({
        name: "test",
        projectPath: "/tmp",
      });

      // Verify claude was started with --dangerously-skip-permissions
      const sendKeysCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])[0] === "send-keys"
      );
      expect(sendKeysCalls.length).toBeGreaterThan(0);
      const lastCall = sendKeysCalls[sendKeysCalls.length - 1];
      expect((lastCall[1] as string[]).join(" ")).toContain(
        "--dangerously-skip-permissions"
      );
    });

    it("should use custom claudeArgs", async () => {
      mockTmuxForCreate("adj-test");

      await lifecycle.createSession({
        name: "test",
        projectPath: "/tmp",
        claudeArgs: ["--model", "opus"],
      });

      const sendKeysCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])[0] === "send-keys"
      );
      const lastCall = sendKeysCalls[sendKeysCalls.length - 1];
      expect((lastCall[1] as string[]).join(" ")).toContain("--model opus");
    });

    it("should fail when session limit is reached", async () => {
      // Fill up to limit
      for (let i = 0; i < 5; i++) {
        registry.create({
          name: `agent-${i}`,
          tmuxSession: `adj-${i}`,
          projectPath: "/tmp",
        });
      }

      const result = await lifecycle.createSession({
        name: "one-too-many",
        projectPath: "/tmp",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Session limit reached");
    });

    it("should fail when tmux session already exists", async () => {
      // has-session succeeds (session exists)
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          cb(null, "", ""); // success means session exists
        }
      );

      const result = await lifecycle.createSession({
        name: "existing",
        projectPath: "/tmp",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should fail when tmux new-session fails", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          if (args[0] === "has-session") {
            cb(new Error("no session"), "", "no session");
          } else if (args[0] === "new-session") {
            cb(new Error("tmux error"), "", "tmux error");
          } else {
            cb(null, "", "");
          }
        }
      );

      const result = await lifecycle.createSession({
        name: "fail",
        projectPath: "/tmp",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should set session status to idle after creation", async () => {
      mockTmuxForCreate("adj-worker");

      const result = await lifecycle.createSession({
        name: "worker",
        projectPath: "/tmp",
      });

      const session = registry.get(result.sessionId!);
      expect(session?.status).toBe("idle");
    });
  });

  // ==========================================================================
  // Generate tmux name
  // ==========================================================================

  describe("tmux naming", () => {
    it("should prefix default-mode sessions with adj-", async () => {
      mockTmuxForCreate("adj-myagent");

      await lifecycle.createSession({
        name: "myagent",
        projectPath: "/tmp",
      });

      // Check the new-session call
      const newSessionCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => (call[1] as string[])[0] === "new-session"
      );
      expect(newSessionCall).toBeDefined();
      expect((newSessionCall![1] as string[]).indexOf("adj-myagent")).toBeGreaterThan(-1);
    });

    it("should prefix swarm sessions with adj-swarm-", async () => {
      mockTmuxForCreate("adj-swarm-worker1");

      await lifecycle.createSession({
        name: "worker1",
        projectPath: "/tmp",
        mode: "swarm",
      });

      const newSessionCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => (call[1] as string[])[0] === "new-session"
      );
      expect(
        (newSessionCall![1] as string[]).indexOf("adj-swarm-worker1")
      ).toBeGreaterThan(-1);
    });

    it("should use name directly for gastown mode", async () => {
      mockTmuxForCreate("mayor");

      await lifecycle.createSession({
        name: "mayor",
        projectPath: "/tmp",
        mode: "gastown",
      });

      const newSessionCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => (call[1] as string[])[0] === "new-session"
      );
      expect((newSessionCall![1] as string[]).indexOf("mayor")).toBeGreaterThan(-1);
    });

    it("should sanitize special characters in names", async () => {
      mockTmuxForCreate("adj-my-agent-1");

      await lifecycle.createSession({
        name: "my agent/1",
        projectPath: "/tmp",
      });

      const newSessionCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => (call[1] as string[])[0] === "new-session"
      );
      const tmuxName = (newSessionCall![1] as string[])[3]; // -s <name>
      expect(tmuxName).not.toContain(" ");
      expect(tmuxName).not.toContain("/");
    });
  });

  // ==========================================================================
  // Kill session
  // ==========================================================================

  describe("killSession", () => {
    it("should kill a tmux session and remove from registry", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const killed = await lifecycle.killSession(session.id);
      expect(killed).toBe(true);
      expect(registry.get(session.id)).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it("should return false for unknown session", async () => {
      const killed = await lifecycle.killSession("nonexistent");
      expect(killed).toBe(false);
    });

    it("should handle tmux kill-session failure gracefully", async () => {
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
          cb(new Error("already dead"), "", "already dead");
        }
      );

      const killed = await lifecycle.killSession(session.id);
      expect(killed).toBe(true); // Still succeeds (session removed)
      expect(registry.get(session.id)).toBeUndefined();
    });
  });

  // ==========================================================================
  // Is alive
  // ==========================================================================

  describe("isAlive", () => {
    it("should return true when tmux session exists", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const alive = await lifecycle.isAlive(session.id);
      expect(alive).toBe(true);
    });

    it("should return false when tmux session is gone", async () => {
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
          cb(new Error("no session"), "", "no session");
        }
      );

      const alive = await lifecycle.isAlive(session.id);
      expect(alive).toBe(false);
    });

    it("should return false for unknown session ID", async () => {
      const alive = await lifecycle.isAlive("nonexistent");
      expect(alive).toBe(false);
    });
  });

  // ==========================================================================
  // Discover sessions
  // ==========================================================================

  describe("discoverSessions", () => {
    /**
     * Helper to mock list-sessions + list-panes for discovery tests.
     * Returns pane references that match each session name.
     */
    function mockTmuxForDiscover(sessionNames: string[]) {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          if (args[0] === "list-sessions") {
            cb(null, sessionNames.join("\n") + "\n", "");
          } else if (args[0] === "list-panes") {
            // Extract session name from -t argument
            const tIdx = args.indexOf("-t");
            const sessionName = tIdx >= 0 ? args[tIdx + 1] : "unknown";
            cb(null, `${sessionName}:1.1\n`, "");
          } else {
            cb(null, "", "");
          }
        }
      );
    }

    it("should discover tmux sessions and register them", async () => {
      mockTmuxForDiscover(["adj-worker1", "adj-worker2", "other-session"]);

      const discovered = await lifecycle.discoverSessions();
      expect(discovered).toHaveLength(3);
      expect(registry.size).toBe(3);
    });

    it("should register discovered sessions with correct pane reference", async () => {
      mockTmuxForDiscover(["adj-worker1"]);

      const discovered = await lifecycle.discoverSessions();
      expect(discovered).toHaveLength(1);

      const session = registry.get(discovered[0]);
      expect(session?.tmuxPane).toBe("adj-worker1:1.1");
    });

    it("should filter by prefix", async () => {
      mockTmuxForDiscover(["adj-worker1", "adj-worker2", "other-session"]);

      const discovered = await lifecycle.discoverSessions("adj-");
      expect(discovered).toHaveLength(2);
    });

    it("should skip already registered sessions", async () => {
      registry.create({
        name: "adj-worker1",
        tmuxSession: "adj-worker1",
        projectPath: "/tmp",
      });

      mockTmuxForDiscover(["adj-worker1", "adj-worker2"]);

      const discovered = await lifecycle.discoverSessions();
      expect(discovered).toHaveLength(1); // only worker2 is new
      expect(registry.size).toBe(2); // 1 pre-existing + 1 discovered
    });

    it("should return empty array when tmux is not running", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          cb(new Error("no server running"), "", "no server running");
        }
      );

      const discovered = await lifecycle.discoverSessions();
      expect(discovered).toEqual([]);
    });
  });

  // ==========================================================================
  // Session limit
  // ==========================================================================

  describe("sessionLimit", () => {
    it("should expose the configured limit", () => {
      expect(lifecycle.sessionLimit).toBe(5);
    });

    it("should default to 10 if not configured", () => {
      const defaultLifecycle = new LifecycleManager(registry);
      expect(defaultLifecycle.sessionLimit).toBe(10);
    });
  });
});
