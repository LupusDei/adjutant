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
      project: "adjutant",
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
      project: "adjutant",
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
      project: "adjutant",
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
  const r = result as { content: Array<{ text: string }> };
  return JSON.parse(r.content[0].text);
}

const TEST_SESSION_ID = "session-123";
const TEST_PROJECT_CONTEXT = {
  projectId: "adjutant",
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

      // The store should receive the server-resolved project, not the client-supplied one
      expect(store.insertProposal).toHaveBeenCalledWith(
        expect.objectContaining({ project: "adjutant" }),
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
        expect.objectContaining({ project: "adjutant" }),
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
      expect((parsed as { error: string }).error).toContain("adjutant");
    });

    it("should allow when proposal belongs to agent's project", async () => {
      const store = createMockStore();
      // Proposal belongs to "adjutant" — same as agent's project
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
});
