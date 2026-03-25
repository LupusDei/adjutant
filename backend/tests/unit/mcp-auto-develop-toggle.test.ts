import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: vi.fn(),
  getProjectContextBySession: vi.fn(),
}));

vi.mock("../../src/services/projects-service.js", () => ({
  enableAutoDevelop: vi.fn(),
  disableAutoDevelop: vi.fn(),
  setVisionContext: vi.fn(),
  clearAutoDevelopPause: vi.fn(),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
  })),
}));

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import { getAgentBySession, getProjectContextBySession } from "../../src/services/mcp-server.js";
import {
  enableAutoDevelop,
  disableAutoDevelop,
  setVisionContext,
  clearAutoDevelopPause,
} from "../../src/services/projects-service.js";
import { getEventBus } from "../../src/services/event-bus.js";
import { registerAutoDevelopTools } from "../../src/services/mcp-tools/auto-develop.js";

// ---------------------------------------------------------------------------
// Helper: Fake McpServer that captures tool registrations
// ---------------------------------------------------------------------------
interface ToolRegistration {
  name: string;
  schema: Record<string, unknown>;
  handler: (params: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function createFakeMcpServer() {
  const tools: ToolRegistration[] = [];
  return {
    tool(name: string, schema: Record<string, unknown>, handler: ToolRegistration["handler"]) {
      tools.push({ name, schema, handler });
    },
    getTools() { return tools; },
    getTool(name: string) { return tools.find(t => t.name === name); },
  };
}

/** Parse the JSON text from an MCP tool response */
function parseResult(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const mockProjectContext = {
  projectId: "proj-1",
  projectName: "test-project",
  projectPath: "/tmp/test-project",
  beadsDir: "/tmp/test-project/.beads",
};

const mockProject = {
  id: "proj-1",
  name: "test-project",
  path: "/tmp/test-project",
  mode: "swarm" as const,
  sessions: [],
  createdAt: "2026-03-24T00:00:00.000Z",
  active: true,
  autoDevelop: true,
};

describe("Auto-Develop MCP Tools", () => {
  let server: ReturnType<typeof createFakeMcpServer>;
  let mockEmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createFakeMcpServer();
    mockEmit = vi.fn();
    vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as ReturnType<typeof getEventBus>);

    // Register tools on the fake server
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake McpServer for testing
    registerAutoDevelopTools(server as any);
  });

  // =========================================================================
  // enable_auto_develop
  // =========================================================================
  describe("enable_auto_develop", () => {
    it("should enable auto-develop for the agent's project", async () => {
      vi.mocked(getAgentBySession).mockReturnValue("scout");
      vi.mocked(getProjectContextBySession).mockReturnValue(mockProjectContext);
      vi.mocked(enableAutoDevelop).mockReturnValue({ success: true, data: mockProject });

      const tool = server.getTool("enable_auto_develop")!;
      const result = await tool.handler({}, { sessionId: "sess-1" });
      const data = parseResult(result);

      expect(data.success).toBe(true);
      expect(data.projectId).toBe("proj-1");
      expect(data.autoDevelop).toBe(true);
      expect(enableAutoDevelop).toHaveBeenCalledWith("proj-1");
      expect(mockEmit).toHaveBeenCalledWith("project:auto_develop_enabled", expect.objectContaining({
        projectId: "proj-1",
        projectName: "test-project",
      }));
    });

    it("should set vision context when provided", async () => {
      vi.mocked(getAgentBySession).mockReturnValue("scout");
      vi.mocked(getProjectContextBySession).mockReturnValue(mockProjectContext);
      vi.mocked(enableAutoDevelop).mockReturnValue({ success: true, data: mockProject });
      vi.mocked(setVisionContext).mockReturnValue({ success: true, data: { ...mockProject, visionContext: "Build a chat app" } });

      const tool = server.getTool("enable_auto_develop")!;
      const result = await tool.handler({ visionContext: "Build a chat app" }, { sessionId: "sess-1" });
      const data = parseResult(result);

      expect(data.success).toBe(true);
      expect(data.visionContext).toBe("Build a chat app");
      expect(setVisionContext).toHaveBeenCalledWith("proj-1", "Build a chat app");
    });

    it("should return error when session is unknown", async () => {
      vi.mocked(getAgentBySession).mockReturnValue(undefined);

      const tool = server.getTool("enable_auto_develop")!;
      const result = await tool.handler({}, { sessionId: "unknown" });
      const data = parseResult(result);

      expect(data.error).toContain("Unknown session");
    });

    it("should return error when no project context", async () => {
      vi.mocked(getAgentBySession).mockReturnValue("scout");
      vi.mocked(getProjectContextBySession).mockReturnValue(undefined);

      const tool = server.getTool("enable_auto_develop")!;
      const result = await tool.handler({}, { sessionId: "sess-1" });
      const data = parseResult(result);

      expect(data.error).toContain("No project context");
    });
  });

  // =========================================================================
  // disable_auto_develop
  // =========================================================================
  describe("disable_auto_develop", () => {
    it("should disable auto-develop for the agent's project", async () => {
      vi.mocked(getAgentBySession).mockReturnValue("scout");
      vi.mocked(getProjectContextBySession).mockReturnValue(mockProjectContext);
      vi.mocked(disableAutoDevelop).mockReturnValue({ success: true, data: { ...mockProject, autoDevelop: false } });

      const tool = server.getTool("disable_auto_develop")!;
      const result = await tool.handler({}, { sessionId: "sess-1" });
      const data = parseResult(result);

      expect(data.success).toBe(true);
      expect(data.autoDevelop).toBe(false);
      expect(disableAutoDevelop).toHaveBeenCalledWith("proj-1");
      expect(mockEmit).toHaveBeenCalledWith("project:auto_develop_disabled", {
        projectId: "proj-1",
        projectName: "test-project",
      });
    });

    it("should return error when session is unknown", async () => {
      vi.mocked(getAgentBySession).mockReturnValue(undefined);

      const tool = server.getTool("disable_auto_develop")!;
      const result = await tool.handler({}, { sessionId: "unknown" });
      const data = parseResult(result);

      expect(data.error).toContain("Unknown session");
    });

    it("should return error when service call fails", async () => {
      vi.mocked(getAgentBySession).mockReturnValue("scout");
      vi.mocked(getProjectContextBySession).mockReturnValue(mockProjectContext);
      vi.mocked(disableAutoDevelop).mockReturnValue({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "DB failure" },
      });

      const tool = server.getTool("disable_auto_develop")!;
      const result = await tool.handler({}, { sessionId: "sess-1" });
      const data = parseResult(result);

      expect(data.error).toBe("DB failure");
    });
  });

  // =========================================================================
  // provide_vision_update
  // =========================================================================
  describe("provide_vision_update", () => {
    it("should update vision context and clear pause", async () => {
      vi.mocked(getAgentBySession).mockReturnValue("scout");
      vi.mocked(getProjectContextBySession).mockReturnValue(mockProjectContext);
      vi.mocked(setVisionContext).mockReturnValue({ success: true, data: { ...mockProject, visionContext: "New direction" } });
      vi.mocked(clearAutoDevelopPause).mockReturnValue({ success: true, data: mockProject });

      const tool = server.getTool("provide_vision_update")!;
      const result = await tool.handler({ visionContext: "New direction" }, { sessionId: "sess-1" });
      const data = parseResult(result);

      expect(data.success).toBe(true);
      expect(data.visionContext).toBe("New direction");
      expect(data.pauseCleared).toBe(true);
      expect(setVisionContext).toHaveBeenCalledWith("proj-1", "New direction");
      expect(clearAutoDevelopPause).toHaveBeenCalledWith("proj-1");
      expect(mockEmit).toHaveBeenCalledWith("project:auto_develop_enabled", expect.objectContaining({
        projectId: "proj-1",
        visionContext: "New direction",
      }));
    });

    it("should return error when session is unknown", async () => {
      vi.mocked(getAgentBySession).mockReturnValue(undefined);

      const tool = server.getTool("provide_vision_update")!;
      const result = await tool.handler({ visionContext: "New direction" }, { sessionId: "unknown" });
      const data = parseResult(result);

      expect(data.error).toContain("Unknown session");
    });

    it("should return error when no project context", async () => {
      vi.mocked(getAgentBySession).mockReturnValue("scout");
      vi.mocked(getProjectContextBySession).mockReturnValue(undefined);

      const tool = server.getTool("provide_vision_update")!;
      const result = await tool.handler({ visionContext: "New direction" }, { sessionId: "sess-1" });
      const data = parseResult(result);

      expect(data.error).toContain("No project context");
    });

    it("should return error when setVisionContext fails", async () => {
      vi.mocked(getAgentBySession).mockReturnValue("scout");
      vi.mocked(getProjectContextBySession).mockReturnValue(mockProjectContext);
      vi.mocked(setVisionContext).mockReturnValue({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Vision update failed" },
      });

      const tool = server.getTool("provide_vision_update")!;
      const result = await tool.handler({ visionContext: "New direction" }, { sessionId: "sess-1" });
      const data = parseResult(result);

      expect(data.error).toBe("Vision update failed");
      // Should NOT clear pause or emit event on failure
      expect(clearAutoDevelopPause).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
