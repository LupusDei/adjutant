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
const mockListProjects = vi.fn();
vi.mock("../../src/services/projects-service.js", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
  listProjects: (...args: unknown[]) => mockListProjects(...args),
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
    memoryStore: {
      searchLearnings: vi.fn().mockReturnValue([]),
      queryLearnings: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["memoryStore"],
    eventStore: {
      getEvents: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["eventStore"],
    conversationStore: {
      listChannels: vi.fn().mockReturnValue([]),
      getMembers: vi.fn().mockReturnValue([]),
      getConversationsForMember: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["conversationStore"],
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
  it("exposes exactly the eleven read-only tools", () => {
    expect([...BRIDGE_READONLY_TOOLS].sort()).toEqual(
      [
        "get_agent_detail",
        "get_auto_develop_status",
        "get_project_state",
        "list_agents",
        "list_beads",
        "list_channels",
        "list_projects",
        "list_questions",
        "list_timeline",
        "read_messages",
        "query_memories",
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

  it("stays FLEET-WIDE when the session projectId is injected — does NOT scope the roster (bug: avatar saw 0 agents)", async () => {
    // REGRESSION (adj-210): the Bridge RPC handler auto-injects the session's default
    // projectId into EVERY tool call. list_agents is a FLEET-WIDE tool (like the Overview
    // page's agent list), so an injected projectId must NOT scope it — otherwise the whole
    // roster vanishes whenever the session's project has no matching crew.
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [
        { id: "adjutant/Raynor", name: "Raynor", type: "engineer", project: "adjutant", status: "working" },
        { id: "other/Kerrigan", name: "Kerrigan", type: "engineer", project: "other", status: "idle" },
      ],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents", projectId: PROJECT_ID });

    expect(mockGetAgents).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { agents: { id: string }[]; count: number };
      // BOTH agents — the injected session project did NOT scope the fleet roster.
      expect(data.count).toBe(2);
    }
  });

  it("filters ONLY when a project is EXPLICITLY named (args.project), resolving name → crew", async () => {
    // getAgents() sets CrewMember.project to the project NAME; getProject resolves a NAME
    // (or UUID) to the registry record, so the filter matches Raynor and excludes Kerrigan.
    mockGetProject.mockReturnValue({ success: true, data: { id: PROJECT_ID, name: "adjutant", path: "/tmp/adjutant" } });
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [
        { id: "adjutant/Raynor", name: "Raynor", type: "engineer", project: "adjutant", status: "working" },
        { id: "other/Kerrigan", name: "Kerrigan", type: "engineer", project: "other", status: "idle" },
      ],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents", projectId: PROJECT_ID, args: { project: "adjutant" } });

    expect(mockGetProject).toHaveBeenCalledWith("adjutant");
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { agents: { id: string }[]; count: number };
      expect(data.count).toBe(1);
      expect(data.agents[0]!.id).toBe("adjutant/Raynor");
    }
  });

  it("returns PROJECT_NOT_FOUND when an EXPLICITLY named project is unknown", async () => {
    mockGetProject.mockReturnValue({ success: false, error: { code: "NOT_FOUND", message: "nope" } });
    mockGetAgents.mockResolvedValue({
      success: true,
      data: [{ id: "adjutant/Raynor", name: "Raynor", type: "engineer", project: "adjutant", status: "working" }],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_agents", args: { project: "ghost" } });
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
      // COMPACT projection (adj-x6qln follow-up): full bd records (~45KB for 50 tasks) blow the RPC
      // return, so list_beads returns only id/title/status/priority/type. count = true total.
      const data = res.data as {
        beads: { id: string; title: string; status: string; type: string }[];
        count: number;
      };
      expect(data.count).toBe(2);
      expect(data.beads[0]!.id).toBe(REAL_BD_LIST_OUTPUT[0]!.id);
      expect(data.beads[0]!.title).toBe(REAL_BD_LIST_OUTPUT[0]!.title);
      expect(data.beads[0]!.status).toBe(REAL_BD_LIST_OUTPUT[0]!.status);
      // Heavy fields (description/dependencies) are intentionally dropped from the RPC payload.
      expect((data.beads[0] as Record<string, unknown>).dependencies).toBeUndefined();
    }
  });

  it("tolerates JSON null for unset optional args (regression: avatar sends assignee=null) — adj-x6qln", async () => {
    // GWM-1 sends unset optionals as null; .optional() schemas reject null → INVALID_ARGS. The
    // Commander's exact call (assignee=null, status=open, type=task) must now succeed.
    mockExecBd.mockResolvedValue({ success: true, exitCode: 0, data: REAL_BD_LIST_OUTPUT });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({
      tool: "list_beads",
      projectId: PROJECT_ID,
      args: { assignee: null, status: "open", type: "task", project: null } as unknown as Record<string, unknown>,
    });

    expect(res.ok).toBe(true); // NOT an INVALID_ARGS rejection
    // null assignee is treated as unset → no --assignee flag passed to bd
    expect(mockExecBd).toHaveBeenCalledWith(
      expect.not.arrayContaining(["--assignee"]),
      expect.anything(),
    );
    expect(mockExecBd).toHaveBeenCalledWith(
      expect.arrayContaining(["--status", "open", "--type", "task"]),
      expect.anything(),
    );
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
// Cross-project lookup — list_beads by project NAME + list_projects (adj-202)
// ============================================================================

describe("cross-project lookup", () => {
  it("list_beads resolves a spoken project NAME (args.project) over the session default", async () => {
    // The dispatch injects the default projectId ("adjutant"); a spoken project name must win so
    // "list beads for my_finances" hits THAT project, not the default.
    mockGetProject.mockReturnValue({ success: true, data: { id: "pf", name: "my_finances", path: "/fin" } });
    mockResolveBeadsDir.mockReturnValue("/fin/.beads");
    mockExecBd.mockResolvedValue({ success: true, data: [{ id: "fin-1", title: "Reconcile", status: "open" }] });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_beads", projectId: "adjutant", args: { project: "my_finances" } });

    expect(res.ok).toBe(true);
    // getProject was resolved with the SPOKEN name, not the injected default.
    expect(mockGetProject).toHaveBeenCalledWith("my_finances");
    if (res.ok) expect((res.data as { count: number }).count).toBe(1);
  });

  it("list_projects returns the fleet roster by name", async () => {
    mockListProjects.mockReturnValue({
      success: true,
      data: [
        { id: "p1", name: "adjutant", path: "/a" },
        { id: "p2", name: "my_finances", path: "/f" },
      ],
    });

    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "list_projects", projectId: "adjutant", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { projects: { name: string }[]; count: number };
      expect(data.count).toBe(2);
      expect(data.projects.map((p) => p.name).sort()).toEqual(["adjutant", "my_finances"]);
    }
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

  it("returns from/to/text messages, oldest-first, for narration", async () => {
    const getMessages = vi.fn().mockReturnValue(SAMPLE_MESSAGES);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    const res = await bridge.executeTool({ tool: "read_messages", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { messages: { from: string; to: string; text: string }[]; count: number };
      expect(data.count).toBe(3);
      // Oldest → newest so the avatar narrates the discussion in order; compact fields only.
      expect(data.messages.map((m) => m.text)).toEqual(["Starting adj-202", "How is the bridge epic?", "Phase 2 complete"]);
      expect(data.messages[0]).toEqual({ from: "fenix", to: "user", text: "Starting adj-202" });
    }
    // Default limit applied (15) when none supplied.
    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ limit: 15 }));
  });

  it("returns a long message IN FULL, not a 300-char preview (adj-202.11.1)", async () => {
    // ~2,500-char agent message — the kind the Commander asks the avatar to summarize.
    const longBody = "The squad shipped Artifacts. ".repeat(90); // ~2,610 chars
    const getMessages = vi.fn().mockReturnValue([
      { id: "m1", agentId: "abathur", recipient: "user", role: "agent", body: longBody, conversationId: "dm_x", createdAt: "2026-08-10T00:00:00Z" },
    ]);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    const res = await bridge.executeTool({ tool: "read_messages", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { messages: { text: string }[] };
      // The whole message comes through (well past the old 300-char cap), capped only at 4000.
      expect(data.messages[0].text.length).toBeGreaterThan(2000);
      expect(data.messages[0].text.length).toBeLessThanOrEqual(4000);
    }
  });

  it("keeps the NEWEST messages whole and drops the oldest once the total-size budget is hit", async () => {
    // 6 large messages (~3k chars each) exceed the ~11k total budget → only the newest few survive.
    const big = (n: number) => ({
      id: `m${n}`, agentId: "abathur", recipient: "user", role: "agent",
      body: `msg${n} `.padEnd(3000, "z"), conversationId: "dm_x",
      createdAt: `2026-08-1${n}T00:00:00Z`,
    });
    // Store returns newest-first: m6 (newest) ... m1 (oldest).
    const getMessages = vi.fn().mockReturnValue([big(6), big(5), big(4), big(3), big(2), big(1)]);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    const res = await bridge.executeTool({ tool: "read_messages", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { messages: { text: string }[]; count: number; olderOmittedForSize?: number };
      // Fewer than 6 survive (budget-bounded), and it flags how many were dropped.
      expect(data.count).toBeLessThan(6);
      expect(data.olderOmittedForSize).toBe(6 - data.count);
      // The NEWEST message (m6) is retained (last in oldest-first order).
      expect(data.messages[data.messages.length - 1].text).toContain("msg6");
    }
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

  it("caps the fetch limit at 30 even if a larger value is requested (the total-size budget bounds the payload)", async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const messageStore = {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];

    const bridge = createBridgeToolBridge(makeDeps({ messageStore }));
    await bridge.executeTool({ tool: "read_messages", args: { limit: 500 } });

    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
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

// ============================================================================
// query_memories — cross-session recall via the adjutant MemoryStore (adj-202.6.1)
// ============================================================================

describe("query_memories", () => {
  // Real Learning shape (camelCase) the MemoryStore returns.
  function learning(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      id: 7,
      category: "operational",
      topic: "deploy",
      content: "Commander prefers blue-green deploys with a 10-minute canary window.",
      sourceType: "bridge",
      sourceRef: "adjutant",
      confidence: 0.8,
      reinforcementCount: 2,
      lastAppliedAt: null,
      lastValidatedAt: null,
      supersededBy: null,
      createdAt: "2026-06-30T01:00:00Z",
      updatedAt: "2026-06-30T01:00:00Z",
      ...over,
    };
  }

  function memDeps(over: Record<string, unknown> = {}): BridgeToolDeps["memoryStore"] {
    return {
      searchLearnings: vi.fn().mockReturnValue([]),
      queryLearnings: vi.fn().mockReturnValue([]),
      ...over,
    } as unknown as BridgeToolDeps["memoryStore"];
  }

  it("runs FTS when a query string is given and returns mapped memories + count", async () => {
    const searchLearnings = vi.fn().mockReturnValue([learning()]);
    const queryLearnings = vi.fn().mockReturnValue([]);
    const memoryStore = memDeps({ searchLearnings, queryLearnings });

    const bridge = createBridgeToolBridge(makeDeps({ memoryStore }));
    const res = await bridge.executeTool({ tool: "query_memories", args: { query: "deploy preferences" } });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { memories: { id: number; topic: string; content: string; source: string | null }[]; count: number };
      expect(data.count).toBe(1);
      expect(data.memories[0]).toMatchObject({ id: 7, topic: "deploy", source: "adjutant" });
    }
    // FTS path used; default limit 8 applied; structured (queryLearnings) NOT used.
    expect(searchLearnings).toHaveBeenCalledWith("deploy preferences", 8);
    expect(queryLearnings).not.toHaveBeenCalled();
  });

  it("uses a structured query (category/topic/confidence) when no text query is given", async () => {
    const searchLearnings = vi.fn().mockReturnValue([]);
    const queryLearnings = vi.fn().mockReturnValue([learning({ id: 3, topic: "tone" })]);
    const memoryStore = memDeps({ searchLearnings, queryLearnings });

    const bridge = createBridgeToolBridge(makeDeps({ memoryStore }));
    const res = await bridge.executeTool({
      tool: "query_memories",
      args: { category: "coordination", topic: "tone", minConfidence: 0.6 },
    });

    expect(res.ok).toBe(true);
    expect(searchLearnings).not.toHaveBeenCalled();
    expect(queryLearnings).toHaveBeenCalledWith({
      limit: 8,
      category: "coordination",
      topic: "tone",
      minConfidence: 0.6,
    });
  });

  it("caps the limit at 10 even if a larger value is requested (keep the RPC payload small)", async () => {
    const searchLearnings = vi.fn().mockReturnValue([]);
    const memoryStore = memDeps({ searchLearnings });

    const bridge = createBridgeToolBridge(makeDeps({ memoryStore }));
    await bridge.executeTool({ tool: "query_memories", args: { query: "x", limit: 500 } });

    expect(searchLearnings).toHaveBeenCalledWith("x", 10);
  });

  it("truncates long learning content for the RPC payload", async () => {
    const longContent = "z".repeat(400);
    const searchLearnings = vi.fn().mockReturnValue([learning({ content: longContent })]);
    const memoryStore = memDeps({ searchLearnings });

    const bridge = createBridgeToolBridge(makeDeps({ memoryStore }));
    const res = await bridge.executeTool({ tool: "query_memories", args: { query: "x" } });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { memories: { content: string }[] };
      // 280-char cap + ellipsis.
      expect(data.memories[0]!.content.length).toBe(281);
      expect(data.memories[0]!.content.endsWith("…")).toBe(true);
    }
  });

  it("rejects an invalid category (defensive — reachable from the avatar's tool loop)", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "query_memories", args: { category: "nonsense" } });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_ARGS");
  });

  it("returns an empty result (count 0) when nothing matches", async () => {
    const bridge = createBridgeToolBridge(makeDeps());
    const res = await bridge.executeTool({ tool: "query_memories", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { memories: unknown[]; count: number };
      expect(data.memories).toEqual([]);
      expect(data.count).toBe(0);
    }
  });
});

// ============================================================================
// list_timeline (adj-ni4dh) — recent fleet-activity feed for spoken summaries
// ============================================================================

describe("list_timeline", () => {
  const EVENTS = [
    { id: "e1", eventType: "bead_closed", agentId: "fenix", action: "Closed adj-202.6", detail: null, beadId: "adj-202.6", messageId: null, createdAt: "2026-08-09T17:00:00Z" },
    { id: "e2", eventType: "status_change", agentId: "raynor", action: "working", detail: null, beadId: null, messageId: null, createdAt: "2026-08-09T16:59:00Z" },
  ];

  it("returns the recent events in a compact projection", async () => {
    const eventStore = { getEvents: vi.fn().mockReturnValue(EVENTS) } as unknown as BridgeToolDeps["eventStore"];
    const bridge = createBridgeToolBridge(makeDeps({ eventStore }));
    const res = await bridge.executeTool({ tool: "list_timeline", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { events: Record<string, unknown>[]; count: number };
      expect(data.count).toBe(2);
      expect(data.events[0]).toEqual({
        time: "2026-08-09T17:00:00Z",
        type: "bead_closed",
        agent: "fenix",
        action: "Closed adj-202.6",
        beadId: "adj-202.6",
      });
    }
  });

  it("defaults to the last 50 and caps the limit at 50", async () => {
    const getEvents = vi.fn().mockReturnValue([]);
    const bridge = createBridgeToolBridge(makeDeps({ eventStore: { getEvents } as unknown as BridgeToolDeps["eventStore"] }));

    await bridge.executeTool({ tool: "list_timeline", args: {} });
    expect(getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }));

    await bridge.executeTool({ tool: "list_timeline", args: { limit: 999 } });
    expect(getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it("focuses one agent's activity when agentId is passed", async () => {
    const getEvents = vi.fn().mockReturnValue([]);
    const bridge = createBridgeToolBridge(makeDeps({ eventStore: { getEvents } as unknown as BridgeToolDeps["eventStore"] }));

    await bridge.executeTool({ tool: "list_timeline", args: { agentId: "fenix" } });
    expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({ agentId: "fenix", limit: 50 }));
  });

  it("clips an over-long action so the payload stays under the RPC ceiling", async () => {
    const longAction = "x".repeat(500);
    const eventStore = {
      getEvents: vi.fn().mockReturnValue([{ id: "e", eventType: "announcement", agentId: "a", action: longAction, detail: null, beadId: null, messageId: null, createdAt: "t" }]),
    } as unknown as BridgeToolDeps["eventStore"];
    const bridge = createBridgeToolBridge(makeDeps({ eventStore }));
    const res = await bridge.executeTool({ tool: "list_timeline", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { events: { action: string }[] };
      expect(data.events[0].action.length).toBeLessThan(longAction.length);
      expect(data.events[0].action.endsWith("…")).toBe(true);
    }
  });

  it("is on the whitelist (isAllowed)", () => {
    const bridge = createBridgeToolBridge(makeDeps());
    expect(bridge.isAllowed("list_timeline")).toBe(true);
  });
});

// ============================================================================
// list_channels + channel reads (adj-6fg1g)
//
// The Bridge speaks as the coordinator and is a NON-MEMBER observer of most
// channels (channels shared by multiple agents are exactly that case). Its read
// surface must therefore (a) let it DISCOVER channels by name and (b) scope a
// read to one channel WITHOUT a membership check — mirroring the adj-egziw
// operator exemption. The membership gate that keeps non-member AGENTS out lives
// on the WS fan-out path (ws-server) and is untouched by this surface.
// ============================================================================

const CHANNELS = [
  {
    id: "conv_ops",
    kind: "channel",
    title: "fleet-ops",
    archived: false,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    memberCount: 3,
  },
  {
    id: "conv_rev",
    kind: "channel",
    title: "code-review",
    archived: false,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    memberCount: 2,
  },
];

function makeConversationStore(overrides: Record<string, unknown> = {}) {
  return {
    listChannels: vi.fn().mockReturnValue(CHANNELS),
    getConversationsForMember: vi.fn().mockReturnValue([]),
    getMembers: vi.fn().mockReturnValue([
      { conversationId: "conv_ops", memberId: "fenix", memberKind: "agent", role: "member" },
      { conversationId: "conv_ops", memberId: "kerrigan", memberKind: "agent", role: "member" },
      { conversationId: "conv_ops", memberId: "user", memberKind: "user", role: "owner" },
    ]),
    ...overrides,
  } as unknown as BridgeToolDeps["conversationStore"];
}

describe("list_channels", () => {
  it("lists channels by NAME with member counts and member names so the avatar can pick one", async () => {
    const conversationStore = makeConversationStore();
    const bridge = createBridgeToolBridge(makeDeps({ conversationStore }));

    const res = await bridge.executeTool({ tool: "list_channels", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as {
        channels: { id: string; title: string; memberCount: number; members: string[] }[];
        count: number;
      };
      expect(data.count).toBe(2);
      expect(data.channels.map((c) => c.title)).toEqual(["fleet-ops", "code-review"]);
      expect(data.channels[0]!.memberCount).toBe(3);
      expect(data.channels[0]!.members).toEqual(["fenix", "kerrigan", "user"]);
    }
  });

  it("returns an empty result (count 0) when no channels exist", async () => {
    const conversationStore = makeConversationStore({ listChannels: vi.fn().mockReturnValue([]) });
    const bridge = createBridgeToolBridge(makeDeps({ conversationStore }));

    const res = await bridge.executeTool({ tool: "list_channels", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { channels: unknown[]; count: number };
      expect(data.channels).toEqual([]);
      expect(data.count).toBe(0);
    }
  });

  it("caps the channel list so the batch stays under the LiveKit RPC payload ceiling", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `conv_${i}`,
      kind: "channel",
      title: `channel-${i}`,
      archived: false,
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
      memberCount: 2,
    }));
    const conversationStore = makeConversationStore({ listChannels: vi.fn().mockReturnValue(many) });
    const bridge = createBridgeToolBridge(makeDeps({ conversationStore }));

    const res = await bridge.executeTool({ tool: "list_channels", args: {} });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { channels: unknown[]; count: number };
      expect(data.channels.length).toBe(15);
      expect(data.count).toBe(15);
    }
  });
});

describe("read_messages — channel scoping (adj-6fg1g)", () => {
  const CHANNEL_MESSAGES = [
    // Store returns newest-first. Channel posts have NO recipient (fan-out, not 1:1).
    {
      id: "c2", agentId: "kerrigan", recipient: null, role: "agent",
      body: "Race condition reproduced", conversationId: "conv_ops", createdAt: "2026-08-18T02:00:00Z",
    },
    {
      id: "c1", agentId: "fenix", recipient: null, role: "agent",
      body: "Deploying the map view", conversationId: "conv_ops", createdAt: "2026-08-18T01:00:00Z",
    },
  ];

  function makeMessageStore(getMessages = vi.fn().mockReturnValue(CHANNEL_MESSAGES)) {
    return {
      store: {
        getMessages,
        getUnreadCounts: vi.fn().mockReturnValue([]),
      } as unknown as BridgeToolDeps["messageStore"],
      getMessages,
    };
  }

  it("resolves a channel NAME to its conversation and scopes the read to it", async () => {
    const { store, getMessages } = makeMessageStore();
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: store, conversationStore: makeConversationStore() }),
    );

    const res = await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops" } });

    expect(res.ok).toBe(true);
    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv_ops" }));
    if (res.ok) {
      const data = res.data as {
        channel: { id: string; title: string };
        messages: { from: string; to: string; text: string }[];
        count: number;
      };
      expect(data.channel).toEqual({ id: "conv_ops", title: "fleet-ops" });
      // Oldest → newest for narration; a channel post has no 1:1 recipient, so `to`
      // names the CHANNEL (an empty `to` reads as "said to nobody" to the avatar).
      expect(data.messages).toEqual([
        { from: "fenix", to: "fleet-ops", text: "Deploying the map view" },
        { from: "kerrigan", to: "fleet-ops", text: "Race condition reproduced" },
      ]);
      expect(data.count).toBe(2);
    }
  });

  it("reads a MULTI-AGENT channel the Bridge is NOT a member of (no membership gate on this surface)", async () => {
    const { store, getMessages } = makeMessageStore();
    // Members are fenix/kerrigan/user — the coordinator (adjutant-coordinator) is absent.
    const conversationStore = makeConversationStore();
    const bridge = createBridgeToolBridge(makeDeps({ messageStore: store, conversationStore }));

    const res = await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops" } });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { count: number };
      expect(data.count).toBe(2);
    }
    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv_ops" }));
  });

  it("matches a channel name case-insensitively and tolerates spoken spacing (voice input)", async () => {
    const { store, getMessages } = makeMessageStore();
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: store, conversationStore: makeConversationStore() }),
    );

    for (const spoken of ["Fleet-Ops", "  fleet-ops  ", "fleet ops"]) {
      getMessages.mockClear();
      const res = await bridge.executeTool({ tool: "read_messages", args: { channel: spoken } });
      expect(res.ok).toBe(true);
      expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv_ops" }));
    }
  });

  it("accepts a channel id directly (id is never required, but must not break when given)", async () => {
    const { store, getMessages } = makeMessageStore();
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: store, conversationStore: makeConversationStore() }),
    );

    const res = await bridge.executeTool({ tool: "read_messages", args: { channel: "conv_ops" } });

    expect(res.ok).toBe(true);
    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv_ops" }));
  });

  it("rejects an unknown channel with CHANNEL_NOT_FOUND instead of silently widening fleet-wide", async () => {
    const { store, getMessages } = makeMessageStore();
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: store, conversationStore: makeConversationStore() }),
    );

    const res = await bridge.executeTool({ tool: "read_messages", args: { channel: "does-not-exist" } });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("CHANNEL_NOT_FOUND");
      // The avatar must be able to say WHICH channels exist so the Commander can pick.
      expect(res.error.message).toContain("fleet-ops");
    }
    // A miss must never fall back to an unscoped read — that would make the avatar
    // narrate unrelated fleet traffic as if it were the channel.
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("rejects an AMBIGUOUS channel name rather than guessing", async () => {
    const dupes = [
      { ...CHANNELS[0]!, id: "conv_a", title: "ops" },
      { ...CHANNELS[0]!, id: "conv_b", title: "OPS" },
    ];
    const { store, getMessages } = makeMessageStore();
    const conversationStore = makeConversationStore({ listChannels: vi.fn().mockReturnValue(dupes) });
    const bridge = createBridgeToolBridge(makeDeps({ messageStore: store, conversationStore }));

    const res = await bridge.executeTool({ tool: "read_messages", args: { channel: "ops" } });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("AMBIGUOUS_CHANNEL");
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("lets an explicit conversationId win over channel, and channel win over agentId", async () => {
    const { store, getMessages } = makeMessageStore();
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: store, conversationStore: makeConversationStore() }),
    );

    await bridge.executeTool({
      tool: "read_messages",
      args: { conversationId: "dm_explicit", channel: "fleet-ops", agentId: "fenix" },
    });
    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "dm_explicit" }));

    getMessages.mockClear();
    await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops", agentId: "fenix" } });
    const opts = getMessages.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts["conversationId"]).toBe("conv_ops");
    // agentId must NOT also be applied — it would AND-narrow the channel read to one sender.
    expect(opts["agentId"]).toBeUndefined();
  });

  // Same cap as every other read (raised to 30 alongside the total-character budget) — a
  // channel read must not get its own, laxer ceiling.
  it("caps a channel read at the RPC-safe limit like every other read", async () => {
    const { store, getMessages } = makeMessageStore();
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: store, conversationStore: makeConversationStore() }),
    );

    await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops", limit: 500 } });

    expect(getMessages).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
  });
});

// ============================================================================
// read_messages — every scope must be reachable, and combining them must MEAN
// something rather than be silently dropped (adj-xbszj).
//
// The regression this pins: adj-6fg1g made channel and agentId mutually exclusive with channel
// winning, so the avatar could ask "what did kerrigan say in Saim city", get the entire room
// back with no error, and conclude its own capabilities were narrower than they are. It then
// told the Commander it could "only read messages from a specific channel or from a specific
// agent" — while the no-argument and DM modes worked the whole time.
// ============================================================================

describe("read_messages — scope matrix (adj-xbszj)", () => {
  function storeWith(getMessages: ReturnType<typeof vi.fn>) {
    return {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];
  }

  it("should filter a channel read to one sender when BOTH channel and agentId are given", async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: storeWith(getMessages), conversationStore: makeConversationStore() }),
    );

    const res = await bridge.executeTool({
      tool: "read_messages",
      args: { channel: "fleet-ops", agentId: "kerrigan" },
    });

    expect(res.ok).toBe(true);
    const opts = getMessages.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts["conversationId"]).toBe("conv_ops");
    // Strict sender filter — NOT the DM-shaped agentId widening, which the store ignores
    // entirely once a conversationId is present (that is what made this silently wrong).
    expect(opts["senderId"]).toBe("kerrigan");
    expect(opts["agentId"]).toBeUndefined();
  });

  it("should report which sender a channel read was narrowed to, so the avatar can say so", async () => {
    mockGetAgents.mockResolvedValue({ success: true, data: [{ id: "adjutant/kerrigan", name: "kerrigan" }] });
    const getMessages = vi.fn().mockReturnValue([
      { id: "k1", agentId: "kerrigan", recipient: null, role: "agent", body: "status green", conversationId: "conv_ops" },
    ]);
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: storeWith(getMessages), conversationStore: makeConversationStore() }),
    );

    const res = await bridge.executeTool({
      tool: "read_messages",
      args: { channel: "fleet-ops", agentId: "Kerrigan" },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { channel: { title: string }; sender?: string; count: number };
      expect(data.channel.title).toBe("fleet-ops");
      expect(data.sender).toBe("kerrigan");
    }
  });

  it("should still read a whole channel when agentId is omitted", async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: storeWith(getMessages), conversationStore: makeConversationStore() }),
    );

    await bridge.executeTool({ tool: "read_messages", args: { channel: "fleet-ops" } });

    const opts = getMessages.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts["conversationId"]).toBe("conv_ops");
    expect(opts["senderId"]).toBeUndefined();
  });

  it("should still read an agent's DM thread when no channel is named", async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const bridge = createBridgeToolBridge(makeDeps({ messageStore: storeWith(getMessages) }));

    await bridge.executeTool({ tool: "read_messages", args: { agentId: "kerrigan" } });

    const opts = getMessages.mock.calls[0]![0] as Record<string, unknown>;
    // DM widening, NOT a sender filter — a DM thread includes the Commander's side of it.
    expect(opts["agentId"]).toBe("kerrigan");
    expect(opts["senderId"]).toBeUndefined();
    expect(opts["conversationId"]).toBeUndefined();
  });

  it("should still read fleet-wide when nothing at all is passed", async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const bridge = createBridgeToolBridge(makeDeps({ messageStore: storeWith(getMessages) }));

    await bridge.executeTool({ tool: "read_messages", args: {} });

    const opts = getMessages.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts["conversationId"]).toBeUndefined();
    expect(opts["agentId"]).toBeUndefined();
    expect(opts["senderId"]).toBeUndefined();
  });
});

// ============================================================================
// read_messages({agentId}) must read the DM THREAD, not a smear across scopes (adj-xbszj).
//
// The General reported the Bridge could never read the thread between the Commander and a
// specific agent. Measured on live data, the cause: `agentId` widens to
// `(agent_id = ? OR (role='user' AND recipient = ?))`, which is NOT conversation-scoped — it
// sweeps in that agent's CHANNEL posts alongside the DMs, and the RPC size budget then truncates
// the batch. Asking for "my thread with kerrigan" returned a mixture, with channel posts carrying
// an empty `to`.
//
// The DM id cannot be computed. dmConversationId("kerrigan","user") yields
// dm_4bc608e9..., while the live conversation holding 404 kerrigan<->user messages is
// dm_b969fd57... whose members are exactly {kerrigan, user}. No sha1/md5/sha256 variant of that
// pair reproduces the stored id, so the DM must be resolved by MEMBERSHIP LOOKUP.
// ============================================================================

describe("read_messages — an agent's DM thread (adj-xbszj)", () => {
  const DM = {
    id: "dm_live_thread",
    kind: "dm",
    title: null,
    archived: false,
    createdAt: "2026-02-24T00:00:00Z",
    updatedAt: "2026-08-21T00:00:00Z",
  };

  function dmStore(overrides: Record<string, unknown> = {}) {
    return {
      listChannels: vi.fn().mockReturnValue(CHANNELS),
      getConversationsForMember: vi.fn().mockReturnValue([DM]),
      getMembers: vi.fn().mockReturnValue([
        { conversationId: DM.id, memberId: "kerrigan", memberKind: "agent", role: "member" },
        { conversationId: DM.id, memberId: "user", memberKind: "user", role: "member" },
      ]),
      ...overrides,
    } as unknown as BridgeToolDeps["conversationStore"];
  }

  function storeWith(getMessages: ReturnType<typeof vi.fn>) {
    return {
      getMessages,
      getUnreadCounts: vi.fn().mockReturnValue([]),
    } as unknown as BridgeToolDeps["messageStore"];
  }

  it("should scope to the agent's DM CONVERSATION, not the agent-name widening", async () => {
    const getMessages = vi.fn().mockReturnValue([
      { id: "d1", agentId: "kerrigan", recipient: "user", role: "agent", body: "status", conversationId: DM.id },
    ]);
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: storeWith(getMessages), conversationStore: dmStore() }),
    );

    const res = await bridge.executeTool({ tool: "read_messages", args: { agentId: "kerrigan" } });

    expect(res.ok).toBe(true);
    const opts = getMessages.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts["conversationId"]).toBe(DM.id);
    // The widening is what pulled channel posts into the thread — it must not be used here.
    expect(opts["agentId"]).toBeUndefined();
  });

  it("should pick the most recently active thread when a casing duplicate exists", async () => {
    // Live data really has two: members {kerrigan,user} AND members {Kerrigan,user}.
    const stale = { ...DM, id: "dm_stale_casing", updatedAt: "2026-03-01T00:00:00Z" };
    const getMessages = vi.fn().mockReturnValue([]);
    const conversationStore = dmStore({
      getConversationsForMember: vi.fn().mockReturnValue([stale, DM]),
      getMembers: vi.fn((id: string) =>
        id === "dm_stale_casing"
          ? [
              { conversationId: id, memberId: "Kerrigan", memberKind: "agent", role: "member" },
              { conversationId: id, memberId: "user", memberKind: "user", role: "member" },
            ]
          : [
              { conversationId: id, memberId: "kerrigan", memberKind: "agent", role: "member" },
              { conversationId: id, memberId: "user", memberKind: "user", role: "member" },
            ],
      ),
    });
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: storeWith(getMessages), conversationStore }),
    );

    mockGetAgents.mockResolvedValue({ success: true, data: [{ id: "adjutant/kerrigan", name: "kerrigan" }] });
    await bridge.executeTool({ tool: "read_messages", args: { agentId: "Kerrigan" } });

    const opts = getMessages.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts["conversationId"]).toBe(DM.id);
  });

  it("should fall back to the legacy widening when the agent has no DM conversation", async () => {
    // ~5% of recipient-bearing rows predate conversation_id. Returning nothing for those would be
    // a worse failure than the smear this replaces.
    const getMessages = vi.fn().mockReturnValue([]);
    const conversationStore = dmStore({ getConversationsForMember: vi.fn().mockReturnValue([]) });
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: storeWith(getMessages), conversationStore }),
    );

    await bridge.executeTool({ tool: "read_messages", args: { agentId: "ghost-agent" } });

    const opts = getMessages.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts["agentId"]).toBe("ghost-agent");
    expect(opts["conversationId"]).toBeUndefined();
  });

  it("should fall back to the widening when the DM conversation exists but is empty", async () => {
    const getMessages = vi.fn().mockReturnValueOnce([]).mockReturnValueOnce([
      { id: "old", agentId: "kerrigan", recipient: "user", role: "agent", body: "legacy", conversationId: null },
    ]);
    const bridge = createBridgeToolBridge(
      makeDeps({ messageStore: storeWith(getMessages), conversationStore: dmStore() }),
    );

    const res = await bridge.executeTool({ tool: "read_messages", args: { agentId: "kerrigan" } });

    expect(res.ok).toBe(true);
    expect(getMessages).toHaveBeenCalledTimes(2);
    const second = getMessages.mock.calls[1]![0] as Record<string, unknown>;
    expect(second["agentId"]).toBe("kerrigan");
    if (res.ok) expect((res.data as { count: number }).count).toBe(1);
  });
});
