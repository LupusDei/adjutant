import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

// Mock child_process before importing the module under test
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs functions used by resolveBeadsDir
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import {
  execBd,
  stripBeadPrefix,
  resolveBeadsDir,
  _resetBdSemaphore,
} from "../../src/services/bd-client.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

/** Yield to the microtask queue so async semaphore acquire + spawn can proceed. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Creates a mock ChildProcess that emits events like a real spawned process.
 */
function createMockProcess(): ChildProcess & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  simulateOutput: (stdout: string, stderr: string, exitCode: number) => void;
  simulateError: (error: Error) => void;
} {
  const proc = new EventEmitter() as ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    simulateOutput: (stdout: string, stderr: string, exitCode: number) => void;
    simulateError: (error: Error) => void;
  };

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  proc.simulateOutput = (
    stdout: string,
    stderr: string,
    exitCode: number
  ) => {
    if (stdout) {
      proc.stdout.emit("data", Buffer.from(stdout));
    }
    if (stderr) {
      proc.stderr.emit("data", Buffer.from(stderr));
    }
    proc.emit("close", exitCode);
  };

  proc.simulateError = (error: Error) => {
    proc.emit("error", error);
  };

  return proc;
}

// =============================================================================
// Tests
// =============================================================================

describe("bd-client", () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawn = vi.mocked(spawn);
    vi.clearAllMocks();
    _resetBdSemaphore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("stripBeadPrefix", () => {
    it("should strip a simple prefix like hq-", () => {
      expect(stripBeadPrefix("hq-vts8")).toBe("vts8");
    });

    it("should strip longer prefixes like zt20-", () => {
      expect(stripBeadPrefix("zt20-abc")).toBe("abc");
    });

    it("should handle compound IDs after prefix", () => {
      expect(stripBeadPrefix("hq-cv-hfove")).toBe("cv-hfove");
    });

    it("should return the original if no prefix matches", () => {
      expect(stripBeadPrefix("noprefixhere")).toBe("noprefixhere");
    });
  });

  describe("resolveBeadsDir", () => {
    it("should return default .beads dir when no redirect exists", () => {
      const result = resolveBeadsDir("/tmp/project");
      expect(result).toBe("/tmp/project/.beads");
    });
  });

  describe("execBd", () => {
    it("should execute command and parse JSON output on success", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = execBd<{ count: number }>(["list", "--json"]);

      // Yield so the async semaphore acquire resolves and spawn is called
      await tick();
      mockProcess.simulateOutput(JSON.stringify({ count: 5 }), "", 0);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ count: 5 });
      expect(result.exitCode).toBe(0);
      expect(mockSpawn).toHaveBeenCalledWith(
        "bd",
        ["list", "--json"],
        expect.objectContaining({ cwd: expect.any(String) })
      );
    });

    it("should return error on non-zero exit code", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = execBd(["bad-command"]);
      await tick();
      mockProcess.simulateOutput("", "some error message", 1);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("COMMAND_FAILED");
      expect(result.exitCode).toBe(1);
    });

    it("should detect Go panic and return BD_PANIC error code", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const panicStderr = [
        "goroutine 1 [running]:",
        "runtime: panic: runtime error: invalid memory address or nil pointer dereference",
        "github.com/dolthub/dolt/go/store/nbs.(*tableCache).get(...)",
      ].join("\n");

      const resultPromise = execBd(["list", "--json"]);
      await tick();
      mockProcess.simulateOutput("", panicStderr, 2);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BD_PANIC");
      expect(result.error?.message).toContain("bd crashed:");
      expect(result.exitCode).toBe(2);
    });

    it("should handle spawn errors", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = execBd(["list"]);
      await tick();
      mockProcess.simulateError(new Error("spawn bd ENOENT"));

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("SPAWN_ERROR");
    });

    it("should handle timeout", async () => {
      vi.useFakeTimers();
      try {
        const mockProcess = createMockProcess();
        mockSpawn.mockReturnValue(mockProcess);

        const resultPromise = execBd(["list"], { timeout: 500 });

        // Advance past the semaphore acquire microtask
        await vi.advanceTimersByTimeAsync(0);
        // Now advance past the timeout
        await vi.advanceTimersByTimeAsync(500);

        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("TIMEOUT");
        expect(result.exitCode).toBe(-1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("execBd concurrency control", () => {
    it("should serialize concurrent execBd calls (max 1 at a time)", async () => {
      // Track how many bd processes are running concurrently
      let currentConcurrency = 0;
      let maxObservedConcurrency = 0;
      const completionOrder: number[] = [];

      // Create mock processes that we control manually
      const processes: ReturnType<typeof createMockProcess>[] = [];

      mockSpawn.mockImplementation(() => {
        currentConcurrency++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, currentConcurrency);
        const proc = createMockProcess();
        processes.push(proc);
        return proc;
      });

      // Fire 3 concurrent execBd calls
      const p1 = execBd(["list", "--json"], { parseJson: false }).then((r) => {
        completionOrder.push(1);
        return r;
      });
      const p2 = execBd(["show", "abc", "--json"], { parseJson: false }).then((r) => {
        completionOrder.push(2);
        return r;
      });
      const p3 = execBd(["list", "--json"], { parseJson: false }).then((r) => {
        completionOrder.push(3);
        return r;
      });

      // Give microtasks a chance to settle — only the first call should have spawned
      await tick();

      expect(processes.length).toBe(1);
      expect(currentConcurrency).toBe(1);

      // Complete the first process
      processes[0].simulateOutput("result1", "", 0);
      currentConcurrency--;

      // Let the next one start
      await tick();

      expect(processes.length).toBe(2);
      expect(currentConcurrency).toBe(1);

      // Complete the second process
      processes[1].simulateOutput("result2", "", 0);
      currentConcurrency--;

      await tick();

      expect(processes.length).toBe(3);
      expect(currentConcurrency).toBe(1);

      // Complete the third process
      processes[2].simulateOutput("result3", "", 0);
      currentConcurrency--;

      // Wait for all to resolve
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);

      // The key assertion: max concurrency should be 1, meaning calls were serialized
      expect(maxObservedConcurrency).toBe(1);

      // All 3 processes should have been created, just one at a time
      expect(processes.length).toBe(3);

      // Completion order should be sequential
      expect(completionOrder).toEqual([1, 2, 3]);
    });

    it("should not block subsequent calls if a previous call fails", async () => {
      const processes: ReturnType<typeof createMockProcess>[] = [];

      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        processes.push(proc);
        return proc;
      });

      // Fire two concurrent calls
      const p1 = execBd(["bad"], { parseJson: false });
      const p2 = execBd(["list"], { parseJson: false });

      await tick();
      expect(processes.length).toBe(1);

      // Fail the first one
      processes[0].simulateOutput("", "SIGSEGV", 2);

      await tick();

      // Second call should proceed even though first failed
      expect(processes.length).toBe(2);

      processes[1].simulateOutput("ok", "", 0);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.success).toBe(false);
      expect(r2.success).toBe(true);
    });

    it("should not block subsequent calls if a previous call times out", async () => {
      vi.useFakeTimers();
      try {
        const processes: ReturnType<typeof createMockProcess>[] = [];

        mockSpawn.mockImplementation(() => {
          const proc = createMockProcess();
          processes.push(proc);
          return proc;
        });

        // Fire two concurrent calls, first with short timeout
        const p1 = execBd(["slow"], { timeout: 100, parseJson: false });
        const p2 = execBd(["fast"], { parseJson: false });

        // Let the semaphore acquire resolve and first spawn happen
        await vi.advanceTimersByTimeAsync(0);
        expect(processes.length).toBe(1);

        // Trigger the timeout on the first call
        await vi.advanceTimersByTimeAsync(100);

        const r1 = await p1;
        expect(r1.success).toBe(false);
        expect(r1.error?.code).toBe("TIMEOUT");

        // Let microtasks settle — second call should now proceed
        await vi.advanceTimersByTimeAsync(0);
        expect(processes.length).toBe(2);

        // Complete the second call
        processes[1].simulateOutput("ok", "", 0);
        const r2 = await p2;

        expect(r2.success).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ===========================================================================
  // Mutation testing — tests written to kill surviving mutations
  // ===========================================================================

  describe("mutation: semaphore release hands slot without decrementing running", () => {
    it("should maintain correct concurrency count after sustained queue drain", async () => {
      // This test catches the mutation where release() always decrements running
      // even when handing the slot to the next waiter. Under sustained load, the
      // running counter would drift negative, allowing more than maxConcurrency
      // concurrent processes.
      const processes: ReturnType<typeof createMockProcess>[] = [];
      let currentConcurrency = 0;
      let maxObservedConcurrency = 0;

      mockSpawn.mockImplementation(() => {
        currentConcurrency++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, currentConcurrency);
        const proc = createMockProcess();
        processes.push(proc);
        return proc;
      });

      // Launch 5 concurrent calls — enough to exercise the queue drain path repeatedly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(execBd([`cmd-${i}`], { parseJson: false }));
      }

      // Drain the queue one at a time
      for (let i = 0; i < 5; i++) {
        await tick();
        expect(processes.length).toBe(i + 1);
        expect(currentConcurrency).toBe(1);
        processes[i].simulateOutput(`result-${i}`, "", 0);
        currentConcurrency--;
      }

      await Promise.all(promises);

      // The critical invariant: at no point should more than 1 process run concurrently
      expect(maxObservedConcurrency).toBe(1);
    });
  });

  describe("mutation: resolveBeadsDir existsSync guard", () => {
    it("should return default .beads dir without calling readFileSync when redirect does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const result = resolveBeadsDir("/tmp/project");

      expect(result).toBe("/tmp/project/.beads");
      // readFileSync should NOT have been called since existsSync returned false
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });
  });

  describe("mutation: resolveBeadsDirWithDepth boundary", () => {
    it("should follow redirect chain and resolve to target beads dir", () => {
      // Simulate: /tmp/project/.beads/redirect -> /tmp/other/.beads
      mockExistsSync.mockImplementation((p: unknown) => {
        if (p === "/tmp/project/.beads/redirect") return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: unknown) => {
        if (p === "/tmp/project/.beads/redirect") return "/tmp/other/.beads";
        throw new Error("ENOENT");
      });

      const result = resolveBeadsDir("/tmp/project");
      expect(result).toBe("/tmp/other/.beads");
    });

    it("should stop following redirects at depth limit instead of recursing infinitely", () => {
      // Create an infinite redirect cycle where each level points to a unique target
      let readCount = 0;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        readCount++;
        // Each redirect points to a different target to avoid the self-referential guard
        return `/tmp/level-${readCount}/.beads`;
      });

      // Should NOT throw or loop forever — depth limit should stop it
      const result = resolveBeadsDir("/tmp/project");

      // resolveBeadsDir reads 1 redirect, then calls resolveBeadsDirWithDepth(_, 3).
      // With depth <= 0 guard: recursion stops at depth=0, so max depths 3,2,1 = 3 more reads.
      // Total readFileSync calls: 1 (initial) + 3 (recursive) = 4.
      // With depth < 0 guard: recursion would continue at depth=0, adding 1 extra = 5 reads.
      expect(readCount).toBe(4);
      expect(result).toBeDefined();
    });
  });

  describe("mutation: stripDoltInfoMessages filter", () => {
    it("should strip Dolt orphan cleanup messages from stderr and treat remaining as success", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const doltInfoStderr = 'Info: cleaned up 3 orphaned dolt sql-server processes\n';

      const resultPromise = execBd<{ id: string }>(["show", "adj-001"]);
      await tick();
      // Process exits 0 with valid JSON stdout but Dolt info on stderr
      mockProcess.simulateOutput(JSON.stringify({ id: "adj-001" }), doltInfoStderr, 0);

      const result = await resultPromise;

      // With the filter in place, the Dolt info is stripped and stderr becomes empty,
      // so the command should be treated as success (not failure)
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: "adj-001" });
    });

    it("should treat Dolt info-only stderr with empty stdout as success (no error)", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const doltInfoStderr = 'Info: cleaned up 1 orphaned dolt sql-server process\n';

      const resultPromise = execBd(["update", "--status=done"], { parseJson: false });
      await tick();
      // Exit 0, empty stdout, only Dolt info on stderr
      mockProcess.simulateOutput("", doltInfoStderr, 0);

      const result = await resultPromise;

      // After stripping the Dolt info, stderr is empty, so this should be success
      expect(result.success).toBe(true);
    });
  });

  describe("mutation: isGoPanic panic: detection", () => {
    it("should detect Go panic from panic: prefix alone without other indicators", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // A panic message that ONLY matches the `panic:` check, not goroutine/runtime error/SIGSEGV/nil pointer
      const panicStderr = "panic: send on closed channel";

      const resultPromise = execBd(["list", "--json"]);
      await tick();
      mockProcess.simulateOutput("", panicStderr, 2);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BD_PANIC");
      expect(result.error?.message).toContain("bd crashed:");
      expect(result.error?.message).toContain("panic: send on closed channel");
    });
  });

  describe("mutation: sanitizeBdError truncation", () => {
    it("should include actual error content in non-panic error messages", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const errorMsg = "Error: bead adj-999 not found in database";

      const resultPromise = execBd(["show", "adj-999"]);
      await tick();
      mockProcess.simulateOutput("", errorMsg, 1);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      // The error message should contain the actual stderr content, not be empty
      expect(result.error?.message).toContain("bead adj-999 not found");
      expect(result.error?.message!.length).toBeGreaterThan(0);
    });

    it("should truncate very long error messages to a reasonable length", async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Generate an error message longer than the 500-char limit
      const longError = "E".repeat(1000);

      const resultPromise = execBd(["broken"]);
      await tick();
      mockProcess.simulateOutput("", longError, 1);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.message!.length).toBeLessThanOrEqual(500);
    });
  });

  describe("mutation: timeout should kill child process", () => {
    it("should call kill on the child process when timeout fires", async () => {
      vi.useFakeTimers();
      try {
        const mockProcess = createMockProcess();
        mockSpawn.mockReturnValue(mockProcess);

        const resultPromise = execBd(["slow-command"], { timeout: 200 });

        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(200);

        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("TIMEOUT");
        // The child process should have been killed to prevent resource leaks
        expect(mockProcess.kill).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
