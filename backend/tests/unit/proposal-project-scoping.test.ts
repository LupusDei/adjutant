import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger before imports
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock mcp-server: getAgentBySession and getProjectContextBySession
const { mockGetAgentBySession, mockGetProjectContextBySession } = vi.hoisted(() => {
  return {
    mockGetAgentBySession: vi.fn(),
    mockGetProjectContextBySession: vi.fn(),
  };
});

vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: mockGetAgentBySession,
  getProjectContextBySession: mockGetProjectContextBySession,
}));

// Mock MCP SDK
const { mockTool, MockMcpServer } = vi.hoisted(() => {
  const mockTool = vi.fn();
  const MockMcpServer = vi.fn().mockImplementation(function () {
    return {
      tool: mockTool,
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      server: {},
    };
  });
  return { mockTool, MockMcpServer };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: MockMcpServer,
}));

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProposalStore } from "../../src/services/proposal-store.js";
import { registerProposalTools } from "../../src/services/mcp-tools/proposals.js";

// =============================================================================
// Helpers
// =============================================================================

function createMockServer(): McpServer {
  return new MockMcpServer() as unknown as McpServer;
}

function createMockStore(): ProposalStore {
  return {
    insertProposal: vi.fn().mockReturnValue({
      id: "test-uuid",
      author: "test-agent",
      title: "Test Proposal",
      description: "A test proposal",
      type: "engineering",
      project: "f1e8f895-0000-4000-8000-000000000000",
      status: "pending",
      createdAt: "2026-03-11T00:00:00Z",
      updatedAt: "2026-03-11T00:00:00Z",
    }),
    getProposal: vi.fn().mockReturnValue({
      id: "test-uuid",
      author: "test-agent",
      title: "Test Proposal",
      description: "A test proposal",
      type: "engineering",
      project: "f1e8f895-0000-4000-8000-000000000000",
      status: "pending",
      createdAt: "2026-03-11T00:00:00Z",
      updatedAt: "2026-03-11T00:00:00Z",
    }),
    getProposals: vi.fn().mockReturnValue([]),
    updateProposalStatus: vi.fn(),
    insertComment: vi.fn().mockReturnValue({
      id: "comment-uuid",
      proposalId: "test-uuid",
      author: "test-agent",
      body: "A comment",
      createdAt: "2026-03-11T00:00:00Z",
    }),
    getComments: vi.fn().mockReturnValue([]),
    reviseProposal: vi.fn().mockReturnValue({
      id: "test-uuid",
      author: "test-agent",
      title: "Revised Proposal",
      description: "A revised proposal",
      type: "engineering",
      project: "f1e8f895-0000-4000-8000-000000000000",
      status: "pending",
      createdAt: "2026-03-11T00:00:00Z",
      updatedAt: "2026-03-11T00:00:00Z",
    }),
    getRevisions: vi.fn().mockReturnValue([]),
  };
}

/**
 * Register tools and extract the handler for a specific tool by name.
 */
function getToolHandler(
  store: ProposalStore,
  toolName: string,
): (...args: unknown[]) => Promise<unknown> {
  mockTool.mockClear();
  const server = createMockServer();
  registerProposalTools(server, store);

  const call = mockTool.mock.calls.find(
    (c: unknown[]) => c[0] === toolName,
  );
  if (!call) {
    throw new Error(
      `Tool "${toolName}" was not registered. Registered: ${mockTool.mock.calls.map((c: unknown[]) => c[0]).join(", ")}`,
    );
  }
  // server.tool(name, schema, handler) -> handler is the third argument
  return call[2] as (...args: unknown[]) => Promise<unknown>;
}

function parseResult(result: unknown): unknown {
  const r = result as { content: { text: string }[] };
  return JSON.parse(r.content[0].text);
}

const TEST_SESSION_ID = "session-123";
const TEST_PROJECT_CONTEXT = {
  projectId: "f1e8f895-0000-4000-8000-000000000000",
  projectName: "adjutant",
  projectPath: "/path/to/adjutant",
  beadsDir: "/path/to/adjutant/.beads",
};

// =============================================================================
// Tests
// =============================================================================

describe("Proposal project scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // adj-072.1.1: create_proposal auto-scoping
  // ===========================================================================

  describe("create_proposal", () => {
    it("should auto-set project from session context, ignoring client-supplied project", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "create_proposal");
      const result = await handler(
        {
          title: "My Proposal",
          description: "Improve something",
          type: "engineering",
          project: "other-project", // client supplies a different project — should be ignored
        },
        { sessionId: TEST_SESSION_ID },
      );

      // The store should receive the server-resolved project ID, not the client-supplied one
      expect(store.insertProposal).toHaveBeenCalledWith(
        expect.objectContaining({ project: "f1e8f895-0000-4000-8000-000000000000" }),
      );
      // Should NOT have used the client-supplied "other-project"
      expect(store.insertProposal).not.toHaveBeenCalledWith(
        expect.objectContaining({ project: "other-project" }),
      );
    });

    it("should reject when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "create_proposal");
      const result = await handler(
        {
          title: "My Proposal",
          description: "Improve something",
          type: "engineering",
          project: "adjutant",
        },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("project context");
      expect(store.insertProposal).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // adj-072.1.1: list_proposals auto-scoping
  // ===========================================================================

  describe("list_proposals", () => {
    it("should default to agent's project when no project filter specified", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_proposals");
      await handler(
        { status: undefined, type: undefined, project: undefined },
        { sessionId: TEST_SESSION_ID },
      );

      expect(store.getProposals).toHaveBeenCalledWith(
        expect.objectContaining({ project: ["f1e8f895-0000-4000-8000-000000000000", "adjutant"] }),
      );
    });

    it("should allow explicit project filter override", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_proposals");
      await handler(
        { status: undefined, type: undefined, project: "other-project" },
        { sessionId: TEST_SESSION_ID },
      );

      expect(store.getProposals).toHaveBeenCalledWith(
        expect.objectContaining({ project: "other-project" }),
      );
    });
  });

  // ===========================================================================
  // adj-072.1.2: discuss_proposal cross-project validation
  // ===========================================================================

  describe("discuss_proposal", () => {
    it("should reject when proposal belongs to a different project", async () => {
      const store = createMockStore();
      // Proposal belongs to "other-project"
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "test-uuid",
        author: "test-agent",
        title: "Test Proposal",
        description: "A test proposal",
        type: "engineering",
        project: "other-project",
        status: "pending",
        createdAt: "2026-03-11T00:00:00Z",
        updatedAt: "2026-03-11T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "discuss_proposal");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("other-project");
      expect((parsed as { error: string }).error).toContain("f1e8f895-0000-4000-8000-000000000000");
    });

    it("should allow when proposal belongs to agent's project", async () => {
      const store = createMockStore();
      // Proposal belongs to "f1e8f895-0000-4000-8000-000000000000" — same as agent's project ID
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "discuss_proposal");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect(parsed).toHaveProperty("proposal");
    });
  });

  // ===========================================================================
  // adj-072.1.2: comment_on_proposal cross-project validation
  // ===========================================================================

  describe("comment_on_proposal", () => {
    it("should reject when proposal belongs to a different project", async () => {
      const store = createMockStore();
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "test-uuid",
        author: "test-agent",
        title: "Test Proposal",
        description: "A test proposal",
        type: "engineering",
        project: "other-project",
        status: "pending",
        createdAt: "2026-03-11T00:00:00Z",
        updatedAt: "2026-03-11T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "comment_on_proposal");
      const result = await handler(
        { id: "test-uuid", body: "A comment" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("other-project");
      expect(store.insertComment).not.toHaveBeenCalled();
    });

    it("should allow when proposal belongs to agent's project", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "comment_on_proposal");
      const result = await handler(
        { id: "test-uuid", body: "A comment" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect(store.insertComment).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // adj-072.1.2: revise_proposal cross-project validation
  // ===========================================================================

  describe("revise_proposal", () => {
    it("should reject when proposal belongs to a different project", async () => {
      const store = createMockStore();
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "test-uuid",
        author: "test-agent",
        title: "Test Proposal",
        description: "A test proposal",
        type: "engineering",
        project: "other-project",
        status: "pending",
        createdAt: "2026-03-11T00:00:00Z",
        updatedAt: "2026-03-11T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "revise_proposal");
      const result = await handler(
        {
          id: "test-uuid",
          title: "New Title",
          changelog: "Changed title",
        },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("other-project");
      expect(store.reviseProposal).not.toHaveBeenCalled();
    });

    it("should allow when proposal belongs to agent's project", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "revise_proposal");
      const result = await handler(
        {
          id: "test-uuid",
          title: "New Title",
          changelog: "Changed title",
        },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect(store.reviseProposal).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // adj-072.5.1: Edge cases — no project context bypass
  // ===========================================================================

  describe("no project context rejection (adj-072.5.4)", () => {
    it("discuss_proposal should reject when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("legacy-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "discuss_proposal");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("project context");
    });

    it("comment_on_proposal should reject when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("legacy-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "comment_on_proposal");
      const result = await handler(
        { id: "test-uuid", body: "Cross-project comment" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("project context");
      expect(store.insertComment).not.toHaveBeenCalled();
    });

    it("revise_proposal should reject when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("legacy-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "revise_proposal");
      const result = await handler(
        {
          id: "test-uuid",
          title: "Hijacked Title",
          changelog: "Changed from different project context",
        },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("project context");
      expect(store.reviseProposal).not.toHaveBeenCalled();
    });

    it("get_proposal should reject when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("legacy-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "get_proposal");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("project context");
    });

    it("list_proposal_comments should reject when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("legacy-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "list_proposal_comments");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("project context");
      expect(store.getComments).not.toHaveBeenCalled();
    });

    it("list_revisions should reject when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("legacy-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "list_revisions");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("project context");
      expect(store.getRevisions).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // adj-072.5.1: Edge cases — list_proposals without project context
  // ===========================================================================

  describe("list_proposals without project context", () => {
    it("should return all proposals (no project filter) when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("legacy-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "list_proposals");
      await handler(
        { status: undefined, type: undefined, project: undefined },
        { sessionId: TEST_SESSION_ID },
      );

      // With no project context and no explicit filter, resolvedProject is undefined
      expect(store.getProposals).toHaveBeenCalledWith(
        expect.objectContaining({ project: undefined }),
      );
    });

    it("should still allow explicit project filter when agent has no project context", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("legacy-agent");
      mockGetProjectContextBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "list_proposals");
      await handler(
        { status: undefined, type: undefined, project: "specific-project" },
        { sessionId: TEST_SESSION_ID },
      );

      expect(store.getProposals).toHaveBeenCalledWith(
        expect.objectContaining({ project: "specific-project" }),
      );
    });
  });

  // ===========================================================================
  // adj-072.5.1: Edge cases — missing sessionId
  // ===========================================================================

  describe("missing sessionId scenarios", () => {
    it("create_proposal should reject when sessionId is missing", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "create_proposal");
      const result = await handler(
        {
          title: "My Proposal",
          description: "Improve something",
          type: "engineering",
          project: "adjutant",
        },
        { sessionId: undefined },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("session");
      expect(store.insertProposal).not.toHaveBeenCalled();
    });

    it("list_proposals should return all proposals when sessionId is missing (no project filter)", async () => {
      const store = createMockStore();

      const handler = getToolHandler(store, "list_proposals");
      await handler(
        { status: undefined, type: undefined, project: undefined },
        { sessionId: undefined },
      );

      // No session means no project context resolution — returns all
      expect(store.getProposals).toHaveBeenCalledWith(
        expect.objectContaining({ project: undefined }),
      );
    });
  });

  // ===========================================================================
  // adj-072.5.2: Edge cases — empty string project
  // ===========================================================================

  describe("empty string project edge cases", () => {
    it("discuss_proposal should not reject when proposal has empty string project and agent has project context", async () => {
      // Edge case: proposal.project is "" (empty string) — it won't match
      // any agent's projectId, causing rejection for all scoped agents
      const store = createMockStore();
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "empty-project-uuid",
        author: "test-agent",
        title: "Orphaned Proposal",
        description: "Has empty project",
        type: "engineering",
        project: "",
        status: "pending",
        createdAt: "2026-03-11T00:00:00Z",
        updatedAt: "2026-03-11T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "discuss_proposal");
      const result = await handler(
        { id: "empty-project-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      // Empty string !== "f1e8f895-0000-4000-8000-000000000000" (projectId) and !== "adjutant" (projectName), so scoped agents are rejected
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("f1e8f895-0000-4000-8000-000000000000");
    });

    it("list_proposals explicit empty-string project filter should pass empty string to store (adj-072.5.5)", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_proposals");
      await handler(
        { status: undefined, type: undefined, project: "" },
        { sessionId: TEST_SESSION_ID },
      );

      // Empty string is an explicit value — should NOT fall through to session default
      expect(store.getProposals).toHaveBeenCalledWith(
        expect.objectContaining({ project: "" }),
      );
    });
  });

  // ===========================================================================
  // adj-072.5.2: Edge cases — get_proposal has no project scoping
  // ===========================================================================

  describe("get_proposal project scoping (adj-072.5.3)", () => {
    it("should reject when proposal belongs to a different project", async () => {
      const store = createMockStore();
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "other-project-uuid",
        author: "other-agent",
        title: "Secret Proposal",
        description: "Belongs to other project",
        type: "engineering",
        project: "secret-project",
        status: "pending",
        createdAt: "2026-03-11T00:00:00Z",
        updatedAt: "2026-03-11T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "get_proposal");
      const result = await handler(
        { id: "other-project-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("secret-project");
      expect((parsed as { error: string }).error).toContain("f1e8f895-0000-4000-8000-000000000000");
    });

    it("should allow when proposal belongs to agent's project", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "get_proposal");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect((parsed as { project: string }).project).toBe("f1e8f895-0000-4000-8000-000000000000");
    });
  });

  // ===========================================================================
  // adj-072.5.2: Edge cases — list_proposal_comments and list_revisions have
  // no project scoping
  // ===========================================================================

  describe("list_proposal_comments project scoping (adj-072.5.3)", () => {
    it("should reject when proposal belongs to a different project", async () => {
      const store = createMockStore();
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "other-project-uuid",
        author: "other-agent",
        title: "Other Project Proposal",
        description: "Belongs to other project",
        type: "engineering",
        project: "secret-project",
        status: "pending",
        createdAt: "2026-03-11T00:00:00Z",
        updatedAt: "2026-03-11T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_proposal_comments");
      const result = await handler(
        { id: "other-project-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("secret-project");
      expect(store.getComments).not.toHaveBeenCalled();
    });

    it("should allow when proposal belongs to agent's project", async () => {
      const store = createMockStore();
      (store.getComments as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "c1", proposalId: "test-uuid", author: "agent", body: "comment", createdAt: "2026-03-11T00:00:00Z" },
      ]);
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_proposal_comments");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result) as { comments: unknown[]; count: number };
      expect(parsed).not.toHaveProperty("error");
      expect(parsed.count).toBe(1);
    });
  });

  describe("list_revisions project scoping (adj-072.5.3)", () => {
    it("should reject when proposal belongs to a different project", async () => {
      const store = createMockStore();
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "other-project-uuid",
        author: "other-agent",
        title: "Other Project Proposal",
        description: "Belongs to other project",
        type: "engineering",
        project: "secret-project",
        status: "pending",
        createdAt: "2026-03-11T00:00:00Z",
        updatedAt: "2026-03-11T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_revisions");
      const result = await handler(
        { id: "other-project-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain("secret-project");
      expect(store.getRevisions).not.toHaveBeenCalled();
    });

    it("should allow when proposal belongs to agent's project", async () => {
      const store = createMockStore();
      (store.getRevisions as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "r1", proposalId: "test-uuid", author: "agent", title: "Rev", changelog: "change", createdAt: "2026-03-11T00:00:00Z" },
      ]);
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_revisions");
      const result = await handler(
        { id: "test-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result) as { revisions: unknown[]; count: number };
      expect(parsed).not.toHaveProperty("error");
      expect(parsed.count).toBe(1);
    });
  });

  // ===========================================================================
  // adj-118: list_proposals response shape — slim payload
  // ===========================================================================

  describe("list_proposals response shape (adj-118)", () => {
    it("should not include full description in list response", async () => {
      const store = createMockStore();
      (store.getProposals as ReturnType<typeof vi.fn>).mockReturnValue([{
        id: "uuid-1",
        author: "test-agent",
        title: "Big Proposal",
        description: "A very long description that should not appear in the list response because it wastes tokens",
        type: "engineering",
        project: "f1e8f895-0000-4000-8000-000000000000",
        status: "pending",
        createdAt: "2026-03-19T00:00:00Z",
        updatedAt: "2026-03-19T00:00:00Z",
      }]);
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_proposals");
      const result = await handler(
        { status: undefined, type: undefined, project: undefined },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result) as { proposals: Record<string, unknown>[] };
      expect(parsed.proposals).toHaveLength(1);

      const proposal = parsed.proposals[0]!;
      // Must NOT have full description
      expect(proposal).not.toHaveProperty("description");
      // Must have summary fields
      expect(proposal).toHaveProperty("id", "uuid-1");
      expect(proposal).toHaveProperty("author", "test-agent");
      expect(proposal).toHaveProperty("title", "Big Proposal");
      expect(proposal).toHaveProperty("type", "engineering");
      expect(proposal).toHaveProperty("project", "f1e8f895-0000-4000-8000-000000000000");
      expect(proposal).toHaveProperty("status", "pending");
      expect(proposal).toHaveProperty("createdAt", "2026-03-19T00:00:00Z");
    });

    it("should include descriptionPreview with first 100 chars", async () => {
      const longDesc = "A".repeat(200);
      const store = createMockStore();
      (store.getProposals as ReturnType<typeof vi.fn>).mockReturnValue([{
        id: "uuid-2",
        author: "test-agent",
        title: "Long Proposal",
        description: longDesc,
        type: "product",
        project: "f1e8f895-0000-4000-8000-000000000000",
        status: "pending",
        createdAt: "2026-03-19T00:00:00Z",
        updatedAt: "2026-03-19T00:00:00Z",
      }]);
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_proposals");
      const result = await handler(
        { status: undefined, type: undefined, project: undefined },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result) as { proposals: { descriptionPreview: string }[] };
      expect(parsed.proposals[0]!.descriptionPreview).toBe("A".repeat(100) + "…");
    });

    it("should not truncate short descriptions in preview", async () => {
      const store = createMockStore();
      (store.getProposals as ReturnType<typeof vi.fn>).mockReturnValue([{
        id: "uuid-3",
        author: "test-agent",
        title: "Short Proposal",
        description: "Short desc",
        type: "engineering",
        project: "f1e8f895-0000-4000-8000-000000000000",
        status: "pending",
        createdAt: "2026-03-19T00:00:00Z",
        updatedAt: "2026-03-19T00:00:00Z",
      }]);
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "list_proposals");
      const result = await handler(
        { status: undefined, type: undefined, project: undefined },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result) as { proposals: { descriptionPreview: string }[] };
      expect(parsed.proposals[0]!.descriptionPreview).toBe("Short desc");
    });
  });

  // ===========================================================================
  // adj-072.5.2: Edge cases — concurrent create_proposal calls
  // ===========================================================================

  describe("concurrent create_proposal calls", () => {
    it("should handle concurrent calls from different project contexts independently", async () => {
      const store = createMockStore();
      let callCount = 0;
      (store.insertProposal as ReturnType<typeof vi.fn>).mockImplementation((input: { project: string }) => {
        callCount++;
        return {
          id: `uuid-${callCount}`,
          author: `agent-${callCount}`,
          title: `Proposal ${callCount}`,
          description: "Concurrent proposal",
          type: "engineering",
          project: input.project,
          status: "pending",
          createdAt: "2026-03-11T00:00:00Z",
          updatedAt: "2026-03-11T00:00:00Z",
        };
      });

      const projectA = { projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", projectName: "proj-a", projectPath: "/a", beadsDir: "/a/.beads" };
      const projectB = { projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", projectName: "proj-b", projectPath: "/b", beadsDir: "/b/.beads" };

      // Simulate two agents with different project contexts
      mockGetAgentBySession.mockImplementation((sid: string) => {
        if (sid === "session-a") return "agent-a";
        if (sid === "session-b") return "agent-b";
        return undefined;
      });
      mockGetProjectContextBySession.mockImplementation((sid: string) => {
        if (sid === "session-a") return projectA;
        if (sid === "session-b") return projectB;
        return undefined;
      });

      const handler = getToolHandler(store, "create_proposal");

      // Fire both concurrently
      const [resultA, resultB] = await Promise.all([
        handler(
          { title: "Proposal A", description: "From A", type: "engineering", project: "ignored" },
          { sessionId: "session-a" },
        ),
        handler(
          { title: "Proposal B", description: "From B", type: "product", project: "ignored" },
          { sessionId: "session-b" },
        ),
      ]);

      const parsedA = parseResult(resultA) as { project: string };
      const parsedB = parseResult(resultB) as { project: string };

      expect(parsedA.project).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      expect(parsedB.project).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      expect(store.insertProposal).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // adj-072.5.2: Edge cases — create_proposal response shape
  // ===========================================================================

  describe("create_proposal response validation", () => {
    it("should return project field in success response", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "create_proposal");
      const result = await handler(
        {
          title: "My Proposal",
          description: "Improve something",
          type: "engineering",
          project: "ignored",
        },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result) as Record<string, unknown>;
      // Verify the response includes the project field
      expect(parsed).toHaveProperty("project");
      expect(parsed).toHaveProperty("id");
      expect(parsed).toHaveProperty("title");
      expect(parsed).toHaveProperty("status");
      expect(parsed).toHaveProperty("type");
      expect(parsed).toHaveProperty("createdAt");
    });
  });

  // ===========================================================================
  // adj-090: Legacy proposals stored with project name instead of UUID
  // ===========================================================================

  describe("legacy proposal with project name instead of UUID (adj-090)", () => {
    it("get_proposal should allow access when proposal.project matches projectName", async () => {
      const store = createMockStore();
      // Legacy proposal stored with the human-readable name, not UUID
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "legacy-uuid",
        author: "test-agent",
        title: "Legacy Proposal",
        description: "Created before adj-088",
        type: "engineering",
        project: "adjutant", // name string, NOT UUID
        status: "pending",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      // Agent's context has UUID as projectId and "adjutant" as projectName
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "get_proposal");
      const result = await handler(
        { id: "legacy-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect((parsed as { project: string }).project).toBe("adjutant");
    });

    it("discuss_proposal should allow access when proposal.project matches projectName", async () => {
      const store = createMockStore();
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "legacy-uuid",
        author: "test-agent",
        title: "Legacy Proposal",
        description: "Created before adj-088",
        type: "engineering",
        project: "adjutant",
        status: "pending",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "discuss_proposal");
      const result = await handler(
        { id: "legacy-uuid" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect(parsed).toHaveProperty("proposal");
    });

    it("comment_on_proposal should allow access when proposal.project matches projectName", async () => {
      const store = createMockStore();
      (store.getProposal as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "legacy-uuid",
        author: "test-agent",
        title: "Legacy Proposal",
        description: "Created before adj-088",
        type: "engineering",
        project: "adjutant",
        status: "pending",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
      });
      mockGetAgentBySession.mockReturnValue("test-agent");
      mockGetProjectContextBySession.mockReturnValue(TEST_PROJECT_CONTEXT);

      const handler = getToolHandler(store, "comment_on_proposal");
      const result = await handler(
        { id: "legacy-uuid", body: "A comment on legacy proposal" },
        { sessionId: TEST_SESSION_ID },
      );

      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect(store.insertComment).toHaveBeenCalled();
    });
  });
});
