import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing service
vi.mock("../../src/services/tmux.js", () => ({
  listTmuxSessions: vi.fn(() => Promise.resolve(new Set<string>())),
}));

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: vi.fn(() => ({
    listSessions: vi.fn(() => []),
  })),
}));

const mockEmit = vi.fn();
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: mockEmit }),
}));

vi.mock("../../src/services/mcp-server.js", () => ({
  getConnectedAgents: vi.fn(() => []),
}));

vi.mock("../../src/services/mcp-tools/status.js", () => ({
  getAgentStatuses: vi.fn(() => new Map()),
}));

import { listTmuxSessions } from "../../src/services/tmux.js";
import { getSessionBridge } from "../../src/services/session-bridge.js";
import { getAgents, resetAgentStatusCache } from "../../src/services/agents-service.js";
import { getConnectedAgents } from "../../src/services/mcp-server.js";
import { getAgentStatuses } from "../../src/services/mcp-tools/status.js";
import type { AgentType } from "../../src/types/index.js";

// =============================================================================
// Test Helpers
// =============================================================================

function mockManagedSessions(sessions: Array<{
  id: string;
  name: string;
  tmuxSession: string;
  status?: string;
  projectPath?: string;
  workspaceType?: string;
  lastActivity?: string;
}>) {
  vi.mocked(getSessionBridge).mockReturnValue({
    listSessions: () => sessions.map(s => ({
      id: s.id,
      name: s.name,
      tmuxSession: s.tmuxSession,
      tmuxPane: `${s.tmuxSession}:0.0`,
      projectPath: s.projectPath ?? "/tmp/project",
      mode: "swarm" as const,
      status: (s.status ?? "idle") as "idle" | "working" | "waiting_permission" | "offline",
      workspaceType: (s.workspaceType ?? "primary") as "primary" | "worktree" | "copy",
      connectedClients: new Set<string>(),
      outputBuffer: [],
      pipeActive: false,
      createdAt: new Date(),
      lastActivity: new Date(s.lastActivity ?? new Date().toISOString()),
    })),
    getSession: vi.fn(),
    init: vi.fn(),
    createSession: vi.fn(),
    killSession: vi.fn(),
  } as never);
}

// =============================================================================
// Tests
// =============================================================================

describe("agents-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentStatusCache();
  });

  // ===========================================================================
  // getAgents — tmux-based discovery
  // ===========================================================================

  describe("getAgents", () => {
    it("should return managed sessions as CrewMember list", async () => {
      const tmuxSessions = new Set(["adj-swarm-alice", "adj-swarm-bob"]);
      vi.mocked(listTmuxSessions).mockResolvedValue(tmuxSessions);
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
        { id: "s2", name: "bob", tmuxSession: "adj-swarm-bob" },
      ]);

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].name).toBe("alice");
      expect(result.data?.[1].name).toBe("bob");
    });

    it("should sort agents alphabetically by name", async () => {
      const tmuxSessions = new Set(["adj-swarm-zoe", "adj-swarm-alice", "adj-swarm-mike"]);
      vi.mocked(listTmuxSessions).mockResolvedValue(tmuxSessions);
      mockManagedSessions([
        { id: "s1", name: "zoe", tmuxSession: "adj-swarm-zoe" },
        { id: "s2", name: "alice", tmuxSession: "adj-swarm-alice" },
        { id: "s3", name: "mike", tmuxSession: "adj-swarm-mike" },
      ]);

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.[0].name).toBe("alice");
      expect(result.data?.[1].name).toBe("mike");
      expect(result.data?.[2].name).toBe("zoe");
    });

    it("should show offline status when tmux session is not running", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set());
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.[0].status).toBe("offline");
    });

    it("should show working status when session status is working", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice", status: "working" },
      ]);

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.[0].status).toBe("working");
    });

    it("should include unmanaged tmux sessions that look like agent sessions", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice", "claude-helper"]));
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.find(a => a.name === "claude-helper")).toBeDefined();
    });

    it("should handle tmux errors gracefully", async () => {
      vi.mocked(listTmuxSessions).mockRejectedValue(new Error("tmux not running"));
      mockManagedSessions([]);

      const result = await getAgents();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TMUX_AGENTS_ERROR");
    });
  });

  // ===========================================================================
  // EventBus emissions
  // ===========================================================================

  describe("agent:status_changed events", () => {
    it("should not emit events on first call (no previous state)", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);

      await getAgents();

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("should emit agent:status_changed when status changes between calls", async () => {
      // First call: agent is idle (running)
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);
      await getAgents();

      // Second call: agent goes offline
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set());
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);
      await getAgents();

      expect(mockEmit).toHaveBeenCalledWith("agent:status_changed", {
        agent: "alice",
        status: "offline",
      });
    });

    it("should not emit when status is unchanged between calls", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);
      await getAgents();
      await getAgents();

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // MCP Status Enrichment
  // ===========================================================================

  describe("MCP status enrichment", () => {
    it("should enrich existing agents with MCP status when connected", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);
      vi.mocked(getConnectedAgents).mockReturnValue([
        {
          agentId: "alice",
          sessionId: "sess-1",
          server: {} as never,
          transport: {} as never,
          connectedAt: new Date(),
        },
      ]);
      vi.mocked(getAgentStatuses).mockReturnValue(
        new Map([
          ["alice", { agentId: "alice", status: "working", task: "Fixing bug", updatedAt: new Date().toISOString() }],
        ]),
      );

      const result = await getAgents();

      expect(result.success).toBe(true);
      const alice = result.data?.find((a) => a.id === "alice");
      expect(alice?.status).toBe("working");
      expect(alice?.currentTask).toBe("Fixing bug");
    });

    it("should not apply stale MCP status from disconnected agents", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);
      // Agent has status data but NO active MCP connection
      vi.mocked(getConnectedAgents).mockReturnValue([]);
      vi.mocked(getAgentStatuses).mockReturnValue(
        new Map([
          ["alice", { agentId: "alice", status: "working", task: "Old task", updatedAt: new Date().toISOString() }],
        ]),
      );

      const result = await getAgents();

      expect(result.success).toBe(true);
      const alice = result.data?.find((a) => a.id === "alice");
      // Should keep original idle status, not stale "working"
      expect(alice?.status).toBe("idle");
      expect(alice?.currentTask).toBeUndefined();
    });

    it("should not add MCP-only agents that have no tmux session", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set(["adj-swarm-alice"]));
      mockManagedSessions([
        { id: "s1", name: "alice", tmuxSession: "adj-swarm-alice" },
      ]);
      // MCP-only agent with no corresponding tmux session
      vi.mocked(getConnectedAgents).mockReturnValue([
        {
          agentId: "ghost-agent",
          sessionId: "sess-1",
          server: {} as never,
          transport: {} as never,
          connectedAt: new Date(),
        },
      ]);

      const result = await getAgents();

      expect(result.success).toBe(true);
      // Should only have alice, not the ghost agent
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].name).toBe("alice");
    });
  });
});
