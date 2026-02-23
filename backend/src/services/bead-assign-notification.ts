/**
 * Bead Assignment Notification Service.
 *
 * Automatically sends a chat message to an agent when a bead is assigned to them.
 * Listens for bead:updated events with an assignee field and creates a message
 * from 'user' notifying the agent of their new assignment.
 */

import { getEventBus } from "./event-bus.js";
import { getSessionBridge } from "./session-bridge.js";
import { wsBroadcast } from "./ws-server.js";
import type { MessageStore } from "./message-store.js";
import { logInfo } from "../utils/index.js";

/**
 * Initialize the bead assignment notification service.
 * Subscribes to bead:updated events and sends messages when assignee changes.
 */
export function initBeadAssignNotification(store: MessageStore): void {
  const bus = getEventBus();

  bus.on("bead:updated", (data) => {
    if (!data.assignee) return;

    const body = `You've been assigned to ${data.id}. Finish what you are working on and then begin immediately. Report updates via Adjutant skills.`;

    const message = store.insertMessage({
      agentId: "user",
      recipient: data.assignee,
      role: "user",
      body,
    });

    // Broadcast via WebSocket so frontend sees the message in real-time
    wsBroadcast({
      type: "chat_message",
      id: message.id,
      from: "user",
      to: data.assignee,
      body: message.body,
      timestamp: message.createdAt,
    });

    logInfo("Sent assignment notification", {
      beadId: data.id,
      assignee: data.assignee,
      messageId: message.id,
    });

    // Deliver to agent's tmux pane
    try {
      const bridge = getSessionBridge();
      const sessions = bridge.registry.findByName(data.assignee);
      for (const session of sessions) {
        bridge.sendInput(session.id, body).then((sent) => {
          if (sent) store.markDelivered(message.id);
        }).catch(() => {});
      }
    } catch {
      // Session bridge not initialized — agent will pull via MCP
    }
  });

  logInfo("Bead assignment notification service initialized");
}
