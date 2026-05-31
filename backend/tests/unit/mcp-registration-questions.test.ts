/**
 * Registration test for question MCP tools (adj-181.2.3 — T011).
 *
 * Verifies:
 *   1. registerQuestionTools registers the correct three tool names.
 *   2. The three tools are present when called with a real service stub.
 *
 * The index.ts wiring is verified by the TypeScript build (tsc must compile
 * the import + call) and by the integration test suite. Attempting to import
 * index.ts in a unit test requires mocking 50+ modules and is brittle; the
 * more reliable gate is the build step.
 */

import { describe, it, expect, vi } from "vitest";

// -------------------------------------------------------------------------
// Logger — silence all output
// -------------------------------------------------------------------------
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock mcp-server identity helpers (required by registerQuestionTools)
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: vi.fn(),
  resolveToolProjectContext: vi.fn(),
}));

describe("registerQuestionTools — registration (T011)", () => {
  it("should register file_question, answer_question, and list_questions on the server", async () => {
    const { registerQuestionTools } = await vi.importActual<
      typeof import("../../src/services/mcp-tools/questions.js")
    >("../../src/services/mcp-tools/questions.js");

    const registeredTools = new Set<string>();
    const capturingServer = {
      tool: (name: string) => { registeredTools.add(name); },
    };

    const stubService = {
      fileQuestion: vi.fn(),
      answerQuestion: vi.fn(),
      dismissQuestion: vi.fn(),
      listQuestions: vi.fn().mockReturnValue([]),
    };

    registerQuestionTools(capturingServer as never, stubService as never);

    expect(registeredTools.has("file_question")).toBe(true);
    expect(registeredTools.has("answer_question")).toBe(true);
    expect(registeredTools.has("list_questions")).toBe(true);
    expect(registeredTools.size).toBe(3);
  });

  it("should not register any extra unexpected tools", async () => {
    const { registerQuestionTools } = await vi.importActual<
      typeof import("../../src/services/mcp-tools/questions.js")
    >("../../src/services/mcp-tools/questions.js");

    const registeredTools: string[] = [];
    const capturingServer = {
      tool: (name: string) => { registeredTools.push(name); },
    };

    const stubService = {
      fileQuestion: vi.fn(),
      answerQuestion: vi.fn(),
      dismissQuestion: vi.fn(),
      listQuestions: vi.fn().mockReturnValue([]),
    };

    registerQuestionTools(capturingServer as never, stubService as never);

    // Exactly the three tools — no more, no less
    expect(registeredTools).toEqual(
      expect.arrayContaining(["file_question", "answer_question", "list_questions"]),
    );
    expect(registeredTools).toHaveLength(3);
  });
});
