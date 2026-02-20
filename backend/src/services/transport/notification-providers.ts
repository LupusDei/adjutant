/**
 * Notification provider implementations.
 *
 * Provides different strategies for notifying agents about new mail:
 * - TmuxNotificationProvider: Injects message into tmux sessions
 * - NoOpNotificationProvider: Does nothing (for swarm mode)
 */

import { spawn } from "child_process";
import { getTopology } from "../topology/index.js";
import type { NotificationProvider } from "./mail-transport.js";

/**
 * Nudge a tmux session with a notification message.
 * Injects the message into the agent's conversation by typing it and pressing Enter.
 */
async function nudgeSession(session: string, message: string): Promise<void> {
  const runTmux = (args: string[]): Promise<void> => {
    return new Promise((resolve) => {
      const proc = spawn("tmux", args, { stdio: "ignore" });
      proc.on("close", () => resolve());
      proc.on("error", () => resolve());
    });
  };

  // 1. Send text in literal mode (handles special characters)
  await runTmux(["send-keys", "-t", session, "-l", message]);

  // 2. Wait 500ms for paste to complete
  await new Promise((r) => setTimeout(r, 500));

  // 3. Send Escape to exit vim INSERT mode if enabled
  await runTmux(["send-keys", "-t", session, "Escape"]);
  await new Promise((r) => setTimeout(r, 100));

  // 4. Send Enter to submit the message
  await runTmux(["send-keys", "-t", session, "Enter"]);
}

/**
 * TmuxNotificationProvider - Sends notifications via tmux sessions.
 *
 * Used in Gas Town deployments where agents run in tmux.
 * Injects a notification message into the agent's session.
 */
export class TmuxNotificationProvider implements NotificationProvider {
  readonly name = "tmux";

  async notifyNewMail(
    to: string,
    from: string,
    subject: string,
    _messageId?: string
  ): Promise<void> {
    const topology = getTopology();
    const parsed = topology.parseAddress(to);
    if (!parsed) return;

    const sessionInfo = topology.getSessionInfo(parsed.role, parsed.rig, parsed.name);
    if (!sessionInfo?.name) return;

    const message = `📬 You have new mail from ${from}. Subject: ${subject}. Run 'gt mail inbox' to read.`;

    // Fire and forget
    await nudgeSession(sessionInfo.name, message);
  }
}

/**
 * NoOpNotificationProvider - Does nothing.
 *
 * Used in swarm mode where there are no tmux sessions to notify.
 * Push notifications can be handled separately via APNS.
 */
export class NoOpNotificationProvider implements NotificationProvider {
  readonly name = "noop";

  async notifyNewMail(
    _to: string,
    _from: string,
    _subject: string,
    _messageId?: string
  ): Promise<void> {
    // Do nothing - swarm mode relies on polling or push notifications
  }
}

/**
 * ConsoleNotificationProvider - Logs notifications to console.
 *
 * Useful for development/debugging.
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = "console";

  async notifyNewMail(
    to: string,
    from: string,
    subject: string,
    messageId?: string
  ): Promise<void> {
    console.log(`[Mail Notification] To: ${to}, From: ${from}, Subject: ${subject}${messageId ? `, ID: ${messageId}` : ""}`);
  }
}
