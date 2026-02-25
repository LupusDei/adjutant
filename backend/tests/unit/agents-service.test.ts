import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing service
vi.mock("../../src/services/agent-data.js", () => ({
  collectAgentSnapshot: vi.fn(),
}));

vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: vi.fn(() => "/tmp/town"),
}));

vi.mock("../../src/services/workspace/index.js", () => ({
  resolveWorkspaceRoot: vi.fn(() => "/tmp/town"),
  getDeploymentMode: vi.fn(() => "gastown"),
}));

vi.mock("../../src/services/topology/index.js", () => ({
  getTopology: () => ({
    normalizeRole: (role: string) => role as import("../../src/types/index.js").AgentType,
  }),
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

import { collectAgentSnapshot, type AgentRuntimeInfo } from "../../src/services/agent-data.js";
import { getAgents, resetAgentStatusCache } from "../../src/services/agents-service.js";
import { getConnectedAgents } from "../../src/services/mcp-server.js";
import { getAgentStatuses } from "../../src/services/mcp-tools/status.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createAgentInfo(overrides: Partial<AgentRuntimeInfo> = {}): AgentRuntimeInfo {
  return {
    name: "test-agent",
    address: "test-rig/crew/test-agent",
    role: "crew",
    rig: "test-rig",
    running: true,
    unreadMail: 0,
    state: "idle",
    ...overrides,
  };
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
  // getAgents
  // ===========================================================================

  describe("getAgents", () => {
    it("should return agents transformed to CrewMember format", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice", role: "crew" }),
          createAgentInfo({ name: "bob", address: "rig/crew/bob", role: "crew" }),
        ],
        polecats: [],
      });

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].name).toBe("alice");
      expect(result.data?.[0].type).toBe("crew");
      expect(result.data?.[0].id).toBe("rig/crew/alice");
    });

    it("should sort agents alphabetically by name", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "zoe", address: "rig/crew/zoe" }),
          createAgentInfo({ name: "alice", address: "rig/crew/alice" }),
          createAgentInfo({ name: "mike", address: "rig/crew/mike" }),
        ],
        polecats: [],
      });

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.[0].name).toBe("alice");
      expect(result.data?.[1].name).toBe("mike");
      expect(result.data?.[2].name).toBe("zoe");
    });

    it("should map agent types correctly", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "mayor", role: "mayor" }),
          createAgentInfo({ name: "deacon", role: "deacon" }),
          createAgentInfo({ name: "witness", role: "witness" }),
          createAgentInfo({ name: "refinery", role: "refinery" }),
          createAgentInfo({ name: "polecat", role: "polecat" }),
          createAgentInfo({ name: "coordinator", role: "coordinator" }), // alias
        ],
        polecats: [],
      });

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.find((a) => a.name === "mayor")?.type).toBe("mayor");
      expect(result.data?.find((a) => a.name === "deacon")?.type).toBe("deacon");
      expect(result.data?.find((a) => a.name === "witness")?.type).toBe("witness");
      expect(result.data?.find((a) => a.name === "refinery")?.type).toBe("refinery");
      expect(result.data?.find((a) => a.name === "polecat")?.type).toBe("polecat");
      expect(result.data?.find((a) => a.name === "coordinator")?.type).toBe("coordinator");
    });

    it("should map status correctly", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "idle", running: true, state: "idle" }),
          createAgentInfo({ name: "working", running: true, state: "working" }),
          createAgentInfo({ name: "blocked", running: true, state: "blocked" }),
          createAgentInfo({ name: "stuck", running: true, state: "stuck" }),
          createAgentInfo({ name: "awaiting", running: true, state: "awaiting-gate" }),
          createAgentInfo({ name: "offline", running: false }),
        ],
        polecats: [],
      });

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.find((a) => a.name === "idle")?.status).toBe("idle");
      expect(result.data?.find((a) => a.name === "working")?.status).toBe("working");
      expect(result.data?.find((a) => a.name === "blocked")?.status).toBe("blocked");
      expect(result.data?.find((a) => a.name === "stuck")?.status).toBe("stuck");
      expect(result.data?.find((a) => a.name === "awaiting")?.status).toBe("blocked");
      expect(result.data?.find((a) => a.name === "offline")?.status).toBe("offline");
    });

    it("should show working status when agent has hooked work but no explicit state", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          // Agent with hookBead but no state -> should be working
          createAgentInfo({
            name: "with-hook",
            running: true,
            state: undefined,
            hookBead: "adj-abc123",
          }),
          // Agent without hookBead and no state -> should be idle
          createAgentInfo({
            name: "no-hook",
            running: true,
            state: undefined,
          }),
          // Agent with hookBead but explicit idle state -> state takes precedence
          createAgentInfo({
            name: "hook-but-idle",
            running: true,
            state: "idle",
            hookBead: "adj-def456",
          }),
        ],
        polecats: [],
      });

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.find((a) => a.name === "with-hook")?.status).toBe("working");
      expect(result.data?.find((a) => a.name === "no-hook")?.status).toBe("idle");
      expect(result.data?.find((a) => a.name === "hook-but-idle")?.status).toBe("idle");
    });

    it("should include optional fields when present", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({
            name: "agent",
            firstSubject: "Urgent task",
            hookBeadTitle: "Fix bug #123",
            branch: "feature/new-ui",
          }),
        ],
        polecats: [],
      });

      const result = await getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.[0].firstSubject).toBe("Urgent task");
      expect(result.data?.[0].currentTask).toBe("Fix bug #123");
      expect(result.data?.[0].branch).toBe("feature/new-ui");
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(collectAgentSnapshot).mockRejectedValue(new Error("Connection failed"));

      const result = await getAgents();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("AGENTS_ERROR");
      expect(result.error?.message).toBe("Connection failed");
    });
  });

  // ===========================================================================
  // EventBus emissions
  // ===========================================================================

  describe("agent:status_changed events", () => {
    it("should not emit events on first call (no previous state)", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice", state: "idle" }),
        ],
        polecats: [],
      });

      await getAgents();

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("should emit agent:status_changed when status changes between calls", async () => {
      // First call: agent is idle
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice", state: "idle" }),
        ],
        polecats: [],
      });
      await getAgents();

      // Second call: agent is now working
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice", state: "working" }),
        ],
        polecats: [],
      });
      await getAgents();

      expect(mockEmit).toHaveBeenCalledWith("agent:status_changed", {
        agent: "rig/crew/alice",
        status: "working",
      });
    });

    it("should not emit when status is unchanged between calls", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice", state: "idle" }),
        ],
        polecats: [],
      });
      await getAgents();
      await getAgents();

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("should include activity when agent has a current task", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice", state: "idle" }),
        ],
        polecats: [],
      });
      await getAgents();

      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({
            name: "alice",
            address: "rig/crew/alice",
            state: "working",
            hookBeadTitle: "Fix bug #42",
          }),
        ],
        polecats: [],
      });
      await getAgents();

      expect(mockEmit).toHaveBeenCalledWith("agent:status_changed", {
        agent: "rig/crew/alice",
        status: "working",
        activity: "Fix bug #42",
      });
    });

    it("should emit events for multiple agents that changed", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice", state: "idle" }),
          createAgentInfo({ name: "bob", address: "rig/crew/bob", state: "working" }),
        ],
        polecats: [],
      });
      await getAgents();

      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice", state: "working" }),
          createAgentInfo({ name: "bob", address: "rig/crew/bob", running: false }),
        ],
        polecats: [],
      });
      await getAgents();

      expect(mockEmit).toHaveBeenCalledTimes(2);
      expect(mockEmit).toHaveBeenCalledWith("agent:status_changed", {
        agent: "rig/crew/alice",
        status: "working",
      });
      expect(mockEmit).toHaveBeenCalledWith("agent:status_changed", {
        agent: "rig/crew/bob",
        status: "offline",
      });
    });
  });

  // ===========================================================================
  // MCP Status Enrichment
  // ===========================================================================

  describe("MCP status enrichment", () => {
    it("should enrich existing agents with MCP status when connected", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "alice", state: "idle" }),
        ],
        polecats: [],
      });
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
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "alice", state: "idle" }),
        ],
        polecats: [],
      });
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
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "alice", address: "rig/crew/alice" }),
        ],
        polecats: [],
      });
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

    it("should enrich by name when agent id differs from MCP agent id", async () => {
      vi.mocked(collectAgentSnapshot).mockResolvedValue({
        agents: [
          createAgentInfo({ name: "bob", address: "rig/crew/bob", state: "idle" }),
        ],
        polecats: [],
      });
      vi.mocked(getConnectedAgents).mockReturnValue([
        {
          agentId: "bob",
          sessionId: "sess-1",
          server: {} as never,
          transport: {} as never,
          connectedAt: new Date(),
        },
      ]);
      vi.mocked(getAgentStatuses).mockReturnValue(
        new Map([
          ["bob", { agentId: "bob", status: "blocked", task: "Waiting for API", updatedAt: new Date().toISOString() }],
        ]),
      );

      const result = await getAgents();

      expect(result.success).toBe(true);
      const bob = result.data?.find((a) => a.name === "bob");
      expect(bob?.status).toBe("blocked");
      expect(bob?.currentTask).toBe("Waiting for API");
    });
  });
});
