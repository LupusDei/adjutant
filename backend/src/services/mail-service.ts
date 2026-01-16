/**
 * Mail service for gastown-boy.
 *
 * This service provides a typed interface for mail operations
 * using bd/beads storage (no gt binary required).
 */

import { randomBytes } from "crypto";
import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { gt } from "./gt-executor.js";
import { resolveTownRoot } from "./gastown-workspace.js";
import { addressToIdentity, beadsIssueToMessage, parseMessageLabels } from "./gastown-utils.js";
import { listMailIssues } from "./mail-data.js";
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
  // gastown-boy UI always sends as 'overseer' - don't inherit polecat env vars
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

function generateMessageId(): string {
  return `gb-${randomBytes(6).toString("hex")}`;
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

  // When includeReplyInstructions is true, we need to pre-generate the message ID
  // and use bd create directly (skipping gt.mail.send) so we can specify the ID
  if (request.includeReplyInstructions) {
    const townRoot = resolveTownRoot();
    const beadsDir = resolveBeadsDir(townRoot);
    const toIdentity = addressToIdentity(to);
    const fromIdentity = addressToIdentity(from);
    const threadId = (await resolveThreadId(townRoot, beadsDir, replyTo)) ?? generateThreadId();
    const messageId = generateMessageId();

    // Format sender address for reply (ensure trailing slash for gt mail send)
    const senderAddress = fromIdentity.endsWith("/") ? fromIdentity : `${fromIdentity}/`;
    const bodyWithReplyInstructions = request.body + formatReplyInstructions(messageId, senderAddress);

    const labels = [`from:${fromIdentity}`, `thread:${threadId}`];
    if (replyTo) labels.push(`reply-to:${replyTo}`);
    if (request.type) labels.push(`msg-type:${request.type}`);

    const args = [
      "create",
      request.subject,
      "--type",
      "message",
      "--id",
      messageId,
      "--assignee",
      toIdentity,
      "-d",
      bodyWithReplyInstructions,
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

    return { success: true };
  }

  // Standard path: Try using gt mail send first (ensures notifications trigger)
  try {
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
