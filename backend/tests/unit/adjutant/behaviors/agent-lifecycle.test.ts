import { describe, it, expect, vi } from "vitest";

import { agentLifecycleBehavior } from "../../../../src/services/adjutant/behaviors/agent-lifecycle.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";

function createMockState() {
  return {
    upsertAgentProfile: vi.fn(),
    logDecision: vi.fn(),
    getAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn(),
    getRecentDecisions: vi.fn(),
    getMeta: vi.fn(),
    setMeta: vi.fn(),
  };
}

function createMockComm() {
  return {
    queueRoutine: vi.fn(),
    sendImportant: vi.fn(),
    escalate: vi.fn(),
    messageAgent: vi.fn(),
    flushRoutineQueue: vi.fn(),
    getRoutineQueueLength: vi.fn(),
  };
}

describe("agentLifecycleBehavior", () => {
  it("has the correct name", () => {
    expect(agentLifecycleBehavior.name).toBe("agent-lifecycle");
  });

  it("triggers on mcp:agent_connected, mcp:agent_disconnected, and agent:status_changed", () => {
    expect(agentLifecycleBehavior.triggers).toEqual([
      "mcp:agent_connected",
      "mcp:agent_disconnected",
      "agent:status_changed",
    ]);
  });

  describe("shouldAct", () => {
    it("always returns true", () => {
      const event: BehaviorEvent = {
        name: "mcp:agent_connected",
        data: { agentId: "test", sessionId: "s1" },
        seq: 1,
      };
      expect(agentLifecycleBehavior.shouldAct(event, {})).toBe(true);
    });

    it("returns true for any event", () => {
      const event: BehaviorEvent = {
        name: "agent:status_changed",
        data: { agent: "test", status: "working" },
        seq: 99,
      };
      expect(agentLifecycleBehavior.shouldAct(event, {})).toBe(true);
    });
  });

  describe("act — mcp:agent_connected", () => {
    it("upserts agent profile with connectedAt, infers role, logs decision, and queues routine", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "mcp:agent_connected",
        data: { agentId: "agent-alpha", sessionId: "session-1" },
        seq: 1,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      // Two upsert calls: first for connection status, second for role inference
      expect(state.upsertAgentProfile).toHaveBeenCalledTimes(2);
      const profileArg = state.upsertAgentProfile.mock.calls[0][0];
      expect(profileArg.agentId).toBe("agent-alpha");
      expect(profileArg.lastStatus).toBe("connected");
      expect(profileArg.connectedAt).toBeDefined();
      expect(profileArg.disconnectedAt).toBeNull();

      // Second call sets role (worker for non-coordinator IDs)
      const roleArg = state.upsertAgentProfile.mock.calls[1][0];
      expect(roleArg.agentId).toBe("agent-alpha");
      expect(roleArg.role).toBe("worker");

      expect(state.logDecision).toHaveBeenCalledOnce();
      expect(state.logDecision).toHaveBeenCalledWith({
        behavior: "agent-lifecycle",
        action: "agent_connected",
        target: "agent-alpha",
        reason: null,
      });

      expect(comm.queueRoutine).toHaveBeenCalledOnce();
      expect(comm.queueRoutine).toHaveBeenCalledWith(
        'Agent "agent-alpha" connected',
      );
    });
  });

  describe("act — mcp:agent_disconnected", () => {
    it("upserts agent profile with disconnectedAt and logs decision and queues routine", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "mcp:agent_disconnected",
        data: { agentId: "agent-beta", sessionId: "session-2" },
        seq: 2,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      expect(state.upsertAgentProfile).toHaveBeenCalledOnce();
      const profileArg = state.upsertAgentProfile.mock.calls[0][0];
      expect(profileArg.agentId).toBe("agent-beta");
      expect(profileArg.lastStatus).toBe("disconnected");
      expect(profileArg.disconnectedAt).toBeDefined();

      expect(state.logDecision).toHaveBeenCalledOnce();
      expect(state.logDecision).toHaveBeenCalledWith({
        behavior: "agent-lifecycle",
        action: "agent_disconnected",
        target: "agent-beta",
        reason: null,
      });

      expect(comm.queueRoutine).toHaveBeenCalledOnce();
      expect(comm.queueRoutine).toHaveBeenCalledWith(
        'Agent "agent-beta" disconnected',
      );
    });
  });

  describe("act — agent:status_changed", () => {
    it("upserts agent profile with lastStatus, lastActivity, and currentTask", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "agent:status_changed",
        data: { agent: "agent-gamma", status: "working", activity: "Building tests" },
        seq: 3,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      expect(state.upsertAgentProfile).toHaveBeenCalledOnce();
      const profileArg = state.upsertAgentProfile.mock.calls[0][0];
      expect(profileArg.agentId).toBe("agent-gamma");
      expect(profileArg.lastStatus).toBe("working");
      expect(profileArg.lastActivity).toBeDefined();
      expect(profileArg.currentTask).toBe("Building tests");

      // status_changed does NOT log decisions or queue routine messages
      expect(state.logDecision).not.toHaveBeenCalled();
      expect(comm.queueRoutine).not.toHaveBeenCalled();
    });

    it("sets currentTask to null when activity is undefined", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "agent:status_changed",
        data: { agent: "agent-delta", status: "idle" },
        seq: 4,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      const profileArg = state.upsertAgentProfile.mock.calls[0][0];
      expect(profileArg.currentTask).toBeNull();
    });
  });

  describe("act — role inference on connect", () => {
    it("should set role='coordinator' for known coordinator IDs", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "mcp:agent_connected",
        data: { agentId: "adjutant-coordinator", sessionId: "session-1" },
        seq: 1,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      // First call: initial upsert with connected status
      // Second call: role inference upsert
      expect(state.upsertAgentProfile).toHaveBeenCalledTimes(2);
      const roleCall = state.upsertAgentProfile.mock.calls[1][0];
      expect(roleCall.agentId).toBe("adjutant-coordinator");
      expect(roleCall.role).toBe("coordinator");
    });

    it("should set role='coordinator' for 'adjutant' agent ID", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "mcp:agent_connected",
        data: { agentId: "adjutant", sessionId: "session-2" },
        seq: 2,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      expect(state.upsertAgentProfile).toHaveBeenCalledTimes(2);
      const roleCall = state.upsertAgentProfile.mock.calls[1][0];
      expect(roleCall.role).toBe("coordinator");
    });

    it("should set role='coordinator' for 'adjutant-core' agent ID", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "mcp:agent_connected",
        data: { agentId: "adjutant-core", sessionId: "session-3" },
        seq: 3,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      expect(state.upsertAgentProfile).toHaveBeenCalledTimes(2);
      const roleCall = state.upsertAgentProfile.mock.calls[1][0];
      expect(roleCall.role).toBe("coordinator");
    });

    it("should set role='worker' for non-coordinator agent IDs", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "mcp:agent_connected",
        data: { agentId: "engineer-1", sessionId: "session-4" },
        seq: 4,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      expect(state.upsertAgentProfile).toHaveBeenCalledTimes(2);
      const roleCall = state.upsertAgentProfile.mock.calls[1][0];
      expect(roleCall.agentId).toBe("engineer-1");
      expect(roleCall.role).toBe("worker");
    });

    it("should not set role on disconnect events", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "mcp:agent_disconnected",
        data: { agentId: "adjutant-coordinator", sessionId: "session-5" },
        seq: 5,
      };

      await agentLifecycleBehavior.act(event, state, comm);

      // Only one call for the disconnect upsert — no role inference
      expect(state.upsertAgentProfile).toHaveBeenCalledOnce();
      const disconnectCall = state.upsertAgentProfile.mock.calls[0][0];
      expect(disconnectCall.role).toBeUndefined();
    });
  });

  describe("act — unrecognized event", () => {
    it("does not crash on unrecognized event name", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = {
        name: "bead:created",
        data: {},
        seq: 5,
      };

      // Should not throw
      await agentLifecycleBehavior.act(event, state, comm);

      // Should not call any state or comm methods
      expect(state.upsertAgentProfile).not.toHaveBeenCalled();
      expect(state.logDecision).not.toHaveBeenCalled();
      expect(comm.queueRoutine).not.toHaveBeenCalled();
    });
  });
});
