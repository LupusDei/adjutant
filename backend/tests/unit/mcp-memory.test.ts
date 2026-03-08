/**
 * Tests for MCP memory tools (query_memories, get_session_retros).
 *
 * Bead: adj-053.4.2
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  MemoryStore,
  Learning,
  Retrospective,
} from "../../src/services/adjutant/memory-store.js";

// ============================================================================
// Mock Helpers
// ============================================================================

function makeLearning(overrides: Partial<Learning> & { id: number }): Learning {
  return {
    id: overrides.id,
    category: overrides.category ?? "operational",
    topic: overrides.topic ?? "test-topic",
    content: overrides.content ?? "Test learning content",
    sourceType: overrides.sourceType ?? "user_correction",
    sourceRef: overrides.sourceRef ?? null,
    confidence: overrides.confidence ?? 0.5,
    reinforcementCount: overrides.reinforcementCount ?? 1,
    lastAppliedAt: overrides.lastAppliedAt ?? null,
    lastValidatedAt: overrides.lastValidatedAt ?? null,
    supersededBy: overrides.supersededBy ?? null,
    createdAt: overrides.createdAt ?? "2026-03-08T12:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-03-08T12:00:00Z",
  };
}

function makeRetrospective(overrides: Partial<Retrospective> & { id: number }): Retrospective {
  return {
    id: overrides.id,
    sessionDate: overrides.sessionDate ?? "2026-03-08",
    beadsClosed: overrides.beadsClosed ?? 5,
    beadsFailed: overrides.beadsFailed ?? 1,
    correctionsReceived: overrides.correctionsReceived ?? 2,
    agentsUsed: overrides.agentsUsed ?? 3,
    avgBeadTimeMins: overrides.avgBeadTimeMins ?? 30,
    wentWell: overrides.wentWell ?? '["Good test coverage"]',
    wentWrong: overrides.wentWrong ?? '["Build failures"]',
    actionItems: overrides.actionItems ?? '["Add more tests"]',
    metrics: overrides.metrics ?? null,
    createdAt: overrides.createdAt ?? "2026-03-08T23:00:00Z",
  };
}

function createMockMemoryStore(): MemoryStore {
  return {
    insertLearning: vi.fn(),
    getLearning: vi.fn(),
    updateLearning: vi.fn(),
    queryLearnings: vi.fn().mockReturnValue([]),
    searchLearnings: vi.fn().mockReturnValue([]),
    findSimilarLearnings: vi.fn().mockReturnValue([]),
    reinforceLearning: vi.fn(),
    supersedeLearning: vi.fn(),
    pruneStale: vi.fn().mockReturnValue(0),
    insertRetrospective: vi.fn(),
    getRecentRetrospectives: vi.fn().mockReturnValue([]),
    insertCorrection: vi.fn(),
    findSimilarCorrection: vi.fn(),
    incrementRecurrence: vi.fn(),
    getUnresolvedCorrections: vi.fn().mockReturnValue([]),
    getTopicFrequency: vi.fn().mockReturnValue([]),
    getCorrectionRecurrenceRate: vi.fn().mockReturnValue([]),
    getLearningEffectiveness: vi.fn().mockReturnValue([]),
  };
}

// ============================================================================
// Test helpers — mock MCP server pattern (matches mcp-messaging.test.ts)
// ============================================================================

type ToolHandler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();

  const mockServer = {
    tool: vi.fn((...args: unknown[]) => {
      if (args.length >= 3) {
        const name = args[0] as string;
        const handler = args[args.length - 1] as ToolHandler;
        handlers.set(name, handler);
      }
    }),
  };

  return { mockServer, handlers };
}

// ============================================================================
// Tests
// ============================================================================

describe("MCP Memory Tools", () => {
  let mockStore: MemoryStore;

  beforeEach(() => {
    mockStore = createMockMemoryStore();
    vi.clearAllMocks();
  });

  describe("registerMemoryTools", () => {
    it("should register both memory tools on the MCP server", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer } = createMockServer();

      // Safe cast: mockServer has the tool() method which is all registerMemoryTools uses
      registerMemoryTools(mockServer as never, mockStore);

      expect(mockServer.tool).toHaveBeenCalledTimes(2);
      const toolNames = mockServer.tool.mock.calls.map((call: unknown[]) => call[0]);
      expect(toolNames).toContain("query_memories");
      expect(toolNames).toContain("get_session_retros");
    });
  });

  // --------------------------------------------------------------------------
  // query_memories
  // --------------------------------------------------------------------------

  describe("query_memories", () => {
    it("should return learnings matching a text query via searchLearnings", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      const learnings = [
        makeLearning({ id: 1, content: "Always use worktree isolation", topic: "worktree" }),
        makeLearning({ id: 2, content: "Never share working directories", topic: "worktree" }),
      ];
      vi.mocked(mockStore.searchLearnings).mockReturnValue(learnings);

      const handler = handlers.get("query_memories")!;
      const result = await handler({ query: "worktree" }, {});

      expect(mockStore.searchLearnings).toHaveBeenCalledWith("worktree", 10);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.learnings).toHaveLength(2);
      expect(parsed.learnings[0].content).toBe("Always use worktree isolation");
    });

    it("should filter by category when provided (no text query)", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      const learnings = [
        makeLearning({ id: 1, category: "operational", topic: "spawn" }),
      ];
      vi.mocked(mockStore.queryLearnings).mockReturnValue(learnings);

      const handler = handlers.get("query_memories")!;
      const result = await handler({ category: "operational" }, {});

      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ category: "operational" }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.learnings).toHaveLength(1);
    });

    it("should filter by topic when provided", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const handler = handlers.get("query_memories")!;
      await handler({ topic: "bead-assignment" }, {});

      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "bead-assignment" }),
      );
    });

    it("should filter by minConfidence when provided", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const handler = handlers.get("query_memories")!;
      await handler({ minConfidence: 0.7 }, {});

      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ minConfidence: 0.7 }),
      );
    });

    it("should respect the limit parameter", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const handler = handlers.get("query_memories")!;
      await handler({ limit: 5 }, {});

      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 }),
      );
    });

    it("should default limit to 10 when not specified", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const handler = handlers.get("query_memories")!;
      await handler({ category: "technical" }, {});

      expect(mockStore.queryLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });

    it("should use searchLearnings when query is provided (even with other filters)", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      vi.mocked(mockStore.searchLearnings).mockReturnValue([]);

      const handler = handlers.get("query_memories")!;
      await handler({ query: "worktree", category: "operational" }, {});

      expect(mockStore.searchLearnings).toHaveBeenCalledWith("worktree", 10);
      expect(mockStore.queryLearnings).not.toHaveBeenCalled();
    });

    it("should return empty array when no learnings match", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      vi.mocked(mockStore.queryLearnings).mockReturnValue([]);

      const handler = handlers.get("query_memories")!;
      const result = await handler({}, {});

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.learnings).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // get_session_retros
  // --------------------------------------------------------------------------

  describe("get_session_retros", () => {
    it("should return recent retrospectives with default limit of 5", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      const retros = [
        makeRetrospective({ id: 1, sessionDate: "2026-03-08" }),
        makeRetrospective({ id: 2, sessionDate: "2026-03-07" }),
      ];
      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue(retros);

      const handler = handlers.get("get_session_retros")!;
      const result = await handler({}, {});

      expect(mockStore.getRecentRetrospectives).toHaveBeenCalledWith(5);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.retrospectives).toHaveLength(2);
      expect(parsed.retrospectives[0].sessionDate).toBe("2026-03-08");
    });

    it("should respect custom limit", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue([]);

      const handler = handlers.get("get_session_retros")!;
      await handler({ limit: 3 }, {});

      expect(mockStore.getRecentRetrospectives).toHaveBeenCalledWith(3);
    });

    it("should return retrospective with full structure", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      const retro = makeRetrospective({
        id: 1,
        sessionDate: "2026-03-08",
        beadsClosed: 10,
        beadsFailed: 2,
        correctionsReceived: 3,
        agentsUsed: 4,
        avgBeadTimeMins: 25.5,
        wentWell: '["Fast iteration", "Good coordination"]',
        wentWrong: '["Build failures", "Stale agents"]',
        actionItems: '["Add pre-commit hooks", "Improve nudger threshold"]',
      });
      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue([retro]);

      const handler = handlers.get("get_session_retros")!;
      const result = await handler({}, {});

      const parsed = JSON.parse(result.content[0].text);
      const r = parsed.retrospectives[0];
      expect(r.beadsClosed).toBe(10);
      expect(r.beadsFailed).toBe(2);
    });

    it("should return empty array when no retrospectives exist", async () => {
      const { registerMemoryTools } = await import("../../src/services/mcp-tools/memory.js");
      const { mockServer, handlers } = createMockServer();
      registerMemoryTools(mockServer as never, mockStore);

      vi.mocked(mockStore.getRecentRetrospectives).mockReturnValue([]);

      const handler = handlers.get("get_session_retros")!;
      const result = await handler({}, {});

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.retrospectives).toEqual([]);
    });
  });
});
