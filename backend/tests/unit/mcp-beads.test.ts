import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger before imports
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock bd-client
const { mockExecBd } = vi.hoisted(() => {
  const mockExecBd = vi.fn();
  return { mockExecBd };
});

vi.mock("../../src/services/bd-client.js", () => ({
  execBd: mockExecBd,
  resolveBeadsDir: vi.fn((dir: string) => `${dir}/.beads`),
  stripBeadPrefix: vi.fn((fullId: string) => {
    const match = fullId.match(/^[a-z0-9]{2,5}-(.+)$/i);
    return match?.[1] ?? fullId;
  }),
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
import { registerBeadTools } from "../../src/services/mcp-tools/beads.js";

// =============================================================================
// Helpers
// =============================================================================

function createMockServer(): McpServer {
  return new MockMcpServer() as unknown as McpServer;
}

/**
 * Register tools and extract the handler for a specific tool by name.
 */
function getToolHandler(toolName: string): (...args: unknown[]) => Promise<unknown> {
  const server = createMockServer();
  registerBeadTools(server);

  const call = mockTool.mock.calls.find(
    (c: unknown[]) => c[0] === toolName,
  );
  if (!call) {
    throw new Error(`Tool "${toolName}" was not registered. Registered: ${mockTool.mock.calls.map((c: unknown[]) => c[0]).join(", ")}`);
  }
  // server.tool(name, schema, handler) -> handler is the third argument
  return call[2] as (...args: unknown[]) => Promise<unknown>;
}

// =============================================================================
// Tests
// =============================================================================

describe("MCP Bead Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registerBeadTools", () => {
    it("should register all five bead tools", () => {
      const server = createMockServer();
      registerBeadTools(server);

      const toolNames = mockTool.mock.calls.map((c: unknown[]) => c[0]);
      expect(toolNames).toContain("create_bead");
      expect(toolNames).toContain("update_bead");
      expect(toolNames).toContain("close_bead");
      expect(toolNames).toContain("list_beads");
      expect(toolNames).toContain("show_bead");
      expect(toolNames).toHaveLength(5);
    });
  });

  // ===========================================================================
  // create_bead
  // ===========================================================================

  describe("create_bead", () => {
    it("should call execBd with correct args for a basic create", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: { id: "adj-abc1", title: "New feature" },
        exitCode: 0,
      });

      const handler = getToolHandler("create_bead");
      const result = await handler({
        title: "New feature",
        description: "Build the thing",
        type: "task",
        priority: 2,
      });

      expect(mockExecBd).toHaveBeenCalledTimes(1);
      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("create");
      expect(args).toContain("--title");
      expect(args).toContain("New feature");
      expect(args).toContain("--type");
      expect(args).toContain("task");
      expect(args).toContain("--priority");
      expect(args).toContain("2");
      expect(args).toContain("--description");
      expect(args).toContain("Build the thing");

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("adj-abc1") }],
      });
    });

    it("should include custom id when provided", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: { id: "adj-custom1", title: "Custom" },
        exitCode: 0,
      });

      const handler = getToolHandler("create_bead");
      await handler({
        id: "custom1",
        title: "Custom",
        description: "Desc",
        type: "epic",
        priority: 0,
      });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("--id");
      expect(args).toContain("custom1");
    });

    it("should return error content when execBd fails", async () => {
      mockExecBd.mockResolvedValue({
        success: false,
        error: { code: "COMMAND_FAILED", message: "bd create failed" },
        exitCode: 1,
      });

      const handler = getToolHandler("create_bead");
      const result = await handler({
        title: "Fail",
        description: "Will fail",
        type: "bug",
        priority: 1,
      });

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Error") }],
        isError: true,
      });
    });
  });

  // ===========================================================================
  // update_bead
  // ===========================================================================

  describe("update_bead", () => {
    it("should call execBd with status flag", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: "Updated",
        exitCode: 0,
      });

      const handler = getToolHandler("update_bead");
      await handler({ id: "adj-001", status: "in_progress" });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args[0]).toBe("update");
      expect(args).toContain("adj-001");
      expect(args).toContain("--status=in_progress");
    });

    it("should call execBd with title flag", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: "Updated",
        exitCode: 0,
      });

      const handler = getToolHandler("update_bead");
      await handler({ id: "adj-002", title: "New title" });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("--title");
      expect(args).toContain("New title");
    });

    it("should call execBd with priority flag", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: "Updated",
        exitCode: 0,
      });

      const handler = getToolHandler("update_bead");
      await handler({ id: "adj-003", priority: 1 });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("--priority");
      expect(args).toContain("1");
    });

    it("should call execBd with assignee flag", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: "Updated",
        exitCode: 0,
      });

      const handler = getToolHandler("update_bead");
      await handler({ id: "adj-004", assignee: "researcher" });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("--assignee");
      expect(args).toContain("researcher");
    });

    it("should combine multiple update flags", async () => {
      // First call: show (epic check) — return non-epic task
      // Second call: update — succeed
      // Third call: epic close-eligible — return empty
      mockExecBd
        .mockResolvedValueOnce({
          success: true,
          data: [{ id: "adj-005", issue_type: "task" }],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: "Updated",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [],
          exitCode: 0,
        });

      const handler = getToolHandler("update_bead");
      await handler({
        id: "adj-005",
        status: "closed",
        title: "Done",
        priority: 0,
      });

      // First call is the epic check (show), second is the update
      const updateArgs = mockExecBd.mock.calls[1]![0] as string[];
      expect(updateArgs).toContain("--status=closed");
      expect(updateArgs).toContain("--title");
      expect(updateArgs).toContain("Done");
      expect(updateArgs).toContain("--priority");
      expect(updateArgs).toContain("0");
    });

    it("should return error content when update fails", async () => {
      mockExecBd.mockResolvedValue({
        success: false,
        error: { code: "COMMAND_FAILED", message: "not found" },
        exitCode: 1,
      });

      const handler = getToolHandler("update_bead");
      const result = await handler({ id: "adj-nope", status: "closed" });

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Error") }],
        isError: true,
      });
    });
  });

  // ===========================================================================
  // close_bead
  // ===========================================================================

  describe("close_bead", () => {
    /** Mock for closing a non-epic task: show (task) → close → close-eligible */
    function mockCloseTask() {
      mockExecBd
        .mockResolvedValueOnce({
          success: true,
          data: [{ id: "adj-010", issue_type: "task" }],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: "Closed",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [],
          exitCode: 0,
        });
    }

    it("should call execBd with close command", async () => {
      mockCloseTask();

      const handler = getToolHandler("close_bead");
      await handler({ id: "adj-010" });

      // First call is show (epic check), second is close
      const closeArgs = mockExecBd.mock.calls[1]![0] as string[];
      expect(closeArgs[0]).toBe("close");
      expect(closeArgs).toContain("adj-010");
    });

    it("should return success content", async () => {
      mockCloseTask();

      const handler = getToolHandler("close_bead");
      const result = await handler({ id: "adj-010" });

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("adj-010") }],
      });
    });

    it("should pass --reason flag when reason is provided", async () => {
      mockExecBd
        .mockResolvedValueOnce({
          success: true,
          data: [{ id: "adj-010", issue_type: "task" }],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: "Closed",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [],
          exitCode: 0,
        });

      const handler = getToolHandler("close_bead");
      await handler({ id: "adj-010", reason: "All tasks completed" });

      const closeArgs = mockExecBd.mock.calls[1]![0] as string[];
      expect(closeArgs[0]).toBe("close");
      expect(closeArgs).toContain("adj-010");
      expect(closeArgs).toContain("--reason");
      expect(closeArgs).toContain("All tasks completed");
    });

    it("should not include --reason when reason is not provided", async () => {
      mockCloseTask();

      const handler = getToolHandler("close_bead");
      await handler({ id: "adj-010" });

      const closeArgs = mockExecBd.mock.calls[1]![0] as string[];
      expect(closeArgs).not.toContain("--reason");
    });

    it("should return error when close fails", async () => {
      // show returns task (not epic), then close fails
      mockExecBd
        .mockResolvedValueOnce({
          success: true,
          data: [{ id: "adj-010", issue_type: "task" }],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: false,
          error: { code: "COMMAND_FAILED", message: "already closed" },
          exitCode: 1,
        });

      const handler = getToolHandler("close_bead");
      const result = await handler({ id: "adj-010" });

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Error") }],
        isError: true,
      });
    });

    it("should block closing an epic directly", async () => {
      // show returns epic
      mockExecBd.mockResolvedValueOnce({
        success: true,
        data: [{ id: "adj-010", issue_type: "epic" }],
        exitCode: 0,
      });

      const handler = getToolHandler("close_bead");
      const result = await handler({ id: "adj-010" });

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Epics cannot be closed directly") }],
        isError: true,
      });
      // Should NOT have called close — only the show call
      expect(mockExecBd).toHaveBeenCalledTimes(1);
    });

    it("should auto-complete parent epics after closing a task", async () => {
      mockExecBd
        .mockResolvedValueOnce({
          success: true,
          data: [{ id: "adj-010", issue_type: "task" }],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: "Closed",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [{ id: "adj-001", title: "Parent Epic" }],
          exitCode: 0,
        });

      const handler = getToolHandler("close_bead");
      const result = await handler({ id: "adj-010" });

      expect(result.content[0].text).toContain("adj-010");
      expect(result.content[0].text).toContain("Auto-completed epics: adj-001");
    });
  });

  // ===========================================================================
  // list_beads
  // ===========================================================================

  describe("list_beads", () => {
    it("should call execBd with list command and default status open", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      const handler = getToolHandler("list_beads");
      await handler({});

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args[0]).toBe("list");
      expect(args).toContain("--json");
    });

    it("should filter by status when provided", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      const handler = getToolHandler("list_beads");
      await handler({ status: "in_progress" });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("--status");
      expect(args).toContain("in_progress");
    });

    it("should filter by type when provided", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      const handler = getToolHandler("list_beads");
      await handler({ type: "epic" });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("--type");
      expect(args).toContain("epic");
    });

    it("should filter by assignee when provided", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      const handler = getToolHandler("list_beads");
      await handler({ assignee: "builder" });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("--assignee");
      expect(args).toContain("builder");
    });

    it("should use --all flag for status=all", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      const handler = getToolHandler("list_beads");
      await handler({ status: "all" });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args).toContain("--all");
      expect(args).not.toContain("--status");
    });

    it("should return formatted bead list", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: [
          { id: "adj-001", title: "First", status: "open", priority: 2, issue_type: "task" },
          { id: "adj-002", title: "Second", status: "in_progress", priority: 1, issue_type: "bug" },
        ],
        exitCode: 0,
      });

      const handler = getToolHandler("list_beads");
      const result = await handler({}) as { content: { text: string }[] };

      expect(result.content[0]!.text).toContain("adj-001");
      expect(result.content[0]!.text).toContain("adj-002");
    });

    it("should return error when list fails", async () => {
      mockExecBd.mockResolvedValue({
        success: false,
        error: { code: "COMMAND_FAILED", message: "database locked" },
        exitCode: 1,
      });

      const handler = getToolHandler("list_beads");
      const result = await handler({});

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Error") }],
        isError: true,
      });
    });
  });

  // ===========================================================================
  // show_bead
  // ===========================================================================

  describe("show_bead", () => {
    it("should call execBd with show command", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: { id: "adj-010", title: "Show me", status: "open" },
        exitCode: 0,
      });

      const handler = getToolHandler("show_bead");
      await handler({ id: "adj-010" });

      const args = mockExecBd.mock.calls[0]![0] as string[];
      expect(args[0]).toBe("show");
      expect(args).toContain("adj-010");
      expect(args).toContain("--json");
    });

    it("should return formatted bead details", async () => {
      mockExecBd.mockResolvedValue({
        success: true,
        data: {
          id: "adj-010",
          title: "Important task",
          status: "in_progress",
          priority: 1,
          issue_type: "task",
          description: "Do the thing",
          assignee: "builder",
          dependencies: [
            { issue_id: "adj-010", depends_on_id: "adj-009", type: "depends" },
          ],
        },
        exitCode: 0,
      });

      const handler = getToolHandler("show_bead");
      const result = await handler({ id: "adj-010" }) as { content: { text: string }[] };

      expect(result.content[0]!.text).toContain("adj-010");
      expect(result.content[0]!.text).toContain("Important task");
      expect(result.content[0]!.text).toContain("in_progress");
    });

    it("should return error when show fails", async () => {
      mockExecBd.mockResolvedValue({
        success: false,
        error: { code: "COMMAND_FAILED", message: "not found" },
        exitCode: 1,
      });

      const handler = getToolHandler("show_bead");
      const result = await handler({ id: "adj-nope" });

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Error") }],
        isError: true,
      });
    });
  });

  // ===========================================================================
  // Serialization
  // ===========================================================================

  describe("serialization", () => {
    it("should serialize concurrent bd calls (not run in parallel)", async () => {
      let concurrentCalls = 0;
      let maxConcurrentCalls = 0;

      mockExecBd.mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentCalls--;
        return { success: true, data: [], exitCode: 0 };
      });

      const handler = getToolHandler("list_beads");

      // Fire three calls concurrently
      await Promise.all([
        handler({}),
        handler({ status: "all" }),
        handler({ type: "bug" }),
      ]);

      // With serialization, max concurrent should be 1
      expect(maxConcurrentCalls).toBe(1);
      expect(mockExecBd).toHaveBeenCalledTimes(3);
    });

    it("should serialize across different tool types", async () => {
      let concurrentCalls = 0;
      let maxConcurrentCalls = 0;
      let callIndex = 0;

      mockExecBd.mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentCalls--;
        callIndex++;
        // list_beads expects an array, others expect an object
        if (callIndex === 1) {
          return { success: true, data: [], exitCode: 0 };
        }
        return {
          success: true,
          data: { id: "adj-001", title: "Test" },
          exitCode: 0,
        };
      });

      const listHandler = getToolHandler("list_beads");
      const showHandler = getToolHandler("show_bead");
      const createHandler = getToolHandler("create_bead");

      await Promise.all([
        listHandler({}),
        showHandler({ id: "adj-001" }),
        createHandler({ title: "New", description: "Desc", type: "task", priority: 2 }),
      ]);

      expect(maxConcurrentCalls).toBe(1);
      expect(mockExecBd).toHaveBeenCalledTimes(3);
    });
  });
});
