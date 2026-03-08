import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type {
  EventName,
  McpAgentConnectedEvent,
  McpAgentDisconnectedEvent,
  AgentStatusEvent,
} from "../../event-bus.js";

export const agentLifecycleBehavior: AdjutantBehavior = {
  name: "agent-lifecycle",
  triggers: [
    "mcp:agent_connected",
    "mcp:agent_disconnected",
    "agent:status_changed",
  ] as EventName[],

  shouldAct(_event: BehaviorEvent, _state: unknown): boolean {
    return true; // Always track lifecycle events
  },

  async act(
    event: BehaviorEvent,
    state: unknown,
    comm: unknown,
  ): Promise<void> {
    const adjState = state as AdjutantState;
    const adjComm = comm as CommunicationManager;

    switch (event.name) {
      case "mcp:agent_connected": {
        const data = event.data as McpAgentConnectedEvent;
        adjState.upsertAgentProfile({
          agentId: data.agentId,
          lastStatus: "connected",
          connectedAt: new Date().toISOString(),
          disconnectedAt: null,
        });
        adjState.logDecision({
          behavior: "agent-lifecycle",
          action: "agent_connected",
          target: data.agentId,
          reason: null,
        });
        adjComm.queueRoutine(`Agent "${data.agentId}" connected`);
        break;
      }

      case "mcp:agent_disconnected": {
        const data = event.data as McpAgentDisconnectedEvent;
        adjState.upsertAgentProfile({
          agentId: data.agentId,
          lastStatus: "disconnected",
          disconnectedAt: new Date().toISOString(),
        });
        adjState.logDecision({
          behavior: "agent-lifecycle",
          action: "agent_disconnected",
          target: data.agentId,
          reason: null,
        });
        adjComm.queueRoutine(`Agent "${data.agentId}" disconnected`);
        break;
      }

      case "agent:status_changed": {
        const data = event.data as AgentStatusEvent;
        adjState.upsertAgentProfile({
          agentId: data.agent,
          lastStatus: data.status,
          lastActivity: new Date().toISOString(),
          currentTask: data.activity ?? null,
        });
        break;
      }
    }
  },
};
