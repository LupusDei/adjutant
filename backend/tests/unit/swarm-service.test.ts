import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock session bridge
const mockBridge = {
  createSession: vi.fn(),
  killSession: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
};

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => mockBridge,
}));

// Mock child_process.execFile
vi.mock("child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, "", "");
  }),
}));

import {
  createSwarm,
  addAgentToSwarm,
  removeAgentFromSwarm,
  getSwarmStatus,
  listSwarms,
  destroySwarm,
  resetSwarmService,
  getSwarmBranches,
  mergeAgentBranch,
} from "../../src/services/swarm-service.js";

import { execFile } from "child_process";

describe("swarm-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSwarmService();
  });

  // ==========================================================================
  // createSwarm
  // ==========================================================================

  describe("createSwarm", () => {
    it("should reject agent count below 1", async () => {
      const result = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("between 1 and 20");
    });

    it("should reject agent count above 20", async () => {
      const result = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 21,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("between 1 and 20");
    });

    it("should create a single-agent swarm with callsign name", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      const result = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      expect(result.success).toBe(true);
      expect(result.swarm).toBeDefined();
      expect(result.swarm!.agents).toHaveLength(1);
      // Without baseName, agent gets a random callsign (not "agent-1")
      expect(result.swarm!.agents[0].name).toBeTruthy();
      expect(result.swarm!.agents[0].name).not.toMatch(/^agent-\d+$/);
      expect(result.swarm!.agents[0].branch).toBe("main");
      expect(result.swarm!.agents[0].isCoordinator).toBe(false);
    });

    it("should create multi-agent swarm with custom base name", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-x",
      });

      const result = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 3,
        baseName: "worker",
      });

      expect(result.success).toBe(true);
      expect(result.swarm!.agents).toHaveLength(3);
      expect(result.swarm!.agents[0].name).toBe("worker-1");
      expect(result.swarm!.agents[1].name).toBe("worker-2");
      expect(result.swarm!.agents[2].name).toBe("worker-3");
    });

    it("should designate coordinator", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-c",
      });

      const result = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 2,
        baseName: "worker",
        coordinatorIndex: 0,
      });

      expect(result.success).toBe(true);
      expect(result.swarm!.agents[0].isCoordinator).toBe(true);
      expect(result.swarm!.agents[1].isCoordinator).toBe(false);
      expect(result.swarm!.coordinator).toBe("sess-c");
    });

    // ========================================================================
    // Worktree isolation (adj-iqyqw): each worktree agent's session must be
    // rooted at ITS worktree, never the main repo. If the session cwd is the
    // main repo, the agent's file edits leak out of the worktree and can clobber
    // the shared tree (the silent data-loss incidents in adj-iqyqw).
    // ========================================================================
    it("should root each worktree agent's session at its own worktree, not the main repo (adj-iqyqw)", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-w",
      });

      const root = "/tmp/project";
      const result = await createSwarm({
        projectPath: root,
        agentCount: 3,
        baseName: "worker",
        coordinatorIndex: 0,
        workspaceType: "worktree",
      });
      expect(result.success).toBe(true);

      const calls = mockBridge.createSession.mock.calls.map((c) => c[0]);
      const byName = (n: string) => calls.find((a) => a.name === n)!;

      // Coordinator (index 0) stays in the main repo as the primary workspace.
      expect(byName("worker-1").projectPath).toBe(root);
      expect(byName("worker-1").workspaceType).toBe("primary");

      // Worktree agents (index > 0) are rooted at their OWN worktree dir.
      expect(byName("worker-2").projectPath).toBe(`${root}/worktrees/worker-2`);
      expect(byName("worker-2").workspaceType).toBe("worktree");
      expect(byName("worker-3").projectPath).toBe(`${root}/worktrees/worker-3`);
      expect(byName("worker-3").workspaceType).toBe("worktree");

      // None of the worktree agents may be pointed at the bare main repo root.
      expect(byName("worker-2").projectPath).not.toBe(root);
      expect(byName("worker-3").projectPath).not.toBe(root);

      // And a git worktree was actually created for each worktree agent.
      const wtAdds = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => {
          const a = c[1] as string[];
          return a[0] === "worktree" && a[1] === "add";
        }
      );
      const wtPaths = wtAdds.map((c: unknown[]) => (c[1] as string[]).at(-1));
      expect(wtPaths).toContain("worktrees/worker-2");
      expect(wtPaths).toContain("worktrees/worker-3");
      expect(wtPaths).not.toContain("worktrees/worker-1");
    });

    it("should provision node_modules (symlink) into each worktree after creation (adj-pd49t)", async () => {
      mockBridge.createSession.mockResolvedValue({ success: true, sessionId: "sess-p" });

      const root = "/tmp/project";
      await createSwarm({
        projectPath: root,
        agentCount: 3,
        baseName: "worker",
        coordinatorIndex: 0,
        workspaceType: "worktree",
      });

      const execMock = execFile as unknown as ReturnType<typeof vi.fn>;
      const provisioned = execMock.mock.calls
        .filter((c: unknown[]) => {
          const a = c[1] as string[];
          return c[0] === "bash" && a[0] === "scripts/provision-worktree.sh";
        })
        .map((c: unknown[]) => (c[1] as string[])[1]);

      // Worktree agents (index > 0) get provisioned; the primary coordinator does not.
      expect(provisioned).toContain(`${root}/worktrees/worker-2`);
      expect(provisioned).toContain(`${root}/worktrees/worker-3`);
      expect(provisioned).not.toContain(`${root}/worktrees/worker-1`);
    });

    it("should not fail the spawn when worktree provisioning errors (best-effort)", async () => {
      mockBridge.createSession.mockResolvedValue({ success: true, sessionId: "sess-q" });
      // Make ONLY the provision script fail; git worktree add still succeeds.
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, args: string[], _opts: unknown, cb: Function) => {
          if (cmd === "bash" && args[0] === "scripts/provision-worktree.sh") {
            cb(new Error("provision failed"), "", "boom");
          } else {
            cb(null, "", "");
          }
        },
      );

      const result = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 2,
        baseName: "worker",
        workspaceType: "worktree",
      });

      // Provisioning is best-effort — the swarm still succeeds.
      expect(result.success).toBe(true);
      expect(result.swarm!.agents).toHaveLength(2);
    });

    it("should handle partial failures gracefully", async () => {
      let callCount = 0;
      mockBridge.createSession.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          return { success: false, error: "Session limit reached" };
        }
        return { success: true, sessionId: `sess-${callCount}` };
      });

      const result = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 3,
      });

      expect(result.success).toBe(true);
      expect(result.swarm!.agents).toHaveLength(2);
    });

    it("should fail when no agents created", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: false,
        error: "Cannot create session",
      });

      const result = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 2,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("No agents created");
    });

    it("should assign swarm IDs sequentially", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      const result1 = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });
      const result2 = await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      expect(result1.swarm!.id).toBe("swarm-1");
      expect(result2.swarm!.id).toBe("swarm-2");
    });
  });

  // ==========================================================================
  // addAgentToSwarm
  // ==========================================================================

  describe("addAgentToSwarm", () => {
    it("should return error for unknown swarm", async () => {
      const result = await addAgentToSwarm("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Swarm not found");
    });

    it("should add agent to existing swarm", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-new",
      });

      // Create a swarm first
      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      const result = await addAgentToSwarm("swarm-1", "extra-worker");
      expect(result.success).toBe(true);
      expect(result.agent!.name).toBe("extra-worker");
      expect(result.agent!.sessionId).toBe("sess-new");
    });

    it("should auto-name agent when name not provided", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-auto",
      });

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      const result = await addAgentToSwarm("swarm-1");
      expect(result.success).toBe(true);
      expect(result.agent!.name).toBe("agent-2");
    });
  });

  // ==========================================================================
  // removeAgentFromSwarm
  // ==========================================================================

  describe("removeAgentFromSwarm", () => {
    it("should return false for unknown swarm", async () => {
      const result = await removeAgentFromSwarm("nonexistent", "sess-1");
      expect(result).toBe(false);
    });

    it("should return false for unknown session", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      const result = await removeAgentFromSwarm("swarm-1", "unknown-session");
      expect(result).toBe(false);
    });

    it("should remove agent and kill session", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });
      mockBridge.killSession.mockResolvedValue(true);

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      const result = await removeAgentFromSwarm("swarm-1", "sess-1");
      expect(result).toBe(true);
      expect(mockBridge.killSession).toHaveBeenCalledWith("sess-1");

      const swarm = getSwarmStatus("swarm-1");
      expect(swarm!.agents).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getSwarmStatus
  // ==========================================================================

  describe("getSwarmStatus", () => {
    it("should return undefined for unknown swarm", () => {
      const status = getSwarmStatus("nonexistent");
      expect(status).toBeUndefined();
    });

    it("should return swarm with updated agent statuses", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });
      mockBridge.getSession.mockReturnValue({ status: "working" });

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      const status = getSwarmStatus("swarm-1");
      expect(status).toBeDefined();
      expect(status!.agents[0].status).toBe("working");
    });

    it("should mark agent offline when session not found", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });
      mockBridge.getSession.mockReturnValue(undefined);

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      const status = getSwarmStatus("swarm-1");
      expect(status!.agents[0].status).toBe("offline");
    });
  });

  // ==========================================================================
  // listSwarms
  // ==========================================================================

  describe("listSwarms", () => {
    it("should return empty array when no swarms", () => {
      expect(listSwarms()).toEqual([]);
    });

    it("should return all swarms", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      await createSwarm({ projectPath: "/tmp/a", agentCount: 1 });
      await createSwarm({ projectPath: "/tmp/b", agentCount: 1 });

      const swarms = listSwarms();
      expect(swarms).toHaveLength(2);
    });
  });

  // ==========================================================================
  // destroySwarm
  // ==========================================================================

  describe("destroySwarm", () => {
    it("should return false for unknown swarm", async () => {
      const result = await destroySwarm("nonexistent");
      expect(result).toBe(false);
    });

    it("should kill all agents and remove swarm", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });
      mockBridge.killSession.mockResolvedValue(true);

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 2,
      });

      const result = await destroySwarm("swarm-1");
      expect(result).toBe(true);
      expect(mockBridge.killSession).toHaveBeenCalledTimes(2);
      expect(listSwarms()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // resetSwarmService
  // ==========================================================================

  // ==========================================================================
  // getSwarmBranches
  // ==========================================================================

  describe("getSwarmBranches", () => {
    it("should return undefined for unknown swarm", async () => {
      const result = await getSwarmBranches("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should return branch status for agents", async () => {
      // Setup execFile to return rev-list counts
      const execFileMock = vi.mocked(execFile);
      execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
        if (args?.[0] === "rev-list") {
          cb(null, "0\t3\n", "");
        } else if (args?.[0] === "merge-tree") {
          cb(null, "", "");
        } else {
          cb(null, "", "");
        }
        return {} as any;
      });

      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 2,
        baseName: "agent",
      });

      const branches = await getSwarmBranches("swarm-1");
      expect(branches).toBeDefined();
      // Only non-main branches (agent-2)
      expect(branches!.length).toBe(1);
      expect(branches![0].agentName).toBe("agent-2");
      expect(branches![0].aheadOfMain).toBe(3);
      expect(branches![0].behindMain).toBe(0);
    });

    it("should skip main branch agent", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
        baseName: "agent",
      });

      const branches = await getSwarmBranches("swarm-1");
      expect(branches).toBeDefined();
      expect(branches!.length).toBe(0);
    });
  });

  // ==========================================================================
  // mergeAgentBranch
  // ==========================================================================

  describe("mergeAgentBranch", () => {
    it("should return error for unknown swarm", async () => {
      const result = await mergeAgentBranch("nonexistent", "some-branch");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Swarm not found");
    });

    it("should return error for unknown branch", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 1,
      });

      const result = await mergeAgentBranch("swarm-1", "nonexistent-branch");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Branch not found in swarm");
    });

    it("should merge successfully", async () => {
      const execFileMock = vi.mocked(execFile);
      execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "", "");
        return {} as any;
      });

      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      await createSwarm({
        projectPath: "/tmp/project",
        agentCount: 2,
        baseName: "agent",
      });

      const branch = `swarm/swarm-1/agent-2`;
      const result = await mergeAgentBranch("swarm-1", branch);
      expect(result.success).toBe(true);
      expect(result.merged).toBe(true);
    });
  });

  // ==========================================================================
  // resetSwarmService
  // ==========================================================================

  describe("resetSwarmService", () => {
    it("should clear all swarms and reset counter", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "sess-1",
      });

      await createSwarm({ projectPath: "/tmp/a", agentCount: 1 });
      expect(listSwarms()).toHaveLength(1);

      resetSwarmService();
      expect(listSwarms()).toHaveLength(0);

      // Counter resets — next swarm should be swarm-1
      await createSwarm({ projectPath: "/tmp/b", agentCount: 1 });
      expect(listSwarms()[0].id).toBe("swarm-1");
    });
  });
});
