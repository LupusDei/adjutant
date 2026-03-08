import type { MessageStore } from "../message-store.js";
import { wsBroadcast } from "../ws-server.js";
import { isAPNsConfigured, sendNotificationToAll } from "../apns-service.js";

export interface CommunicationManager {
  /** Queue a routine message (batched, flushed by periodic-summary) */
  queueRoutine(message: string): void;
  /** Send an important message to the user immediately */
  sendImportant(message: string): Promise<void>;
  /** Send an urgent message to the user + APNS push notification */
  escalate(message: string): Promise<void>;
  /** Send a message to a specific agent */
  messageAgent(agentId: string, message: string): Promise<void>;
  /** Flush and return all queued routine messages (called by periodic-summary) */
  flushRoutineQueue(): string[];
  /** Get current routine queue length (for diagnostics) */
  getRoutineQueueLength(): number;
}

export function createCommunicationManager(store: MessageStore): CommunicationManager {
  const routineQueue: string[] = [];
  const ADJUTANT_AGENT_ID = "adjutant-core";

  return {
    queueRoutine(message: string): void {
      routineQueue.push(message);
    },

    async sendImportant(message: string): Promise<void> {
      const msg = store.insertMessage({
        agentId: ADJUTANT_AGENT_ID,
        recipient: "user",
        role: "agent",
        body: message,
      });
      wsBroadcast({
        type: "chat_message",
        id: msg.id,
        from: ADJUTANT_AGENT_ID,
        to: "user",
        body: msg.body,
        timestamp: msg.createdAt,
      });
    },

    async escalate(message: string): Promise<void> {
      const msg = store.insertMessage({
        agentId: ADJUTANT_AGENT_ID,
        recipient: "user",
        role: "agent",
        body: message,
      });
      wsBroadcast({
        type: "chat_message",
        id: msg.id,
        from: ADJUTANT_AGENT_ID,
        to: "user",
        body: msg.body,
        timestamp: msg.createdAt,
      });

      if (isAPNsConfigured()) {
        const truncated = message.length > 200 ? message.slice(0, 197) + "..." : message;
        await sendNotificationToAll({
          title: "Adjutant Alert",
          body: truncated,
          sound: "default",
          category: "ADJUTANT_ESCALATION",
          threadId: "adjutant",
          data: { type: "adjutant_escalation", messageId: msg.id },
        }).catch(() => {}); // swallow APNS errors
      }
    },

    async messageAgent(agentId: string, message: string): Promise<void> {
      const msg = store.insertMessage({
        agentId: ADJUTANT_AGENT_ID,
        recipient: agentId,
        role: "agent",
        body: message,
      });
      wsBroadcast({
        type: "chat_message",
        id: msg.id,
        from: ADJUTANT_AGENT_ID,
        to: agentId,
        body: msg.body,
        timestamp: msg.createdAt,
      });
    },

    flushRoutineQueue(): string[] {
      const flushed = [...routineQueue];
      routineQueue.length = 0;
      return flushed;
    },

    getRoutineQueueLength(): number {
      return routineQueue.length;
    },
  };
}
