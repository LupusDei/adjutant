/**
 * Tests for the avatar command write-paths (adj-202.4.2 / .4.3 / .4.4).
 *
 * Each reuses the REAL service the corresponding MCP tool uses (no second impl,
 * Rules 4+9): nudge → session bridge, answer_question → question-service, create_bead
 * → the bd CLI via execBd. Issued actions are attributed to the coordinator
 * ("adjutant"). Collaborators are mocked here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSessionBridge = vi.fn();
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: (...args: unknown[]) => mockGetSessionBridge(...args),
}));

const mockExecBd = vi.fn();
const mockResolveBeadsDir = vi.fn();
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: (...args: unknown[]) => mockExecBd(...args),
  resolveBeadsDir: (...args: unknown[]) => mockResolveBeadsDir(...args),
}));

const mockGetProject = vi.fn();
vi.mock("../../src/services/projects-service.js", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import {
  nudgeAgentViaBridge,
  answerQuestionViaBridge,
  createBeadViaBridge,
} from "../../src/services/bridge-commands.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveBeadsDir.mockReturnValue("/proj/.beads");
});

describe("nudgeAgentViaBridge", () => {
  it("injects a single-line nudge into the agent's live session and reports delivered", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => [{ id: "sess-A" }]) },
      sendInput,
    });

    const res = await nudgeAgentViaBridge({ agentId: "kerrigan", message: "check\nthe auth\nepic" });

    expect(sendInput).toHaveBeenCalledWith("sess-A", "check the auth epic"); // newlines collapsed
    expect(res).toEqual({ agentId: "kerrigan", delivered: true });
  });

  it("reports not delivered when the agent has no live session (not ambiguous, just offline)", async () => {
    mockGetSessionBridge.mockReturnValue({
      registry: { findByName: vi.fn(() => []) },
      sendInput: vi.fn(),
    });
    const res = await nudgeAgentViaBridge({ agentId: "ghost", message: "hi" });
    expect(res).toEqual({ agentId: "ghost", delivered: false });
  });

  it("survives an uninitialized session bridge", async () => {
    mockGetSessionBridge.mockImplementation(() => {
      throw new Error("bridge not ready");
    });
    const res = await nudgeAgentViaBridge({ agentId: "kerrigan", message: "hi" });
    expect(res).toEqual({ agentId: "kerrigan", delivered: false });
  });
});

describe("answerQuestionViaBridge", () => {
  it("answers via the question-service, attributed to the coordinator", async () => {
    const answerQuestion = vi.fn().mockResolvedValue({ id: "q1", status: "answered" });
    const res = await answerQuestionViaBridge({ answerQuestion }, { questionId: "q1", chosenOption: "Redis" });

    expect(answerQuestion).toHaveBeenCalledWith("q1", { answeredBy: "adjutant", chosenOption: "Redis" });
    expect(res).toEqual({ questionId: "q1", status: "answered" });
  });

  it("passes an answerBody through when given", async () => {
    const answerQuestion = vi.fn().mockResolvedValue({ id: "q2", status: "answered" });
    await answerQuestionViaBridge({ answerQuestion }, { questionId: "q2", answerBody: "go with SQLite" });
    expect(answerQuestion).toHaveBeenCalledWith("q2", { answeredBy: "adjutant", answerBody: "go with SQLite" });
  });

  it("propagates a service error (e.g. unknown question id)", async () => {
    const answerQuestion = vi.fn().mockRejectedValue(new Error("Question not found: qX"));
    await expect(
      answerQuestionViaBridge({ answerQuestion }, { questionId: "qX", answerBody: "x" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("createBeadViaBridge", () => {
  it("files a bead in the named project via execBd and returns the new id", async () => {
    mockGetProject.mockReturnValue({ success: true, data: { id: "uuid-1", name: "adjutant", path: "/proj" } });
    mockExecBd.mockResolvedValue({ success: true, data: { id: "adj-999" } });

    const res = await createBeadViaBridge({ title: "Fix login", description: "users locked out", type: "bug", projectId: "uuid-1" });

    expect(mockGetProject).toHaveBeenCalledWith("uuid-1");
    const [args, opts] = mockExecBd.mock.calls[0]!;
    expect(args).toEqual([
      "create", "--json", "--title", "Fix login", "--description", "users locked out", "--type", "bug", "--priority", "2",
    ]);
    expect(opts).toMatchObject({ cwd: "/proj", beadsDir: "/proj/.beads" });
    expect(res).toEqual({ beadId: "adj-999", title: "Fix login", projectId: "uuid-1" });
  });

  it("defaults to the 'adjutant' project when no projectId is given, and type 'task' + description=title", async () => {
    mockGetProject.mockReturnValue({ success: true, data: { id: "uuid-adj", name: "adjutant", path: "/adj" } });
    mockExecBd.mockResolvedValue({ success: true, data: { id: "adj-1000" } });

    await createBeadViaBridge({ title: "Write the runbook" });

    expect(mockGetProject).toHaveBeenCalledWith("adjutant");
    const args = mockExecBd.mock.calls[0]![0] as string[];
    expect(args).toContain("task"); // default type
    // description defaults to the title when omitted
    const descIdx = args.indexOf("--description");
    expect(args[descIdx + 1]).toBe("Write the runbook");
  });

  it("throws when the target project cannot be resolved", async () => {
    mockGetProject.mockReturnValue({ success: false, data: null });
    await expect(createBeadViaBridge({ title: "x", projectId: "missing" })).rejects.toThrow(/not found/i);
  });

  it("throws when bd create fails", async () => {
    mockGetProject.mockReturnValue({ success: true, data: { id: "u", name: "adjutant", path: "/p" } });
    mockExecBd.mockResolvedValue({ success: false, error: { message: "bd boom" } });
    await expect(createBeadViaBridge({ title: "x" })).rejects.toThrow(/bd boom/);
  });
});
