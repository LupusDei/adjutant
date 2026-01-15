import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

// Mock child_process before importing the module under test
vi.mock("child_process", () => ({
  spawn: vi.fn(),
  // Mock execFileSync to return 'gt' so the module uses 'gt' as the binary path
  execFileSync: vi.fn(() => "gt"),
}));

vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: vi.fn(() => "/tmp/town"),
  resolveGtBinary: vi.fn(() => "gt"),
}));

import { spawn } from "child_process";
import { execGt, gt } from "../../src/services/gt-executor.js";

// Custom matcher for gt binary - accepts 'gt' or any path ending with '/gt'
const gtBinaryMatcher = expect.stringMatching(/^(gt|.*\/gt)$/);

/**
 * Creates a mock ChildProcess that emits events like a real spawned process.
 */
function createMockProcess(): ChildProcess & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  simulateOutput: (stdout: string, stderr: string, exitCode: number) => void;
  simulateError: (error: Error) => void;
} {
  const process = new EventEmitter() as ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    simulateOutput: (stdout: string, stderr: string, exitCode: number) => void;
    simulateError: (error: Error) => void;
  };

  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();

  process.simulateOutput = (
    stdout: string,
    stderr: string,
    exitCode: number
  ) => {
    if (stdout) {
      process.stdout.emit("data", Buffer.from(stdout));
    }
    if (stderr) {
      process.stderr.emit("data", Buffer.from(stderr));
    }
    process.emit("close", exitCode);
  };

  process.simulateError = (error: Error) => {
    process.emit("error", error);
  };

  return process;
}

describe("gt-executor", () => {
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    mockProcess = createMockProcess();
    mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("execGt", () => {
    it("should execute command and parse JSON output on success", async () => {
      const resultPromise = execGt<{ status: string }>(["status", "--json"]);

      mockProcess.simulateOutput(
        JSON.stringify({ status: "running" }),
        "",
        0
      );

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: "running" });
      expect(result.exitCode).toBe(0);
      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["status", "--json"],
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it("should return raw stdout when parseJson is false", async () => {
      const resultPromise = execGt<string>(["up"], { parseJson: false });

      mockProcess.simulateOutput("Gastown started successfully", "", 0);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe("Gastown started successfully");
      expect(result.exitCode).toBe(0);
    });

    it("should handle command failure with stderr", async () => {
      const resultPromise = execGt(["status", "--json"]);

      mockProcess.simulateOutput("", "Error: gastown not initialized", 1);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: "COMMAND_FAILED",
        message: "Error: gastown not initialized",
        stderr: "Error: gastown not initialized",
      });
      expect(result.exitCode).toBe(1);
    });

    it("should handle command failure without stderr", async () => {
      const resultPromise = execGt(["invalid"]);

      mockProcess.simulateOutput("", "", 127);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: "COMMAND_FAILED",
        message: "Command exited with code 127",
      });
      expect(result.exitCode).toBe(127);
    });

    it("should handle spawn error", async () => {
      const resultPromise = execGt(["status"]);

      mockProcess.simulateError(new Error("spawn gt ENOENT"));

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: "SPAWN_ERROR",
        message: "spawn gt ENOENT",
      });
      expect(result.exitCode).toBe(-1);
    });

    it("should handle JSON parse error", async () => {
      const resultPromise = execGt(["status", "--json"]);

      mockProcess.simulateOutput("not valid json {", "", 0);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PARSE_ERROR");
      expect(result.error?.message).toBe("Failed to parse JSON output");
    });

    it("should use custom cwd option", async () => {
      const resultPromise = execGt(["status"], { cwd: "/custom/path" });

      mockProcess.simulateOutput("{}", "", 0);
      await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["status"],
        expect.objectContaining({ cwd: "/custom/path" })
      );
    });

    it("should use custom timeout option", async () => {
      const resultPromise = execGt(["status"], { timeout: 5000 });

      mockProcess.simulateOutput("{}", "", 0);
      await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["status"],
        expect.objectContaining({ timeout: 5000 })
      );
    });

    it("should return a timeout error when the command exceeds the limit", async () => {
      vi.useFakeTimers();
      try {
        const resultPromise = execGt(["status"], { timeout: 1000 });

        await vi.advanceTimersByTimeAsync(1000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toEqual({
          code: "TIMEOUT",
          message: "Command timed out after 1000ms",
        });
        expect(result.exitCode).toBe(-1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should handle empty stdout with parseJson true", async () => {
      const resultPromise = execGt(["status", "--json"]);

      mockProcess.simulateOutput("", "", 0);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("gt.status", () => {
    it("should call execGt with status --json args", async () => {
      const resultPromise = gt.status();

      mockProcess.simulateOutput(
        JSON.stringify({ powerState: "running" }),
        "",
        0
      );

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["status", "--json"],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });
  });

  describe("gt.up", () => {
    it("should call execGt with up args and parseJson false", async () => {
      const resultPromise = gt.up();

      mockProcess.simulateOutput("Started", "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(gtBinaryMatcher, ["up"], expect.any(Object));
      expect(result.success).toBe(true);
      expect(result.data).toBe("Started");
    });
  });

  describe("gt.down", () => {
    it("should call execGt with down args and parseJson false", async () => {
      const resultPromise = gt.down();

      mockProcess.simulateOutput("Stopped", "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(gtBinaryMatcher, ["down"], expect.any(Object));
      expect(result.success).toBe(true);
      expect(result.data).toBe("Stopped");
    });
  });

  describe("gt.mail.inbox", () => {
    it("should call execGt with mail inbox --json args", async () => {
      const resultPromise = gt.mail.inbox();

      mockProcess.simulateOutput(JSON.stringify({ messages: [] }), "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["mail", "inbox", "--json"],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });
  });

  describe("gt.mail.read", () => {
    it("should call execGt with mail read messageId --json args", async () => {
      const resultPromise = gt.mail.read("msg-123");

      mockProcess.simulateOutput(JSON.stringify({ id: "msg-123" }), "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["mail", "read", "msg-123", "--json"],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });
  });

  describe("gt.mail.send", () => {
    it("should call execGt with mail send args", async () => {
      const resultPromise = gt.mail.send("mayor/", "Test Subject", "Test body");

      mockProcess.simulateOutput("Message sent", "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["mail", "send", "mayor/", "-s", "Test Subject", "-m", "Test body", "--permanent"],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it("should include optional type argument", async () => {
      const resultPromise = gt.mail.send("mayor/", "Test", "Body", {
        type: "task",
      });

      mockProcess.simulateOutput("Message sent", "", 0);
      await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        expect.arrayContaining(["--type", "task"]),
        expect.any(Object)
      );
    });

    it("should include optional priority argument", async () => {
      const resultPromise = gt.mail.send("mayor/", "Test", "Body", {
        priority: 1,
      });

      mockProcess.simulateOutput("Message sent", "", 0);
      await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        expect.arrayContaining(["--priority", "1"]),
        expect.any(Object)
      );
    });

    it("should include optional replyTo argument", async () => {
      const resultPromise = gt.mail.send("mayor/", "Test", "Body", {
        replyTo: "msg-456",
      });

      mockProcess.simulateOutput("Message sent", "", 0);
      await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        expect.arrayContaining(["--reply-to", "msg-456"]),
        expect.any(Object)
      );
    });
  });

  describe("gt.mail.markRead", () => {
    it("should call execGt with mail mark-read args", async () => {
      const resultPromise = gt.mail.markRead("msg-123");

      mockProcess.simulateOutput("Marked as read", "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["mail", "mark-read", "msg-123"],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });
  });

  describe("gt.mail.thread", () => {
    it("should call execGt with mail thread --json args", async () => {
      const resultPromise = gt.mail.thread("thread-123");

      mockProcess.simulateOutput(JSON.stringify({ messages: [] }), "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["mail", "thread", "thread-123", "--json"],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });
  });

  describe("gt.agents.list", () => {
    it("should call execGt with agents list --all args and parse text output", async () => {
      const resultPromise = gt.agents.list();

      // Simulate the text output format from gt agents list --all
      const textOutput = `  🎩 Mayor
── gastown ──
  🏭 refinery
  🦉 witness
  👷 crew/vin`;

      mockProcess.simulateOutput(textOutput, "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["agents", "list", "--all"],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);

      // Verify parsed data structure
      const agents = result.data as Array<{
        name: string;
        type: string;
        rig: string | null;
      }>;
      expect(agents.length).toBe(4);
      expect(agents[0]).toMatchObject({ name: "mayor", type: "mayor", rig: null });
      expect(agents[1]).toMatchObject({ name: "refinery", type: "refinery", rig: "gastown" });
    });
  });

  describe("gt.agents.check", () => {
    it("should call execGt with agents check --json args", async () => {
      const resultPromise = gt.agents.check();

      mockProcess.simulateOutput(JSON.stringify({ healthy: true }), "", 0);

      const result = await resultPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        gtBinaryMatcher,
        ["agents", "check", "--json"],
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });
  });
});
