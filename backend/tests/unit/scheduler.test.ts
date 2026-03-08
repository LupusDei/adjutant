import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScheduledTask } from "node-cron";

// vi.hoisted ensures these are available when vi.mock factories run (they are hoisted)
const { mockExecFile, mockSchedule, mockEnsureAdjutantAlive } = vi.hoisted(
  () => ({
    mockExecFile: vi.fn(),
    mockSchedule: vi.fn(),
    mockEnsureAdjutantAlive: vi.fn(),
  }),
);

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node-cron", () => ({
  default: { schedule: mockSchedule },
  schedule: mockSchedule,
}));

vi.mock("../../src/services/adjutant-spawner.js", () => ({
  ensureAdjutantAlive: mockEnsureAdjutantAlive,
}));

import {
  startScheduler,
  stopScheduler,
  sendHeartbeat,
  getHeartbeatPrompt,
} from "../../src/services/scheduler.js";

describe("Scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Ensure scheduler is stopped between tests
    stopScheduler();
  });

  describe("startScheduler", () => {
    it("should register a cron job with hourly schedule", () => {
      const mockTask = { stop: vi.fn() } as unknown as ScheduledTask;
      mockSchedule.mockReturnValue(mockTask);

      startScheduler();

      expect(mockSchedule).toHaveBeenCalledTimes(1);
      expect(mockSchedule).toHaveBeenCalledWith(
        "0 * * * *",
        expect.any(Function),
      );
    });

    it("should not register multiple cron jobs if called twice", () => {
      const mockTask = { stop: vi.fn() } as unknown as ScheduledTask;
      mockSchedule.mockReturnValue(mockTask);

      startScheduler();
      startScheduler();

      expect(mockSchedule).toHaveBeenCalledTimes(1);
    });
  });

  describe("stopScheduler", () => {
    it("should cancel the cron job", () => {
      const mockTask = { stop: vi.fn() } as unknown as ScheduledTask;
      mockSchedule.mockReturnValue(mockTask);

      startScheduler();
      stopScheduler();

      expect(mockTask.stop).toHaveBeenCalledTimes(1);
    });

    it("should not throw if no scheduler is running", () => {
      expect(() => stopScheduler()).not.toThrow();
    });
  });

  describe("sendHeartbeat", () => {
    it("should call tmux send-keys with correct session name and prompt", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(null, "", "");
        },
      );

      await sendHeartbeat();

      // First call: send the heartbeat prompt text with -l flag
      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        expect.arrayContaining([
          "send-keys",
          "-t",
          "adj-swarm-adjutant",
          "-l",
        ]),
        expect.any(Function),
      );

      // The first call args should include the prompt text as the last argument
      const firstCallArgs = mockExecFile.mock.calls[0]?.[1] as string[];
      expect(firstCallArgs).toBeDefined();
      expect(firstCallArgs[0]).toBe("send-keys");
      expect(firstCallArgs[1]).toBe("-t");
      expect(firstCallArgs[2]).toBe("adj-swarm-adjutant");
      expect(firstCallArgs[3]).toBe("-l");
      // The 5th arg is the prompt text
      expect(typeof firstCallArgs[4]).toBe("string");
      expect((firstCallArgs[4] as string).length).toBeGreaterThan(0);
    });

    it("should send Enter as a separate command without -l flag", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(null, "", "");
        },
      );

      await sendHeartbeat();

      // Should have been called twice: once for prompt, once for Enter
      expect(mockExecFile).toHaveBeenCalledTimes(2);

      // Second call: send Enter without -l flag
      const secondCallArgs = mockExecFile.mock.calls[1]?.[1] as string[];
      expect(secondCallArgs).toBeDefined();
      expect(secondCallArgs).toEqual([
        "send-keys",
        "-t",
        "adj-swarm-adjutant",
        "Enter",
      ]);

      // Verify -l is NOT in the second call
      expect(secondCallArgs).not.toContain("-l");
    });

    it("should handle tmux failure gracefully without throwing", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(new Error("tmux session not found"), "", "no server running");
        },
      );

      // Should not throw
      await expect(sendHeartbeat()).resolves.toBeUndefined();
    });

    it("should not send Enter if the prompt send fails", async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(new Error("tmux session not found"), "", "");
        },
      );

      await sendHeartbeat();

      // Only the first call should have been made; Enter should be skipped
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });
  });

  describe("getHeartbeatPrompt", () => {
    it("should return a non-empty string", () => {
      const prompt = getHeartbeatPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should not contain single quotes", () => {
      const prompt = getHeartbeatPrompt();
      expect(prompt).not.toContain("'");
    });

    it("should contain instructions for list_agents", () => {
      const prompt = getHeartbeatPrompt();
      expect(prompt).toContain("list_agents");
    });

    it("should contain instructions for list_beads", () => {
      const prompt = getHeartbeatPrompt();
      expect(prompt).toContain("list_beads");
    });

    it("should contain instructions for stale agent detection", () => {
      const prompt = getHeartbeatPrompt();
      expect(prompt.toLowerCase()).toContain("stale");
    });

    it("should contain instructions for sending summary to user", () => {
      const prompt = getHeartbeatPrompt();
      expect(prompt).toContain("send_message");
      expect(prompt).toContain("user");
    });
  });

  // ==========================================================================
  // Health Check Integration (adj-051.3.2)
  // ==========================================================================

  describe("sendHeartbeat health check integration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Default: execFile succeeds
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb(null, "", "");
        },
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should run health check before sending heartbeat", async () => {
      // No recovery needed
      mockEnsureAdjutantAlive.mockResolvedValue(false);

      const callOrder: string[] = [];
      mockEnsureAdjutantAlive.mockImplementation(async () => {
        callOrder.push("healthCheck");
        return false;
      });
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callOrder.push("tmux");
          cb(null, "", "");
        },
      );

      await sendHeartbeat();

      expect(callOrder[0]).toBe("healthCheck");
      expect(callOrder[1]).toBe("tmux");
      expect(mockEnsureAdjutantAlive).toHaveBeenCalledOnce();
    });

    it("should wait 5 seconds after recovery before sending heartbeat", async () => {
      // Recovery happened
      mockEnsureAdjutantAlive.mockResolvedValue(true);

      let tmuxCalled = false;
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          tmuxCalled = true;
          cb(null, "", "");
        },
      );

      const promise = sendHeartbeat();

      // Health check completes immediately (mocked), but recovery wait should delay tmux
      await vi.advanceTimersByTimeAsync(4_999);
      expect(tmuxCalled).toBe(false);

      // After 5 seconds, tmux should proceed
      await vi.advanceTimersByTimeAsync(1);
      expect(tmuxCalled).toBe(true);

      await promise;
    });

    it("should proceed immediately when no recovery needed", async () => {
      // No recovery
      mockEnsureAdjutantAlive.mockResolvedValue(false);

      await sendHeartbeat();

      // tmux should have been called immediately (no extra wait)
      expect(mockExecFile).toHaveBeenCalled();
    });

    it("should still send heartbeat even if health check fails", async () => {
      // Health check throws
      mockEnsureAdjutantAlive.mockRejectedValue(
        new Error("health check crashed"),
      );

      await sendHeartbeat();

      // tmux should still have been called despite health check failure
      expect(mockExecFile).toHaveBeenCalled();
    });
  });
});
