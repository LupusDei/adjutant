import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    appendFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  };
});

import { OutputThrottle, type OutputBatch } from "../../src/services/output-throttle.js";
import { appendFileSync } from "fs";

describe("output-throttle", () => {
  let throttle: OutputThrottle;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    throttle = new OutputThrottle({
      flushIntervalMs: 100,
      maxBatchSize: 5,
      persistLogs: true,
      logDir: "/tmp/test-logs",
    });
  });

  afterEach(() => {
    throttle.shutdown();
    vi.useRealTimers();
  });

  describe("push and flush", () => {
    it("should buffer lines and flush on interval", () => {
      const batches: OutputBatch[] = [];
      throttle.onFlush((b) => batches.push(b));

      throttle.push("sess-1", "line 1");
      throttle.push("sess-1", "line 2");
      expect(batches).toHaveLength(0);

      vi.advanceTimersByTime(100);
      expect(batches).toHaveLength(1);
      expect(batches[0].lines).toEqual(["line 1", "line 2"]);
      expect(batches[0].sessionId).toBe("sess-1");
    });

    it("should flush immediately when batch is full", () => {
      const batches: OutputBatch[] = [];
      throttle.onFlush((b) => batches.push(b));

      for (let i = 0; i < 5; i++) {
        throttle.push("sess-1", `line ${i}`);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0].lines).toHaveLength(5);
    });

    it("should not flush empty buffers", () => {
      const batches: OutputBatch[] = [];
      throttle.onFlush((b) => batches.push(b));

      throttle.push("sess-1", "line");
      throttle.flush("sess-1");
      throttle.flush("sess-1"); // second flush should be no-op

      expect(batches).toHaveLength(1);
    });
  });

  describe("multiple sessions", () => {
    it("should maintain separate buffers per session", () => {
      const batches: OutputBatch[] = [];
      throttle.onFlush((b) => batches.push(b));

      throttle.push("sess-1", "from session 1");
      throttle.push("sess-2", "from session 2");

      vi.advanceTimersByTime(100);
      expect(batches).toHaveLength(2);

      const sess1 = batches.find((b) => b.sessionId === "sess-1");
      const sess2 = batches.find((b) => b.sessionId === "sess-2");
      expect(sess1!.lines).toEqual(["from session 1"]);
      expect(sess2!.lines).toEqual(["from session 2"]);
    });
  });

  describe("remove", () => {
    it("should flush remaining and stop tracking", () => {
      const batches: OutputBatch[] = [];
      throttle.onFlush((b) => batches.push(b));

      throttle.push("sess-1", "last line");
      throttle.remove("sess-1");

      expect(batches).toHaveLength(1);
      expect(throttle.activeCount).toBe(0);
    });
  });

  describe("persistent logs", () => {
    it("should append lines to log file", () => {
      throttle.push("sess-1", "logged line");

      expect(appendFileSync).toHaveBeenCalledWith(
        "/tmp/test-logs/session-sess-1.log",
        "logged line\n",
        "utf8"
      );
    });

    it("should return correct log path", () => {
      expect(throttle.getLogPath("sess-1")).toBe(
        "/tmp/test-logs/session-sess-1.log"
      );
    });
  });

  describe("metrics", () => {
    it("should track active session count", () => {
      expect(throttle.activeCount).toBe(0);
      throttle.push("sess-1", "line");
      expect(throttle.activeCount).toBe(1);
      throttle.push("sess-2", "line");
      expect(throttle.activeCount).toBe(2);
    });

    it("should track pending count", () => {
      expect(throttle.getPendingCount("sess-1")).toBe(0);
      throttle.push("sess-1", "line 1");
      throttle.push("sess-1", "line 2");
      expect(throttle.getPendingCount("sess-1")).toBe(2);
    });
  });

  describe("shutdown", () => {
    it("should flush all and clean up", () => {
      const batches: OutputBatch[] = [];
      throttle.onFlush((b) => batches.push(b));

      throttle.push("sess-1", "line");
      throttle.push("sess-2", "line");
      throttle.shutdown();

      expect(batches).toHaveLength(2);
      expect(throttle.activeCount).toBe(0);
    });
  });
});
