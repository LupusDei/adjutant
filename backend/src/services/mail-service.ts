/**
 * Mail service for Adjutant.
 *
 * This service provides a typed interface for mail operations.
 * Delegates to the appropriate MailTransport based on deployment mode:
 * - Gas Town: gt mail send with tmux notifications
 * - Standalone: Direct beads operations
 */

import { getTransport, type TransportResult } from "./transport/index.js";
import { getEventBus } from "./event-bus.js";
import type { Message, SendMessageRequest, MessagePriority } from "../types/index.js";

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

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Convert TransportResult to MailServiceResult.
 */
function toServiceResult<T>(result: TransportResult<T>): MailServiceResult<T> {
  return result;
}

/**
 * Get the current mail sender identity.
 * Exported for use by the API.
 */
export function getMailIdentity(): string {
  return getTransport().getSenderIdentity();
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
  const transport = getTransport();
  const options = filterIdentity !== undefined ? { identity: filterIdentity } : {};
  const result = await transport.listMail(options);
  return toServiceResult(result);
}

/**
 * Gets a single message by ID.
 */
export async function getMessage(
  messageId: string
): Promise<MailServiceResult<Message>> {
  const transport = getTransport();
  const result = await transport.getMessage(messageId);
  return toServiceResult(result);
}

/**
 * Sends a message. Defaults to sending to the Mayor (or user in standalone).
 */
export async function sendMail(
  request: SendMessageRequest
): Promise<MailServiceResult<void>> {
  const transport = getTransport();

  // Determine default recipient based on deployment mode
  const defaultTo = transport.name === "gastown" ? "mayor/" : "user";

  // Build send options, only including optional fields if defined
  const sendOptions: Parameters<typeof transport.sendMessage>[0] = {
    to: request.to ?? defaultTo,
    from: request.from ?? transport.getSenderIdentity(),
    subject: request.subject,
    body: request.body,
    priority: mapPriority(request.priority),
  };
  if (request.type !== undefined) sendOptions.type = request.type;
  if (request.replyTo !== undefined) sendOptions.replyTo = request.replyTo;
  if (request.includeReplyInstructions !== undefined) {
    sendOptions.includeReplyInstructions = request.includeReplyInstructions;
  }

  const result = await transport.sendMessage(sendOptions);

  // Convert to void result (drop messageId from data)
  if (result.success) {
    // Emit mail:received event for SSE/WebSocket consumers
    getEventBus().emit("mail:received", {
      id: result.data?.messageId ?? "",
      from: sendOptions.from ?? "",
      to: sendOptions.to ?? "",
      subject: sendOptions.subject,
      preview: sendOptions.body.slice(0, 120),
    });
    return { success: true };
  }
  if (result.error) {
    return { success: false, error: result.error };
  }
  return { success: false };
}

/**
 * Marks a message as read. This is idempotent.
 */
export async function markRead(
  messageId: string
): Promise<MailServiceResult<void>> {
  const transport = getTransport();
  const result = await transport.markRead(messageId);
  if (result.success) {
    getEventBus().emit("mail:read", { id: messageId });
  }
  return toServiceResult(result);
}
