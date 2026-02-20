import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionConnector } from "../../src/services/session-connector.js";
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

// Mock fs
vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

describe("SessionConnector", () => {
  let registry: SessionRegistry;
  let connector: SessionConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new SessionRegistry("/tmp/test-sessions.json");
    connector = new SessionConnector(registry, "/tmp/adjutant-test");

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
  // Output handlers
  // ==========================================================================

  describe("output handlers", () => {
    it("should register output handlers", () => {
      const handler = vi.fn();
      connector.onOutput(handler);
      // No error means registered
      expect(true).toBe(true);
    });

    it("should unregister output handlers", () => {
      const handler = vi.fn();
      connector.onOutput(handler);
      connector.offOutput(handler);
      // No error means unregistered
      expect(true).toBe(true);
    });
  });

  // ==========================================================================
  // Attach
  // ==========================================================================

  describe("attach", () => {
    it("should attach pipe-pane to a session", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const result = await connector.attach(session.id);
      expect(result).toBe(true);
      expect(session.pipeActive).toBe(true);

      // Verify tmux pipe-pane was called
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["pipe-pane", "-o", "-t", session.tmuxPane]),
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should return false for unknown session", async () => {
      const result = await connector.attach("nonexistent");
      expect(result).toBe(false);
    });

    it("should return true if already attached", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      await connector.attach(session.id);
      const result = await connector.attach(session.id);
      expect(result).toBe(true);
    });

    it("should return false if pipe-pane command fails", async () => {
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
          cb(new Error("tmux not running"), "", "tmux not running");
        }
      );

      const result = await connector.attach(session.id);
      expect(result).toBe(false);
    });

    it("should start capture-pane polling on attach", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      await connector.attach(session.id);

      // Verify capture-pane initial snapshot was requested
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["capture-pane", "-t", session.tmuxPane, "-p", "-S", "-500"]),
        expect.anything(),
        expect.any(Function)
      );
    });
  });

  // ==========================================================================
  // Detach
  // ==========================================================================

  describe("detach", () => {
    it("should detach pipe-pane from a session", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      await connector.attach(session.id);
      const result = await connector.detach(session.id);

      expect(result).toBe(true);
      expect(session.pipeActive).toBe(false);
      expect(connector.isAttached(session.id)).toBe(false);
    });

    it("should return false if not attached", async () => {
      const result = await connector.detach("nonexistent");
      expect(result).toBe(false);
    });

    it("should handle tmux errors during detach gracefully", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      await connector.attach(session.id);

      // Make tmux fail on detach
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          cb(new Error("session gone"), "", "session gone");
        }
      );

      const result = await connector.detach(session.id);
      expect(result).toBe(true); // Should still succeed
      expect(connector.isAttached(session.id)).toBe(false);
    });
  });

  // ==========================================================================
  // State queries
  // ==========================================================================

  describe("isAttached", () => {
    it("should return false when not attached", () => {
      expect(connector.isAttached("anything")).toBe(false);
    });

    it("should return true when attached", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      await connector.attach(session.id);
      expect(connector.isAttached(session.id)).toBe(true);
    });
  });

  describe("activePipeCount", () => {
    it("should start at 0", () => {
      expect(connector.activePipeCount).toBe(0);
    });

    it("should track active pipes", async () => {
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

      await connector.attach(s1.id);
      expect(connector.activePipeCount).toBe(1);

      await connector.attach(s2.id);
      expect(connector.activePipeCount).toBe(2);

      await connector.detach(s1.id);
      expect(connector.activePipeCount).toBe(1);
    });
  });

  // ==========================================================================
  // Detach all
  // ==========================================================================

  describe("detachAll", () => {
    it("should detach all active pipes", async () => {
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

      await connector.attach(s1.id);
      await connector.attach(s2.id);
      expect(connector.activePipeCount).toBe(2);

      await connector.detachAll();
      expect(connector.activePipeCount).toBe(0);
    });
  });

  // ==========================================================================
  // Capture pane
  // ==========================================================================

  describe("capturePane", () => {
    it("should capture tmux pane content", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          if (args[0] === "capture-pane") {
            cb(null, "Hello from tmux\nLine 2\n", "");
          } else {
            cb(null, "", "");
          }
        }
      );

      const output = await connector.capturePane(session.id);
      expect(output).toBe("Hello from tmux\nLine 2\n");
    });

    it("should return null for unknown session", async () => {
      const output = await connector.capturePane("nonexistent");
      expect(output).toBeNull();
    });

    it("should return null when capture fails", async () => {
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

      const output = await connector.capturePane(session.id);
      expect(output).toBeNull();
    });
  });

  // ==========================================================================
  // Single output path — no raw pipe reading
  // ==========================================================================

  describe("output deduplication", () => {
    it("should only emit events from capture-pane polling, not from raw pipe reading", async () => {
      const handler = vi.fn();
      connector.onOutput(handler);

      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      await connector.attach(session.id);

      // No handler calls should have occurred from raw pipe reading
      // (the old code would call the handler for every raw line)
      // The only calls should come from capture-pane polling (via setInterval)
      // which won't fire in synchronous test context
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
