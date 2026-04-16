import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS managed_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      tmux_session TEXT NOT NULL,
      tmux_pane TEXT NOT NULL,
      project_path TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'swarm',
      status TEXT NOT NULL DEFAULT 'idle',
      workspace_type TEXT NOT NULL DEFAULT 'primary',
      pipe_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_activity TEXT NOT NULL
    )
  `);
  return db;
}

let testDb: Database.Database;

describe("InputRouter", () => {
  let registry: SessionRegistry;
  let router: InputRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDb();
    registry = new SessionRegistry(testDb);
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

  afterEach(() => {
    if (testDb) testDb.close();
  });

  // ==========================================================================
  // Send input
  // ==========================================================================

  describe("sendInput", () => {
    it("should send text via set-buffer + paste-buffer + send-keys Enter", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      const sent = await router.sendInput(session.id, "Hello world");
      expect(sent).toBe(true);

      // Should use set-buffer to load text WITHOUT trailing newline
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["set-buffer", "-b", expect.any(String), "Hello world"]),
        expect.anything(),
        expect.any(Function)
      );
      // Should use paste-buffer to atomically deliver text
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["paste-buffer", "-t", session.tmuxPane]),
        expect.anything(),
        expect.any(Function)
      );
      // Should send Enter separately after delay
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

      // Should have called tmux directly (set-buffer), not queued
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["set-buffer", "-b", expect.any(String), "immediate message"]),
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

    it("should return false if tmux command fails", async () => {
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
    it("should send 'y' for approved permission via paste-buffer + Enter", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const sent = await router.sendPermissionResponse(session.id, true);
      expect(sent).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["set-buffer", "-b", expect.any(String), "y"]),
        expect.anything(),
        expect.any(Function)
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["paste-buffer", "-t", session.tmuxPane]),
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

    it("should send 'n' for denied permission via paste-buffer + Enter", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const sent = await router.sendPermissionResponse(session.id, false);
      expect(sent).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining(["set-buffer", "-b", expect.any(String), "n"]),
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

  // ==========================================================================
  // Two-phase paste + Enter delivery (adj-53kf, adj-twhj)
  // ==========================================================================

  describe("two-phase paste + Enter delivery", () => {
    it("should use set-buffer, paste-buffer, then send-keys Enter in order", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      const callOrder: string[] = [];
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          callOrder.push(args[0]!);
          cb(null, "", "");
        }
      );

      await router.sendInput(session.id, "test message");

      // Phase 1: set-buffer + paste-buffer (atomic text delivery)
      // Phase 2: send-keys Enter (submit after delay)
      expect(callOrder).toEqual(["set-buffer", "paste-buffer", "send-keys"]);
    });

    it("should NOT include trailing newline in buffer content", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      await router.sendInput(session.id, "my prompt");

      // The set-buffer call should NOT include trailing newline —
      // Enter is sent separately to avoid bracketed paste issues
      const setBufferCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => (call[1] as string[])[0] === "set-buffer"
      );
      expect(setBufferCall).toBeDefined();
      const bufferData = (setBufferCall![1] as string[])[3];
      expect(bufferData).toBe("my prompt");
    });

    it("should delete buffer after pasting with -d flag", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      await router.sendInput(session.id, "test");

      const pasteCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => (call[1] as string[])[0] === "paste-buffer"
      );
      expect(pasteCall).toBeDefined();
      const args = pasteCall![1] as string[];
      expect(args).toContain("-d");
    });

    it("should send Enter via send-keys after paste-buffer", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      await router.sendInput(session.id, "test prompt");

      // The send-keys Enter call must come after paste-buffer
      const sendKeysCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => {
          const args = call[1] as string[];
          return args[0] === "send-keys" && args.includes("Enter");
        }
      );
      expect(sendKeysCall).toBeDefined();
      const args = sendKeysCall![1] as string[];
      expect(args).toEqual(["send-keys", "-t", session.tmuxPane, "Enter"]);
    });

    it("should strip trailing newlines from input before pasting", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      await router.sendInput(session.id, "text with newlines\n\n\n");

      const setBufferCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => (call[1] as string[])[0] === "set-buffer"
      );
      const bufferData = (setBufferCall![1] as string[])[3];
      // Should have no trailing newlines — Enter is sent separately
      expect(bufferData).toBe("text with newlines");
    });
  });

  // ==========================================================================
  // Deduplication (adj-53kf)
  // ==========================================================================

  describe("deduplication", () => {
    it("should suppress duplicate text sent to the same pane within 5 seconds", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      // First send should succeed
      const first = await router.sendInput(session.id, "SITUATION -- wake up");
      expect(first).toBe(true);

      // Count tmux calls after first send
      const callsAfterFirst = mockExecFile.mock.calls.length;

      // Second identical send should be suppressed (no new tmux calls)
      const second = await router.sendInput(session.id, "SITUATION -- wake up");
      expect(second).toBe(true); // Returns true (already delivered)
      expect(mockExecFile.mock.calls.length).toBe(callsAfterFirst);
    });

    it("should allow different text to the same pane", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      await router.sendInput(session.id, "first message");
      const callsAfterFirst = mockExecFile.mock.calls.length;

      const result = await router.sendInput(session.id, "different message");
      expect(result).toBe(true);
      // Should have made new tmux calls
      expect(mockExecFile.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it("should allow same text after the dedup window expires", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      // Mock Date.now to control time without affecting setTimeout
      let fakeNow = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

      await router.sendInput(session.id, "repeated prompt");
      const callsAfterFirst = mockExecFile.mock.calls.length;

      // Advance past the dedup window (5 seconds)
      fakeNow += 6_000;

      const result = await router.sendInput(session.id, "repeated prompt");
      expect(result).toBe(true);
      // Should have made new tmux calls (not suppressed)
      expect(mockExecFile.mock.calls.length).toBeGreaterThan(callsAfterFirst);

      vi.spyOn(Date, "now").mockRestore();
    });
  });

  // ==========================================================================
  // Mutation testing: surviving mutations
  // ==========================================================================

  describe("paste-enter delay (mutation: PASTE_ENTER_DELAY_MS = 0)", () => {
    it("should wait before sending Enter after paste-buffer (non-zero delay)", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      let delayObserved = 0;

      // Spy on setTimeout to capture the delay value
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
        (fn: (...args: unknown[]) => void, delay?: number) => {
          delayObserved = delay ?? 0;
          // Execute immediately for test speed, but capture the delay
          fn();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
      );

      await router.sendInput(session.id, "test text");

      // The delay between paste-buffer and send-keys Enter should be > 0
      expect(delayObserved).toBeGreaterThan(0);
      // Specifically, it should be 150ms
      expect(delayObserved).toBe(150);

      setTimeoutSpy.mockRestore();
    });
  });

  describe("buffer counter uniqueness (mutation: counter not incrementing)", () => {
    it("should use unique buffer names for consecutive sends", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      registry.updateStatus(session.id, "idle");

      await router.sendInput(session.id, "first message");
      await router.sendInput(session.id, "second message");

      // Extract buffer names from set-buffer calls
      const setBufferCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])[0] === "set-buffer"
      );
      expect(setBufferCalls.length).toBeGreaterThanOrEqual(2);

      const bufferName1 = (setBufferCalls[0]![1] as string[])[2]; // -b flag value
      const bufferName2 = (setBufferCalls[1]![1] as string[])[2];

      // Buffer names must be different to avoid overwriting a buffer mid-use
      expect(bufferName1).not.toBe(bufferName2);
    });
  });
});
