/**
 * BeadsTransport - MailTransport implementation for standalone deployments.
 *
 * Uses direct bd/beads operations without:
 * - gt binary dependency
 * - tmux session notifications
 *
 * Suitable for:
 * - Standalone single-project mode
 * - Swarm deployments without Gas Town infrastructure
 */

import { randomBytes } from "crypto";
import { execBd, resolveBeadsDir, type BeadsIssue } from "../bd-client.js";
import { resolveWorkspaceRoot } from "../workspace/index.js";
import {
  addressToIdentity,
  beadsIssueToMessage,
  parseMessageLabels,
} from "../gastown-utils.js";
import { listMailIssues } from "../mail-data.js";
import type { Message, MessagePriority } from "../../types/index.js";
import type {
  MailTransport,
  SendOptions,
  TransportResult,
  ListMailOptions,
} from "./mail-transport.js";

/**
 * Map priority to valid MessagePriority value.
 */
function mapPriority(priority: number | undefined): MessagePriority {
  if (priority === 0 || priority === 1 || priority === 2 || priority === 3 || priority === 4) {
    return priority;
  }
  return 2;
}

/**
 * Transform raw beads issue to Message format.
 */
function transformMessage(raw: BeadsIssue): Message {
  return beadsIssueToMessage({
    ...raw,
    priority: mapPriority(raw.priority),
  });
}

function identityVariants(identity: string): string[] {
  // In standalone mode, identities are simpler
  if (identity === "user") return ["user", "user/"];
  return [identity];
}

function matchesIdentity(issue: BeadsIssue, identity: string): boolean {
  const variants = new Set(identityVariants(identity));
  const assignee = issue.assignee ?? "";
  if (variants.has(assignee)) return true;
  const labels = parseMessageLabels(issue.labels);
  if (labels.sender && variants.has(labels.sender)) return true;
  return labels.cc.some((cc) => variants.has(cc));
}

function isNotFoundError(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("not found") || lower.includes("no such") || lower.includes("missing");
}

function generateThreadId(): string {
  return `thread-${randomBytes(6).toString("hex")}`;
}

async function resolveThreadId(
  workspaceRoot: string,
  beadsDir: string,
  replyTo?: string
): Promise<string | undefined> {
  if (!replyTo) return undefined;
  const result = await execBd<BeadsIssue>(["show", replyTo, "--json"], {
    cwd: workspaceRoot,
    beadsDir,
  });
  if (!result.success || !result.data) return undefined;
  const labels = parseMessageLabels(result.data.labels);
  return labels.threadId;
}

/**
 * BeadsTransport implementation.
 *
 * Direct beads operations without Gas Town infrastructure.
 * No tmux notifications - relies on polling or push notifications only.
 */
export class BeadsTransport implements MailTransport {
  readonly name = "beads";

  getSenderIdentity(): string {
    // In standalone mode, default to "user" identity
    return process.env["MAIL_IDENTITY"] ?? "user";
  }

  async listMail(options?: ListMailOptions): Promise<TransportResult<Message[]>> {
    const workspaceRoot = resolveWorkspaceRoot();
    const identity = options?.identity === undefined
      ? addressToIdentity(this.getSenderIdentity())
      : options?.identity;

    let issues: BeadsIssue[];
    try {
      issues = await listMailIssues(workspaceRoot);
    } catch (err) {
      return {
        success: false,
        error: {
          code: "LIST_MAIL_ERROR",
          message: err instanceof Error ? err.message : "Failed to list mail",
        },
      };
    }

    if (!Array.isArray(issues)) {
      return {
        success: false,
        error: {
          code: "INVALID_RESPONSE",
          message: "Invalid response from mail list",
        },
      };
    }

    const messages = identity
      ? issues.filter((issue) => matchesIdentity(issue, identity))
      : issues;
    const transformed = messages.map(transformMessage);
    const sorted = transformed.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const limited = options?.limit ? sorted.slice(0, options.limit) : sorted;
    return { success: true, data: limited };
  }

  async getMessage(messageId: string): Promise<TransportResult<Message>> {
    if (!messageId) {
      return {
        success: false,
        error: {
          code: "INVALID_ARGUMENT",
          message: "Message ID is required",
        },
      };
    }

    const workspaceRoot = resolveWorkspaceRoot();
    const beadsDir = resolveBeadsDir(workspaceRoot);
    const result = await execBd<BeadsIssue[]>(["show", messageId, "--json"], {
      cwd: workspaceRoot,
      beadsDir,
    });

    if (!result.success) {
      const code = isNotFoundError(result.error?.message) ? "NOT_FOUND" : "GET_MESSAGE_ERROR";
      return {
        success: false,
        error: {
          code,
          message: result.error?.message ?? `Failed to get message: ${messageId}`,
        },
      };
    }

    const firstMessage = result.data?.[0];
    if (!firstMessage) {
      return {
        success: false,
        error: {
          code: "INVALID_RESPONSE",
          message: "Empty message response",
        },
      };
    }

    const transformed = transformMessage(firstMessage);
    return { success: true, data: transformed };
  }

  async sendMessage(options: SendOptions): Promise<TransportResult<{ messageId?: string }>> {
    if (!options.subject) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Subject is required",
        },
      };
    }

    if (!options.body) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Message body is required",
        },
      };
    }

    const workspaceRoot = resolveWorkspaceRoot();
    const beadsDir = resolveBeadsDir(workspaceRoot);
    const toIdentity = addressToIdentity(options.to);
    const fromIdentity = addressToIdentity(options.from);
    const priority = mapPriority(options.priority);
    const threadId = (await resolveThreadId(workspaceRoot, beadsDir, options.replyTo)) ?? generateThreadId();

    const labels = [`from:${fromIdentity}`, `thread:${threadId}`];
    if (options.replyTo) labels.push(`reply-to:${options.replyTo}`);
    if (options.type) labels.push(`msg-type:${options.type}`);

    const args = [
      "create",
      options.subject,
      "--type",
      "message",
      "--assignee",
      toIdentity,
      "-d",
      options.body,
      "--priority",
      priority.toString(),
    ];
    if (labels.length > 0) {
      args.push("--labels", labels.join(","));
    }
    args.push("--actor", fromIdentity);

    const result = await execBd<string>(args, {
      cwd: workspaceRoot,
      beadsDir,
      parseJson: false,
      env: { BD_ACTOR: fromIdentity },
    });

    if (!result.success) {
      return {
        success: false,
        error: {
          code: result.error?.code ?? "SEND_FAILED",
          message: result.error?.message ?? "Failed to send message",
        },
      };
    }

    // In standalone mode, no tmux notifications
    // Push notifications could be added via NotificationProvider if configured

    return { success: true, data: {} };
  }

  async markRead(messageId: string): Promise<TransportResult<void>> {
    if (!messageId) {
      return {
        success: false,
        error: {
          code: "INVALID_ARGUMENT",
          message: "Message ID is required",
        },
      };
    }

    const workspaceRoot = resolveWorkspaceRoot();
    const beadsDir = resolveBeadsDir(workspaceRoot);
    const result = await execBd<string>(["label", "add", messageId, "read"], {
      cwd: workspaceRoot,
      beadsDir,
      parseJson: false,
    });

    if (!result.success) {
      const code = isNotFoundError(result.error?.message) ? "NOT_FOUND" : "MARK_READ_ERROR";
      return {
        success: false,
        error: {
          code,
          message: result.error?.message ?? "Failed to mark message as read",
        },
      };
    }

    return { success: true };
  }
}
