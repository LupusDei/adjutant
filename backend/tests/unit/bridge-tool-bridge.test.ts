/**
 * Tests for the read-only Bridge tool bridge (adj-202.3.2).
 *
 * The tool bridge is a READ-ONLY, whitelisted adapter that lets the Adjutant
 * avatar answer fleet-status questions by delegating to the SAME service layer
 * the MCP tools use. There must be no second control plane: every tool here
 * delegates to an existing service function, scopes by projectId, and rejects
 * anything outside the read-only whitelist.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProposalStore } from "../../src/services/proposal-store.js";
import type { AutoDevelopStore } from "../../src/services/auto-develop-store.js";
import type { QuestionService } from "../../src/services/question-service.js";

// Silence logger (if used by the module under test)
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock the underlying service layer the bridge delegates to.
const mockGetAgents = vi.fn();
vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
}));

const mockGetConnectedAgents = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getConnectedAgents: (...args: unknown[]) => mockGetConnectedAgents(...args),
}));

const mockGetProject = vi.fn();
vi.mock("../../src/services/projects-service.js", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

const mockExecBd = vi.fn();
const mockResolveBeadsDir = vi.fn();
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: (...args: unknown[]) => mockExecBd(...args),
  resolveBeadsDir: (...args: unknown[]) => mockResolveBeadsDir(...args),
}));

const mockBuildAutoDevelopStatus = vi.fn();
vi.mock("../../src/services/auto-develop-status.js", () => ({
  buildAutoDevelopStatus: (...args: unknown[]) => mockBuildAutoDevelopStatus(...args),
}));

// Import after mocks are set up.
import {
  createBridgeToolBridge,
  BRIDGE_READONLY_TOOLS,
  type BridgeToolDeps,
} from "../../src/services/bridge-tool-bridge.js";

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = "0e578d15-1111-2222-3333-444455556666";
const PROJECT = {
  id: PROJECT_ID,
  name: "adjutant",
  path: "/Users/x/code/adjutant",
  autoDevelop: true,
  autoDevelopPausedAt: null,
  visionContext: null,
  autoDevelopProductOwner: null,
};

function makeDeps(overrides: Partial<BridgeToolDeps> = {}): BridgeToolDeps {
  return {
    messageStore: {
      getMessages: vi.fn().mockReturnValue([]),
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"],
    proposalStore: { getProposals: vi.fn().mockReturnValue([]) } as unknown as ProposalStore,
    autoDevelopStore: {
      getActiveCycle: vi.fn().mockReturnValue(null),
      getCycleHistory: vi.fn().mockReturnValue([]),
    } as unknown as AutoDevelopStore,
    questionService: {
      listQuestions: vi.fn().mockReturnValue([]),
    } as unknown as Pick<QuestionService, "listQuestions">,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveBeadsDir.mockReturnValue("/Users/x/code/adjutant/.beads");
  mockGetProject.mockReturnValue({ success: true, data: PROJECT });
  mockGetAgents.mockResolvedValue({ success: true, data: [] });
  mockGetConnectedAgents.mockReturnValue([]);
});

// ============================================================================
// Whitelist
// ============================================================================

describe("createBridgeToolBridge — whitelist", () => {
  it("exposes exactly the five read-only tools", () => {
    expect([...BRIDGE_READONLY_TOOLS].sort()).toEqual(
      [
        "get_auto_develop_status",
        "get_project_state",
        "list_agents",
        "list_beads",
        "list_questions",
      ].sort(),
    );
    const bridge = createBridgeToolBridge(makeDeps());
    expect(bridge.listTools().sort()).toEqual([...BRIDGE_READONLY_TOOLS].sort());
  });

  it("isAllowed is true for whitelisted tools and false otherwise", () => {
    const bridge = createBridgeToolBridge(makeDeps());
    expect(bridge.isAllowed("list_agents")).toBe(true);
    expect(bridge.isAllowed("create_bead")).toBe(false);
    expect(bridge.isAllowed("nonsense")).toBe(false);
  });

  it("rejects an unknown tool with a structured TOOL_NOT_ALLOWED rejection", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "definitely_not_a_tool", projectId: PROJECT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("TOOL_NOT_ALLOWED");
    expect(mockExecBd).not.toHaveBeenCalled();
  });

  it("rejects a forbidden WRITE tool (e.g. close_bead) even though it exists in MCP", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    for (const forbidden of ["create_bead", "update_bead", "close_bead", "send_message", "answer_question"]) {
      const res = await bridge.executeTool({ tool: forbidden, projectId: PROJECT_ID });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("TOOL_NOT_ALLOWED");
    }
    expect(mockExecBd).not.toHaveBeenCalled();
  });
});

// ============================================================================
// list_agents — delegates, optional project filter
// ============================================================================

describe("list_agents", () => {
  it("delegates to getAgents + getConnectedAgents and returns structured data", async () => {
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [
        { id: "adjutant/Raynor", name: "Raynor", type: "engineer", project: PROJECT_ID, status: "working" },
        { id: "other/Kerrigan", name: "Kerrigan", type: "engineer", project: "other-proj", status: "idle" },
      ],
    });
    mockGetConnectedAgents.mockReturnValue([{ agentId: "adjutant/Raynor", sessionId: "s1", connectedAt: new Date() }]);

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents" });

    expect(mockGetAgents).toHaveBeenCalled();
    expect(mockGetConnectedAgents).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { agents: unknown[]; count: number };
      expect(data.count).toBe(2);
    }
  });

  it("filters agents by projectId when one is supplied (cross-project read)", async () => {
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [
        { id: "adjutant/Raynor", name: "Raynor", type: "engineer", project: PROJECT_ID, status: "working" },
        { id: "other/Kerrigan", name: "Kerrigan", type: "engineer", project: "other-proj", status: "idle" },
      ],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents", projectId: PROJECT_ID });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { agents: { id: string }[]; count: number };
      expect(data.count).toBe(1);
      expect(data.agents[0]!.id).toBe("adjutant/Raynor");
    }
  });

  it("rejects invalid args with INVALID_ARGS", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents", args: { status: "bogus" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_ARGS");
  });
});

// ============================================================================
// list_questions — delegates to questionService, projectId scoping
// ============================================================================

describe("list_questions", () => {
  it("delegates to questionService.listQuestions and scopes by projectId", async () => {
    const listQuestions = vi.fn().mockReturnValue([{ id: "q1" }]);
    const deps = makeDeps({ questionService: { listQuestions } });
    const bridge = createBridgeToolBridge(deps);

    const res = await bridge.executeTool({
      tool: "list_questions",
      projectId: PROJECT_ID,
      args: { status: "open", urgency: "blocking" },
    });

    expect(listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, status: "open", urgency: "blocking" }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { questions: unknown[]; count: number };
      expect(data.count).toBe(1);
    }
  });

  it("lists fleet-wide (no projectId) by passing undefined projectId through", async () => {
    const listQuestions = vi.fn().mockReturnValue([]);
    const deps = makeDeps({ questionService: { listQuestions } });
    const bridge = createBridgeToolBridge(deps);

    const res = await bridge.executeTool({ tool: "list_questions" });
    expect(res.ok).toBe(true);
    expect(listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: undefined }),
    );
  });
});

// ============================================================================
// list_beads — project-scoped, delegates to execBd with resolved path
// ============================================================================

describe("list_beads", () => {
  it("resolves the project and delegates to execBd scoped to the project's beads dir", async () => {
    mockExecBd.mockResolvedValue({
      success: true,
      exitCode: 0,
      data: [{ id: "adj-1", title: "T", status: "open", priority: 1, issue_type: "task" }],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({
      tool: "list_beads",
      projectId: PROJECT_ID,
      args: { status: "open" },
    });

    expect(mockGetProject).toHaveBeenCalledWith(PROJECT_ID);
    // delegates to execBd with cwd + beadsDir resolved from the named project
    expect(mockExecBd).toHaveBeenCalledWith(
      expect.arrayContaining(["list", "--json"]),
      expect.objectContaining({ cwd: PROJECT.path, beadsDir: "/Users/x/code/adjutant/.beads" }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { beads: unknown[]; count: number };
      expect(data.count).toBe(1);
    }
  });

  it("requires a projectId (PROJECT_REQUIRED when omitted)", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_beads" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PROJECT_REQUIRED");
    expect(mockExecBd).not.toHaveBeenCalled();
  });

  it("rejects an unknown projectId with PROJECT_NOT_FOUND", async () => {
    mockGetProject.mockReturnValue({ success: false, error: { code: "NOT_FOUND", message: "nope" } });
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_beads", projectId: "ghost" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PROJECT_NOT_FOUND");
    expect(mockExecBd).not.toHaveBeenCalled();
  });

  it("surfaces an underlying bd failure as a structured TOOL_FAILED rejection", async () => {
    mockExecBd.mockResolvedValue({ success: false, exitCode: 1, error: { code: "BD_ERR", message: "boom" } });
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_beads", projectId: PROJECT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("TOOL_FAILED");
  });
});

// ============================================================================
// get_project_state — project-scoped open-bead count via execBd
// ============================================================================

describe("get_project_state", () => {
  it("scopes the open-bead count to the named project and aggregates store state", async () => {
    mockExecBd.mockResolvedValue({
      success: true,
      exitCode: 0,
      data: [
        { id: "adj-1", status: "open" },
        { id: "adj-2", status: "closed" },
      ],
    });
    mockGetConnectedAgents.mockReturnValue([{ agentId: "a", sessionId: "s", connectedAt: new Date() }]);

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "get_project_state", projectId: PROJECT_ID });

    expect(mockExecBd).toHaveBeenCalledWith(
      expect.arrayContaining(["list", "--json"]),
      expect.objectContaining({ cwd: PROJECT.path }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { openBeads: number; connectedAgents: number };
      expect(data.openBeads).toBe(1);
      expect(data.connectedAgents).toBe(1);
    }
  });

  it("requires a projectId (PROJECT_REQUIRED when omitted)", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "get_project_state" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PROJECT_REQUIRED");
  });
});

// ============================================================================
// get_auto_develop_status — delegates to the shared status builder
// ============================================================================

describe("get_auto_develop_status", () => {
  it("resolves the project and delegates to buildAutoDevelopStatus", async () => {
    mockBuildAutoDevelopStatus.mockReturnValue({ enabled: true, paused: false });
    const deps = makeDeps();
    const bridge = createBridgeToolBridge(deps);

    const res = await bridge.executeTool({ tool: "get_auto_develop_status", projectId: PROJECT_ID });

    expect(mockGetProject).toHaveBeenCalledWith(PROJECT_ID);
    expect(mockBuildAutoDevelopStatus).toHaveBeenCalledWith(
      PROJECT,
      deps.proposalStore,
      deps.autoDevelopStore,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ enabled: true, paused: false });
  });

  it("requires a projectId (PROJECT_REQUIRED when omitted)", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "get_auto_develop_status" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PROJECT_REQUIRED");
  });
});
