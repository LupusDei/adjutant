/**
 * GasTownTransport - MailTransport implementation for Gas Town deployments.
 *
 * Uses gt mail send for message delivery with:
 * - tmux session notifications (nudge)
 * - APNS push notifications
 * - Thread management via beads labels
 */

import { randomBytes } from "crypto";
import { execBd, resolveBeadsDir, type BeadsIssue } from "../bd-client.js";
import { gt } from "../gt-executor.js";
import { resolveWorkspaceRoot } from "../workspace/index.js";
import {
  addressToIdentity,
  beadsIssueToMessage,
  parseMessageLabels,
} from "../gastown-utils.js";
import { listMailIssues } from "../mail-data.js";
import { sendNewMailNotification } from "../apns-service.js";
import { TmuxNotificationProvider } from "./notification-providers.js";
import type { Message, MessagePriority } from "../../types/index.js";
import type {
  MailTransport,
  SendOptions,
  TransportResult,
  ListMailOptions,
  NotificationProvider,
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
  if (identity === "mayor/") return ["mayor/", "mayor"];
  if (identity === "deacon/") return ["deacon/", "deacon"];
  return [identity];
}

function matchesIdentity(issue: BeadsIssue, identity: string): boolean {
  const variants = new Set(identityVariants(identity));
  const assignee = issue.assignee ?? "";
  if (variants.has(assignee)) return true;
  const labels = parseMessageLabels(issue.labels);
  // Also match messages SENT BY this identity (for chat view)
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

function formatReplyInstructions(messageId: string, senderAddress: string): string {
  return `\n\n---\nTo reply: gt mail send ${senderAddress} -s "RE: ..." -m "your message" --reply-to ${messageId}`;
}

async function resolveThreadId(
  townRoot: string,
  beadsDir: string,
  replyTo?: string
): Promise<string | undefined> {
  if (!replyTo) return undefined;
  const result = await execBd<BeadsIssue>(["show", replyTo, "--json"], {
    cwd: townRoot,
    beadsDir,
  });
  if (!result.success || !result.data) return undefined;
  const labels = parseMessageLabels(result.data.labels);
  return labels.threadId;
}

// Notification provider instance
const notificationProvider: NotificationProvider = new TmuxNotificationProvider();

/**
 * GasTownTransport implementation.
 *
 * Uses gt mail send for primary delivery, falls back to direct bd create.
 * Sends both tmux nudge and APNS push notifications.
 */
export class GasTownTransport implements MailTransport {
  readonly name = "gastown";

  getSenderIdentity(): string {
    // Adjutant UI always sends as 'overseer' - don't inherit polecat env vars
    // Only GT_MAIL_IDENTITY can override (explicit config for this app)
    return process.env["GT_MAIL_IDENTITY"] ?? "overseer";
  }

  async listMail(options?: ListMailOptions): Promise<TransportResult<Message[]>> {
    const townRoot = resolveWorkspaceRoot();
    const identity = options?.identity === undefined
      ? addressToIdentity(this.getSenderIdentity())
      : options?.identity;

    let issues: BeadsIssue[];
    try {
      issues = await listMailIssues(townRoot);
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
          message: "Invalid response from mail inbox",
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

    // Apply limit if specified
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

    const townRoot = resolveWorkspaceRoot();
    const beadsDir = resolveBeadsDir(townRoot);
    const result = await execBd<BeadsIssue[]>(["show", messageId, "--json"], {
      cwd: townRoot,
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
    // Validate required fields
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

    const priority = mapPriority(options.priority);
    const from = options.from;

    // Check if we can use gt mail send (only when using default sender mechanism)
    // gt mail send doesn't support custom --from, so we need direct bd create for that
    const useGtMailSend = options.from === this.getSenderIdentity();

    if (useGtMailSend) {
      try {
        const sendOptions: {
          type?: "notification" | "task" | "scavenge" | "reply";
          priority?: 0 | 1 | 2 | 3 | 4;
          replyTo?: string;
          permanent?: boolean;
          notify?: boolean;
        } = {
          priority,
          permanent: true,
          notify: true,
        };
        if (options.type) sendOptions.type = options.type as "notification" | "task" | "scavenge" | "reply";
        if (options.replyTo) sendOptions.replyTo = options.replyTo;

        const result = await gt.mail.send(options.to, options.subject, options.body, sendOptions, {
          env: {
            BD_ACTOR: from,
          },
        });

        if (result.success) {
          // Handle reply instructions if requested
          if (options.includeReplyInstructions) {
            await this.appendReplyInstructions(options);
          }

          // Send push notification
          void sendNewMailNotification(from, options.subject, "");
          return { success: true, data: {} };
        }

        // Fall back to bd create if gt failed
        console.warn("gt mail send failed, falling back to bd create", result.error);
      } catch (err) {
        console.warn("gt mail send exception, falling back to bd create", err);
      }
    }

    // Fallback: direct bd create
    return this.sendViaBdCreate(options, priority);
  }

  private async appendReplyInstructions(options: SendOptions): Promise<void> {
    try {
      const townRoot = resolveWorkspaceRoot();
      const beadsDir = resolveBeadsDir(townRoot);
      const fromIdentity = addressToIdentity(options.from);

      // Find the message we just sent
      const findResult = await execBd<BeadsIssue[]>(
        ["list", "--type", "message", "--json", "--limit", "1"],
        { cwd: townRoot, beadsDir }
      );

      if (findResult.success && findResult.data?.[0]) {
        const msg = findResult.data[0];
        const replyInstructions = formatReplyInstructions(msg.id, `${fromIdentity}/`);
        const updatedBody = options.body + replyInstructions;

        await execBd(
          ["update", msg.id, "-d", updatedBody],
          { cwd: townRoot, beadsDir, parseJson: false }
        );

        void sendNewMailNotification(options.from, options.subject, msg.id);
      }
    } catch (err) {
      console.warn("Failed to add reply instructions:", err);
    }
  }

  private async sendViaBdCreate(
    options: SendOptions,
    priority: MessagePriority
  ): Promise<TransportResult<{ messageId?: string }>> {
    const townRoot = resolveWorkspaceRoot();
    const beadsDir = resolveBeadsDir(townRoot);
    const toIdentity = addressToIdentity(options.to);
    const fromIdentity = addressToIdentity(options.from);
    const threadId = (await resolveThreadId(townRoot, beadsDir, options.replyTo)) ?? generateThreadId();

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
      cwd: townRoot,
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

    // Send tmux notification since we bypassed gt mail send
    void notificationProvider.notifyNewMail(options.to, fromIdentity, options.subject);

    // Send push notification
    void sendNewMailNotification(fromIdentity, options.subject, "");

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

    const townRoot = resolveWorkspaceRoot();
    const beadsDir = resolveBeadsDir(townRoot);
    const result = await execBd<string>(["label", "add", messageId, "read"], {
      cwd: townRoot,
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
