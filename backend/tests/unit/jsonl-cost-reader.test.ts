/**
 * Tests for the JSONL session log parser service.
 * Verifies cost computation from Claude Code JSONL session logs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  parseJsonlSessionCost,
  findSessionLogs,
  computeProjectCosts,
  type JsonlSessionCost,
} from "../../src/services/jsonl-cost-reader.js";

// ============================================================================
// Helpers
// ============================================================================

let tmpDir: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jsonl-cost-test-"));
}

function writeJsonlFile(filePath: string, lines: unknown[]): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/** Build a well-formed assistant message with usage data. */
function assistantMsg(opts: {
  sessionId?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  timestamp?: string;
}): Record<string, unknown> {
  return {
    type: "assistant",
    sessionId: opts.sessionId ?? "test-session-1",
    timestamp: opts.timestamp ?? "2026-03-10T10:00:00.000Z",
    message: {
      model: opts.model ?? "claude-sonnet-4-6",
      usage: {
        input_tokens: opts.input_tokens ?? 100,
        output_tokens: opts.output_tokens ?? 50,
        cache_creation_input_tokens: opts.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: opts.cache_read_input_tokens ?? 0,
        service_tier: "standard",
      },
    },
  };
}

/** Build a user message (no usage data). */
function userMsg(sessionId = "test-session-1"): Record<string, unknown> {
  return {
    type: "user",
    sessionId,
    timestamp: "2026-03-10T10:00:01.000Z",
    message: { role: "user", content: "hello" },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("jsonl-cost-reader", () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // parseJsonlSessionCost
  // --------------------------------------------------------------------------

  describe("parseJsonlSessionCost", () => {
    it("should parse a well-formed JSONL file with sonnet messages", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      writeJsonlFile(filePath, [
        assistantMsg({ input_tokens: 1000, output_tokens: 500 }),
        assistantMsg({ input_tokens: 2000, output_tokens: 300 }),
      ]);

      const result = await parseJsonlSessionCost(filePath);
      expect(result.sessionId).toBe("test-session-1");
      expect(result.messageCount).toBe(2);
      expect(result.tokenBreakdown.input).toBe(3000);
      expect(result.tokenBreakdown.output).toBe(800);
      expect(result.models).toEqual(["claude-sonnet-4-6"]);

      // Sonnet pricing: input=$3/M, output=$15/M
      // Cost = (3000 * 3 + 800 * 15) / 1_000_000 = (9000 + 12000) / 1_000_000 = 0.021
      expect(result.totalCost).toBeCloseTo(0.021, 6);
    });

    it("should skip user and system messages (no usage data)", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      writeJsonlFile(filePath, [
        userMsg(),
        { type: "system", sessionId: "test-session-1", timestamp: "2026-03-10T10:00:00Z" },
        assistantMsg({ input_tokens: 500, output_tokens: 200 }),
      ]);

      const result = await parseJsonlSessionCost(filePath);
      expect(result.messageCount).toBe(1);
      expect(result.tokenBreakdown.input).toBe(500);
      expect(result.tokenBreakdown.output).toBe(200);
    });

    it("should handle malformed JSON lines gracefully", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      const goodLine = JSON.stringify(assistantMsg({ input_tokens: 100, output_tokens: 50 }));
      fs.writeFileSync(filePath, `${goodLine}\n{malformed json\n${goodLine}\n`);

      const result = await parseJsonlSessionCost(filePath);
      // Should skip the malformed line and parse the other two
      expect(result.messageCount).toBe(2);
    });

    it("should compute cache write and read costs correctly", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      writeJsonlFile(filePath, [
        assistantMsg({
          model: "claude-opus-4-6",
          input_tokens: 1000,
          output_tokens: 200,
          cache_creation_input_tokens: 5000,
          cache_read_input_tokens: 3000,
        }),
      ]);

      const result = await parseJsonlSessionCost(filePath);
      expect(result.tokenBreakdown.cacheWrite).toBe(5000);
      expect(result.tokenBreakdown.cacheRead).toBe(3000);

      // Opus pricing:
      // input: 1000 * 15 / 1M = 0.015
      // output: 200 * 75 / 1M = 0.015
      // cache write: 5000 * 18.75 / 1M = 0.09375
      // cache read: 3000 * 1.50 / 1M = 0.0045
      // total = 0.015 + 0.015 + 0.09375 + 0.0045 = 0.12825
      expect(result.totalCost).toBeCloseTo(0.12825, 6);
    });

    it("should handle haiku model pricing", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      writeJsonlFile(filePath, [
        assistantMsg({
          model: "claude-haiku-4-5-20251001",
          input_tokens: 10000,
          output_tokens: 5000,
          cache_creation_input_tokens: 20000,
          cache_read_input_tokens: 10000,
        }),
      ]);

      const result = await parseJsonlSessionCost(filePath);
      // Haiku pricing:
      // input: 10000 * 0.80 / 1M = 0.008
      // output: 5000 * 4 / 1M = 0.02
      // cache write: 20000 * 1.00 / 1M = 0.02
      // cache read: 10000 * 0.08 / 1M = 0.0008
      // total = 0.008 + 0.02 + 0.02 + 0.0008 = 0.0488
      expect(result.totalCost).toBeCloseTo(0.0488, 6);
    });

    it("should handle multiple models in one session", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      writeJsonlFile(filePath, [
        assistantMsg({ model: "claude-sonnet-4-6", input_tokens: 100, output_tokens: 50 }),
        assistantMsg({ model: "claude-haiku-4-5-20251001", input_tokens: 200, output_tokens: 100 }),
      ]);

      const result = await parseJsonlSessionCost(filePath);
      expect(result.models.sort()).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]);
      expect(result.messageCount).toBe(2);
      expect(result.tokenBreakdown.input).toBe(300);
      expect(result.tokenBreakdown.output).toBe(150);

      // Sonnet: (100*3 + 50*15) / 1M = 0.00105  (300+750=1050 -> /1M)
      // Wait, let me recalculate:
      // Sonnet: input 100*3/1M = 0.0003, output 50*15/1M = 0.00075 => 0.00105
      // Haiku:  input 200*0.80/1M = 0.00016, output 100*4/1M = 0.0004 => 0.00056
      // total = 0.00105 + 0.00056 = 0.00161
      expect(result.totalCost).toBeCloseTo(0.00161, 6);
    });

    it("should use sonnet pricing for unknown models", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      writeJsonlFile(filePath, [
        assistantMsg({ model: "claude-future-model-99", input_tokens: 1000, output_tokens: 500 }),
      ]);

      const result = await parseJsonlSessionCost(filePath);
      // Should use sonnet pricing as default
      // input: 1000*3/1M = 0.003, output: 500*15/1M = 0.0075
      // total = 0.0105
      expect(result.totalCost).toBeCloseTo(0.0105, 6);
    });

    it("should track first and last timestamps", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      writeJsonlFile(filePath, [
        assistantMsg({ timestamp: "2026-03-10T10:00:00.000Z", input_tokens: 100, output_tokens: 50 }),
        assistantMsg({ timestamp: "2026-03-10T10:05:00.000Z", input_tokens: 100, output_tokens: 50 }),
        assistantMsg({ timestamp: "2026-03-10T10:10:00.000Z", input_tokens: 100, output_tokens: 50 }),
      ]);

      const result = await parseJsonlSessionCost(filePath);
      expect(result.firstTimestamp).toBe("2026-03-10T10:00:00.000Z");
      expect(result.lastTimestamp).toBe("2026-03-10T10:10:00.000Z");
    });

    it("should return zero cost for empty file", async () => {
      const filePath = path.join(tmpDir, "empty.jsonl");
      fs.writeFileSync(filePath, "");

      const result = await parseJsonlSessionCost(filePath);
      expect(result.totalCost).toBe(0);
      expect(result.messageCount).toBe(0);
      expect(result.tokenBreakdown).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
      expect(result.models).toEqual([]);
    });

    it("should throw on non-existent file", async () => {
      await expect(parseJsonlSessionCost("/nonexistent/file.jsonl")).rejects.toThrow();
    });

    it("should skip assistant messages without usage data", async () => {
      const filePath = path.join(tmpDir, "session.jsonl");
      writeJsonlFile(filePath, [
        { type: "assistant", sessionId: "s1", timestamp: "2026-03-10T10:00:00Z", message: { model: "test" } },
        assistantMsg({ input_tokens: 100, output_tokens: 50 }),
      ]);

      const result = await parseJsonlSessionCost(filePath);
      expect(result.messageCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // findSessionLogs
  // --------------------------------------------------------------------------

  describe("findSessionLogs", () => {
    it("should find JSONL files in sessions directory", async () => {
      const projectKey = "-Users-test-project";
      const claudeDir = path.join(tmpDir, ".claude", "projects", projectKey, "sessions");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, "abc123.jsonl"), "{}");
      fs.writeFileSync(path.join(claudeDir, "def456.jsonl"), "{}");

      const logs = await findSessionLogs(tmpDir, "/Users/test/project");
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.endsWith(".jsonl"))).toBe(true);
    });

    it("should find JSONL files in subagents directory", async () => {
      const projectKey = "-Users-test-project";
      const subagentsDir = path.join(tmpDir, ".claude", "projects", projectKey, "sessions", "subagents");
      fs.mkdirSync(subagentsDir, { recursive: true });
      fs.writeFileSync(path.join(subagentsDir, "agent-abc.jsonl"), "{}");

      const logs = await findSessionLogs(tmpDir, "/Users/test/project");
      expect(logs.some((l) => l.includes("subagents"))).toBe(true);
    });

    it("should return empty array for non-existent project", async () => {
      const logs = await findSessionLogs(tmpDir, "/nonexistent/project");
      expect(logs).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // computeProjectCosts
  // --------------------------------------------------------------------------

  describe("computeProjectCosts", () => {
    it("should compute costs for all sessions in a project", async () => {
      const projectKey = "-Users-test-project";
      const sessionsDir = path.join(tmpDir, ".claude", "projects", projectKey, "sessions");
      fs.mkdirSync(sessionsDir, { recursive: true });

      writeJsonlFile(path.join(sessionsDir, "session-1.jsonl"), [
        assistantMsg({ sessionId: "session-1", input_tokens: 1000, output_tokens: 500 }),
      ]);
      writeJsonlFile(path.join(sessionsDir, "session-2.jsonl"), [
        assistantMsg({ sessionId: "session-2", input_tokens: 2000, output_tokens: 1000 }),
      ]);

      const results = await computeProjectCosts(tmpDir, "/Users/test/project");
      expect(results).toHaveLength(2);

      const totalCost = results.reduce((sum, r) => sum + r.totalCost, 0);
      // Session 1: (1000*3 + 500*15)/1M = 0.0105
      // Session 2: (2000*3 + 1000*15)/1M = 0.021
      // Total: 0.0315
      expect(totalCost).toBeCloseTo(0.0315, 6);
    });

    it("should return empty array for project with no logs", async () => {
      const results = await computeProjectCosts(tmpDir, "/nonexistent/project");
      expect(results).toEqual([]);
    });
  });
});
