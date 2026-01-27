/**
 * Mail service for Adjutant.
 *
 * This service provides a typed interface for mail operations
 * using bd/beads storage (no gt binary required).
 */

import { randomBytes } from "crypto";
import { spawn } from "child_process";
import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { gt } from "./gt-executor.js";
import { resolveTownRoot } from "./gastown-workspace.js";
import { addressToIdentity, beadsIssueToMessage, parseMessageLabels } from "./gastown-utils.js";
import { listMailIssues } from "./mail-data.js";
import { sendNewMailNotification } from "./apns-service.js";
import type { Message, SendMessageRequest, MessagePriority } from "../types/mail.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for mail service operations.
 */
export interface MailServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Raw message format from beads.
 */
type RawMessage = BeadsIssue;

// ============================================================================
// Transformation Helpers
// ============================================================================

/**
 * Map priority string to numeric value.
 */
function mapPriority(priority: number | undefined): MessagePriority {
  if (priority === 0 || priority === 1 || priority === 2 || priority === 3 || priority === 4) {
    return priority;
  }
  return 2;
}

/**
 * Transform raw gt message to Message format.
 */
function transformMessage(raw: RawMessage): Message {
  return beadsIssueToMessage({
    ...raw,
    priority: mapPriority(raw.priority),
  });
}

function resolveMailIdentity(): string {
  // Adjutant UI always sends as 'overseer' - don't inherit polecat env vars
  // Only GT_MAIL_IDENTITY can override (explicit config for this app)
  return process.env["GT_MAIL_IDENTITY"] ?? "overseer";
}

/**
 * Get the current mail sender identity.
 * Exported for use by the API.
 */
export function getMailIdentity(): string {
  return resolveMailIdentity();
}

function identityVariants(identity: string): string[] {
  if (identity === "mayor/") return ["mayor/", "mayor"];
  if (identity === "deacon/") return ["deacon/", "deacon"];
  return [identity];
}

function matchesIdentity(issue: RawMessage, identity: string): boolean {
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

/**
 * Nudge a tmux session with a notification message.
 * This injects the message into the agent's conversation by typing it and pressing Enter.
 * Mirrors the behavior of gt mail send --notify.
 */
async function nudgeSession(session: string, message: string): Promise<void> {
  // Helper to run tmux commands
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

  // 3. Send Escape to exit vim INSERT mode if enabled (harmless in normal mode)
  await runTmux(["send-keys", "-t", session, "Escape"]);
  await new Promise((r) => setTimeout(r, 100));

  // 4. Send Enter to submit the message
  await runTmux(["send-keys", "-t", session, "Enter"]);
}

/**
 * Send a tmux notification to a session.
 * Maps recipient address to tmux session name.
 */
function sendTmuxNotification(to: string, from: string, subject: string): void {
  // Map recipient to tmux session
  let session: string | null = null;
  if (to === "mayor/" || to === "mayor") {
    session = "hq-mayor";
  }
  // Add more mappings as needed for other recipients

  if (!session) return;

  const message = `📬 You have new mail from ${from}. Subject: ${subject}. Run 'gt mail inbox' to read.`;

  // Fire and forget - don't block on the notification
  void nudgeSession(session, message);
}

// ============================================================================
// Mail Service
// ============================================================================

/**
 * Lists all mail messages, sorted by newest first.
 */
export async function listMail(
  filterIdentity?: string | null
): Promise<MailServiceResult<Message[]>> {
  const townRoot = resolveTownRoot();
  const identity =
    filterIdentity === undefined
      ? addressToIdentity(resolveMailIdentity())
      : filterIdentity;

  let issues: RawMessage[];
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

  return { success: true, data: sorted };
}

/**
 * Gets a single message by ID.
 */
export async function getMessage(
  messageId: string
): Promise<MailServiceResult<Message>> {
  if (!messageId) {
    return {
      success: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Message ID is required",
      },
    };
  }

  const townRoot = resolveTownRoot();
  const beadsDir = resolveBeadsDir(townRoot);
  const result = await execBd<RawMessage[]>(["show", messageId, "--json"], {
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

/**
 * Sends a message. Defaults to sending to the Mayor.
 */
export async function sendMail(
  request: SendMessageRequest
): Promise<MailServiceResult<void>> {
  // Validate required fields
  if (!request.subject) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Subject is required",
      },
    };
  }

  if (!request.body) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Message body is required",
      },
    };
  }

  const to = request.to ?? "mayor/";
  const from = request.from ?? resolveMailIdentity();
  const priority = mapPriority(request.priority);
  const replyTo = request.replyTo;

  // If custom from is specified, use bd create directly (gt mail send doesn't support --from)
  const useDirectCreate = request.from !== undefined;

  // Use gt mail send (ensures notifications trigger) - only when using default sender
  if (!useDirectCreate) try {
    const sendOptions: {
      type?: 'notification' | 'task' | 'scavenge' | 'reply';
      priority?: 0 | 1 | 2 | 3 | 4;
      replyTo?: string;
      permanent?: boolean;
      notify?: boolean;
    } = {
      priority,
      permanent: true, // Default to permanent
      notify: true,    // Ensure agent is notified
    };
    if (request.type) sendOptions.type = request.type as 'notification' | 'task' | 'scavenge' | 'reply';
    if (replyTo) sendOptions.replyTo = replyTo;

    const result = await gt.mail.send(to, request.subject, request.body, sendOptions, {
      env: {
        BD_ACTOR: from, // Override actor with current identity
      }
    });

    if (result.success) {
      // If reply instructions requested, find the message and append them
      if (request.includeReplyInstructions) {
        try {
          const townRoot = resolveTownRoot();
          const beadsDir = resolveBeadsDir(townRoot);
          const fromIdentity = addressToIdentity(from);

          // Find the message we just sent (most recent from this sender with this subject)
          const findResult = await execBd<BeadsIssue[]>(
            ["list", "--type", "message", "--json", "--limit", "1"],
            { cwd: townRoot, beadsDir }
          );

          if (findResult.success && findResult.data?.[0]) {
            const msg = findResult.data[0];
            const replyInstructions = formatReplyInstructions(msg.id, `${fromIdentity}/`);
            const updatedBody = request.body + replyInstructions;

            await execBd(
              ["update", msg.id, "-d", updatedBody],
              { cwd: townRoot, beadsDir, parseJson: false }
            );

            // Send push notification for new mail
            void sendNewMailNotification(from, request.subject, msg.id);
          }
        } catch (err) {
          // Non-fatal - message was sent, just couldn't add reply instructions
          console.warn("Failed to add reply instructions:", err);
        }
      } else {
        // Send push notification (fire and forget, don't block on it)
        void sendNewMailNotification(from, request.subject, "");
      }
      return { success: true };
    }

    // If gt failed (e.g. command not found), fall back to bd create
    console.warn("gt mail send failed, falling back to bd create", result.error);
  } catch (err) {
    console.warn("gt mail send exception, falling back to bd create", err);
  }

  // Fallback: bd create
  const townRoot = resolveTownRoot();
  const beadsDir = resolveBeadsDir(townRoot);
  const toIdentity = addressToIdentity(to);
  const fromIdentity = addressToIdentity(from);
  const threadId = (await resolveThreadId(townRoot, beadsDir, replyTo)) ?? generateThreadId();

  const labels = [`from:${fromIdentity}`, `thread:${threadId}`];
  if (replyTo) labels.push(`reply-to:${replyTo}`);
  if (request.type) labels.push(`msg-type:${request.type}`);

  const args = [
    "create",
    request.subject,
    "--type",
    "message",
    "--assignee",
    toIdentity,
    "-d",
    request.body,
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
  sendTmuxNotification(to, fromIdentity, request.subject);

  // Send push notification (fire and forget)
  void sendNewMailNotification(fromIdentity, request.subject, "");

  return { success: true };
}

/**
 * Marks a message as read. This is idempotent.
 */
export async function markRead(
  messageId: string
): Promise<MailServiceResult<void>> {
  if (!messageId) {
    return {
      success: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Message ID is required",
      },
    };
  }

  const townRoot = resolveTownRoot();
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
