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

// Real `bd list --json` output shape (Constitution Rule 1) — captured from the
// live bd CLI, not hand-crafted from the TypeScript interface. Includes the
// fields production parses (status) plus the surrounding shape the avatar may
// render (description, issue_type, created_at, dependencies, *_count).
const REAL_BD_LIST_OUTPUT = [
  {
    id: "adj-202.2",
    title: "Phase 0: Spike (GATING)",
    description: "Prove the tool-loop before MVP; measure latency/injection/renew; go-no-go.",
    status: "open",
    priority: 0,
    issue_type: "epic",
    owner: "lupusdei108@gmail.com",
    created_at: "2026-06-27T14:10:19Z",
    created_by: "Justin Martin",
    updated_at: "2026-06-27T14:10:19Z",
    dependencies: [
      {
        issue_id: "adj-202.2",
        depends_on_id: "adj-202.1",
        type: "blocks",
        created_at: "2026-06-27T09:11:07Z",
        created_by: "Justin Martin",
        metadata: "{}",
      },
    ],
    dependency_count: 1,
    dependent_count: 1,
    comment_count: 0,
  },
  {
    id: "adj-202.3.2",
    title: "bridge-tool-bridge.ts (TDD)",
    description: "Read-only whitelist adapter over existing MCP service layer.",
    status: "closed",
    priority: 1,
    issue_type: "task",
    owner: "lupusdei108@gmail.com",
    created_at: "2026-06-27T14:10:30Z",
    created_by: "Justin Martin",
    updated_at: "2026-06-27T17:51:00Z",
    closed_at: "2026-06-27T17:51:00Z",
    dependencies: [],
    dependency_count: 0,
    dependent_count: 1,
    comment_count: 0,
  },
];

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
  it("exposes exactly the seven read-only tools", () => {
    expect([...BRIDGE_READONLY_TOOLS].sort()).toEqual(
      [
        "get_agent_detail",
        "get_auto_develop_status",
        "get_project_state",
        "list_agents",
        "list_beads",
        "list_questions",
        "read_messages",
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
  // NOTE (adj-202.3.2.1 / Constitution Rule 1): getAgents() sets CrewMember.project
  // to the project NAME (via resolveProjectName), NEVER the UUID. These fixtures use
  // the real shape (project: "adjutant") so the cross-project filter is tested against
  // production reality — an earlier UUID fixture masked a real zero-results bug.
  it("delegates to getAgents + getConnectedAgents and returns structured data", async () => {
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [
        { id: "adjutant/Raynor", name: "Raynor", type: "engineer", project: "adjutant", status: "working" },
        { id: "other/Kerrigan", name: "Kerrigan", type: "engineer", project: "other", status: "idle" },
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

  it("filters agents by projectId by resolving the UUID to the project NAME (cross-project read)", async () => {
    // Agents carry the project NAME; the caller names the project by UUID.
    // getProject(PROJECT_ID) resolves to { name: "adjutant" } (beforeEach default),
    // so the filter must match Raynor (project: "adjutant") and exclude Kerrigan.
    // This FAILS against the old `a.project === projectId` (UUID) comparison.
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [
        { id: "adjutant/Raynor", name: "Raynor", type: "engineer", project: "adjutant", status: "working" },
        { id: "other/Kerrigan", name: "Kerrigan", type: "engineer", project: "other", status: "idle" },
      ],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents", projectId: PROJECT_ID });

    expect(mockGetProject).toHaveBeenCalledWith(PROJECT_ID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { agents: { id: string }[]; count: number };
      expect(data.count).toBe(1);
      expect(data.agents[0]!.id).toBe("adjutant/Raynor");
    }
  });

  it("returns PROJECT_NOT_FOUND when list_agents is scoped to an unknown projectId", async () => {
    mockGetProject.mockReturnValue({ success: false, error: { code: "NOT_FOUND", message: "nope" } });
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [{ id: "adjutant/Raynor", name: "Raynor", type: "engineer", project: "adjutant", status: "working" }],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents", projectId: "ghost" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("rejects invalid args with INVALID_ARGS", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents", args: { status: "bogus" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_ARGS");
  });

  it("throws-path: a getAgents rejection is caught and returned as TOOL_FAILED", async () => {
    mockGetAgents.mockRejectedValue(new Error("agents service down"));
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("TOOL_FAILED");
      expect(res.error.message).toContain("agents service down");
    }
  });
});

// ============================================================================
// get_agent_detail — resolve name → status + in-progress beads (adj-202.9)
// ============================================================================

describe("get_agent_detail", () => {
  it("resolves the agent by name (case-insensitive) and returns status + in-progress beads", async () => {
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [
        { id: "adjutant/swann", name: "swann", type: "engineer", project: "adjutant", status: "idle", currentTask: null },
      ],
    });
    mockGetConnectedAgents.mockReturnValue([]);
    mockGetProject.mockReturnValue({ success: true, data: { id: "p1", name: "adjutant", path: "/repo" } });
    mockResolveBeadsDir.mockReturnValue("/repo/.beads");
    mockExecBd.mockResolvedValue({
      success: true,
      data: [{ id: "adj-139", title: "Frontend Performance Overhaul", status: "in_progress" }],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "get_agent_detail", args: { agent: "Swann" } });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as {
        agent: { name: string; status: string };
        inProgressBeads: { id: string }[];
        inProgressCount: number;
      };
      expect(data.agent.name).toBe("swann");
      expect(data.inProgressCount).toBe(1);
      expect(data.inProgressBeads[0]!.id).toBe("adj-139");
    }
    expect(mockExecBd).toHaveBeenCalledWith(
      expect.arrayContaining(["list", "--assignee", "swann", "--status", "in_progress"]),
      expect.anything(),
    );
  });

  it("returns AGENT_NOT_FOUND for an unknown name (no phantom lookup)", async () => {
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [{ id: "a/fenix", name: "fenix", type: "engineer", project: "adjutant", status: "idle" }],
    });
    mockGetConnectedAgents.mockReturnValue([]);

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "get_agent_detail", args: { agent: "zzzzzzzz" } });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("AGENT_NOT_FOUND");
  });

  it("rejects invalid args (missing agent) with INVALID_ARGS", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "get_agent_detail", args: {} });
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

  it("rejects invalid args (bad urgency enum) with INVALID_ARGS", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_questions", args: { urgency: "ASAP" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_ARGS");
  });

  it("throws-path: a questionService failure is caught and returned as TOOL_FAILED", async () => {
    const listQuestions = vi.fn().mockImplementation(() => {
      throw new Error("question store offline");
    });
    const bridge = createBridgeToolBridge(makeDeps({ questionService: { listQuestions } }));
    const res = await bridge.executeTool({ tool: "list_questions", projectId: PROJECT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("TOOL_FAILED");
      expect(res.error.message).toContain("question store offline");
    }
  });
});

// ============================================================================
// list_beads — project-scoped, delegates to execBd with resolved path
// ============================================================================

describe("list_beads", () => {
  it("resolves the project and delegates to execBd scoped to the project's beads dir", async () => {
    // Real bd output shape (Rule 1) returned verbatim in the structured result.
    mockExecBd.mockResolvedValue({ success: true, exitCode: 0, data: REAL_BD_LIST_OUTPUT });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({
      tool: "list_beads",
      projectId: PROJECT_ID,
      args: { status: "all" },
    });

    expect(mockGetProject).toHaveBeenCalledWith(PROJECT_ID);
    // delegates to execBd with cwd + beadsDir resolved from the named project
    expect(mockExecBd).toHaveBeenCalledWith(
      expect.arrayContaining(["list", "--json"]),
      expect.objectContaining({ cwd: PROJECT.path, beadsDir: "/Users/x/code/adjutant/.beads" }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { beads: typeof REAL_BD_LIST_OUTPUT; count: number };
      expect(data.count).toBe(2);
      // Structured result is the source of truth — full bd records pass through verbatim.
      expect(data.beads[0]).toEqual(REAL_BD_LIST_OUTPUT[0]);
      expect(data.beads[0]!.dependencies[0]!.depends_on_id).toBe("adj-202.1");
    }
  });

  it("throws-path: an execBd rejection is caught and returned as TOOL_FAILED", async () => {
    mockExecBd.mockRejectedValue(new Error("dolt server unreachable"));
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_beads", projectId: PROJECT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("TOOL_FAILED");
      expect(res.error.message).toContain("dolt server unreachable");
    }
  });

  it("rejects invalid args (bad status enum) with INVALID_ARGS before touching bd", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_beads", projectId: PROJECT_ID, args: { status: "nope" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_ARGS");
    expect(mockExecBd).not.toHaveBeenCalled();
  });

  it("rejects with PROJECT_NOT_FOUND when resolveBeadsDir throws for the named project", async () => {
    // getProject succeeds but the project's .beads/ cannot be resolved.
    mockResolveBeadsDir.mockImplementation(() => {
      throw new Error("no .beads dir");
    });
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_beads", projectId: PROJECT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PROJECT_NOT_FOUND");
    expect(mockExecBd).not.toHaveBeenCalled();
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
  it("scopes openBeads + connectedAgents to the project and labels fleet-wide fields separately", async () => {
    // Real bd output: 1 open + 1 closed ⇒ openBeads = 1 (project-scoped).
    mockExecBd.mockResolvedValue({ success: true, exitCode: 0, data: REAL_BD_LIST_OUTPUT });

    // Two connected agents: one in the target project, one in another project.
    // connectedAgents must count ONLY the target project's session (grounding).
    mockGetConnectedAgents.mockReturnValue([
      { agentId: "adjutant/Raynor", sessionId: "s1", connectedAt: new Date(), projectContext: { projectId: PROJECT_ID } },
      { agentId: "other/Kerrigan", sessionId: "s2", connectedAt: new Date(), projectContext: { projectId: "other-uuid" } },
    ]);

    const messageStore = {
      getMessages: vi.fn().mockReturnValue([{ id: "m1" }, { id: "m2" }, { id: "m3" }]),
      getUnreadCounts: vi.fn().mockReturnValue([{ agentId: "x", count: 4 }]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    const res = await bridge.executeTool({ tool: "get_project_state", projectId: PROJECT_ID });

    expect(mockExecBd).toHaveBeenCalledWith(
      expect.arrayContaining(["list", "--json"]),
      expect.objectContaining({ cwd: PROJECT.path }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as {
        projectId: string;
        project: { openBeads: number; connectedAgents: number };
        fleet: { recentMessages: number; unreadCounts: unknown[] };
      };
      // Project-scoped block.
      expect(data.project.openBeads).toBe(1);
      expect(data.project.connectedAgents).toBe(1);
      // Fleet-wide block is explicitly separated so it can't be read as this project's.
      expect(data.fleet.recentMessages).toBe(3);
      expect(data.fleet.unreadCounts).toHaveLength(1);
      // No flat fleet-wide field leaks at the top level (grounding contract).
      expect((data as Record<string, unknown>)["connectedAgents"]).toBeUndefined();
      expect((data as Record<string, unknown>)["recentMessages"]).toBeUndefined();
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

  it("rejects an unknown projectId with PROJECT_NOT_FOUND", async () => {
    mockGetProject.mockReturnValue({ success: false, error: { code: "NOT_FOUND", message: "nope" } });
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "get_auto_develop_status", projectId: "ghost" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PROJECT_NOT_FOUND");
    expect(mockBuildAutoDevelopStatus).not.toHaveBeenCalled();
  });

  it("throws-path: a buildAutoDevelopStatus failure is caught and returned as TOOL_FAILED", async () => {
    mockBuildAutoDevelopStatus.mockImplementation(() => {
      throw new Error("proposal store exploded");
    });
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "get_auto_develop_status", projectId: PROJECT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("TOOL_FAILED");
      expect(res.error.message).toContain("proposal store exploded");
    }
  });
});

// ============================================================================
// read_messages — fleet-wide message recall (adj-202.11)
// ============================================================================

describe("read_messages", () => {
  const SAMPLE_MESSAGES = [
    // Store returns newest-first (created_at DESC).
    {
      id: "m3", agentId: "fenix", recipient: "user", role: "agent",
      body: "Phase 2 complete", conversationId: "dm_x", createdAt: "2026-06-29T03:00:00Z",
    },
    {
      id: "m2", agentId: "user", recipient: "fenix", role: "user",
      body: "How is the bridge epic?", conversationId: "dm_x", createdAt: "2026-06-29T02:00:00Z",
    },
    {
      id: "m1", agentId: "fenix", recipient: "user", role: "agent",
      body: "Starting adj-202", conversationId: "dm_x", createdAt: "2026-06-29T01:00:00Z",
    },
  ];

  it("returns messages (sender, recipient, body, timestamp) + count, oldest-first for narration", async () => {
    const getMessages = vi.fn().mockReturnValue(SAMPLE_MESSAGES);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    const res = await bridge.executeTool({ tool: "read_messages", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { messages: { id: string; sender: string; recipient: string | null; body: string; timestamp: string }[]; count: number };
      expect(data.count).toBe(3);
      // Presented oldest → newest so the avatar narrates the discussion in order.
      expect(data.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
      expect(data.messages[0]).toMatchObject({
        id: "m1", sender: "fenix", recipient: "user", body: "Starting adj-202", timestamp: "2026-06-29T01:00:00Z",
      });
    }
    // Default limit applied (10) when none supplied — small payload for the RPC return.
    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });

  it("resolves a spoken agent name to the canonical id before filtering (Fenix → fenix)", async () => {
    mockGetAgents.mockResolvedValue({ success: true, data: [{ id: "adjutant/fenix", name: "fenix" }] });
    const getMessages = vi.fn().mockReturnValue([]);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    const res = await bridge.executeTool({ tool: "read_messages", args: { agentId: "Fenix" } });

    expect(res.ok).toBe(true);
    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ agentId: "fenix" }));
  });

  it("falls back to the raw name (NOT an error) when a name can't be resolved — reading history with OFFLINE agents", async () => {
    // Only fenix is a live agent; kerrigan is offline (not in getAgents) but has message history.
    mockGetAgents.mockResolvedValue({ success: true, data: [{ id: "adjutant/fenix", name: "fenix" }] });
    const getMessages = vi.fn().mockReturnValue([]);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    const res = await bridge.executeTool({ tool: "read_messages", args: { agentId: "kerrigan" } });

    // Message history is usually with agents not currently running, so an unresolved name is NOT
    // an error — filter by the provided name as-is (empty result if truly unknown, never a reject).
    expect(res.ok).toBe(true);
    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ agentId: "kerrigan" }));
  });

  it("caps the limit at 15 even if a larger value is requested (keep the RPC payload small)", async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    await bridge.executeTool({ tool: "read_messages", args: { limit: 500 } });

    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ limit: 15 }));
  });

  it("scopes strictly to a conversationId when given (bleed-free)", async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    await bridge.executeTool({ tool: "read_messages", args: { conversationId: "dm_abc" } });

    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "dm_abc" }));
  });

  it("returns an empty result (count 0) when there are no messages", async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    const res = await bridge.executeTool({ tool: "read_messages", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { messages: unknown[]; count: number };
      expect(data.messages).toEqual([]);
      expect(data.count).toBe(0);
    }
  });
});
