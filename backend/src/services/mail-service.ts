/**
 * Mail service for gastown-boy.
 *
 * This service provides a typed interface for mail operations,
 * wrapping the lower-level gt-executor mail commands.
 */

import { gt } from "./gt-executor.js";
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
 * Raw message format from gt mail commands.
 */
interface RawMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
  read: boolean;
  priority: string;
  type: string;
  thread_id: string;
  reply_to?: string;
  pinned?: boolean;
  cc?: string[];
}

// ============================================================================
// Transformation Helpers
// ============================================================================

/**
 * Map priority string to numeric value.
 */
function mapPriority(priority: string): MessagePriority {
  const priorityMap: Record<string, MessagePriority> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
    lowest: 4,
  };
  return priorityMap[priority.toLowerCase()] ?? 2;
}

/**
 * Transform raw gt message to Message format.
 */
function transformMessage(raw: RawMessage): Message {
  const result: Message = {
    id: raw.id,
    from: raw.from,
    to: raw.to,
    subject: raw.subject,
    body: raw.body,
    timestamp: raw.timestamp,
    read: raw.read,
    priority: mapPriority(raw.priority),
    type: raw.type as Message["type"],
    threadId: raw.thread_id,
    pinned: raw.pinned ?? false,
  };
  if (raw.reply_to) {
    result.replyTo = raw.reply_to;
  }
  if (raw.cc) {
    result.cc = raw.cc;
  }
  return result;
}

// ============================================================================
// Mail Service
// ============================================================================

/**
 * Lists all mail messages, sorted by newest first.
 */
export async function listMail(): Promise<MailServiceResult<Message[]>> {
  const result = await gt.mail.inbox<RawMessage[]>();

  if (!result.success) {
    return {
      success: false,
      error: {
        code: result.error?.code ?? "LIST_MAIL_ERROR",
        message: result.error?.message ?? "Failed to list mail",
      },
    };
  }

  // Validate response structure - gt mail inbox returns a raw array
  if (!result.data || !Array.isArray(result.data)) {
    return {
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "Invalid response from mail inbox",
      },
    };
  }

  // Transform and sort messages by timestamp, newest first
  const transformed = result.data.map(transformMessage);
  const sorted = transformed.sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

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

  const result = await gt.mail.read<RawMessage>(messageId);

  if (!result.success) {
    return {
      success: false,
      error: {
        code: result.error?.code ?? "GET_MESSAGE_ERROR",
        message: result.error?.message ?? `Failed to get message: ${messageId}`,
      },
    };
  }

  if (!result.data) {
    return {
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "Empty message response",
      },
    };
  }

  // Transform raw message to expected format
  const transformed = transformMessage(result.data);
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

  // Build send options, only including defined values
  const sendOptions: {
    type?: "notification" | "task" | "scavenge" | "reply";
    priority?: 0 | 1 | 2 | 3 | 4;
    replyTo?: string;
  } = {};
  if (request.type !== undefined) sendOptions.type = request.type;
  if (request.priority !== undefined) sendOptions.priority = request.priority;
  if (request.replyTo !== undefined) sendOptions.replyTo = request.replyTo;

  const result = await gt.mail.send(
    to,
    request.subject,
    request.body,
    sendOptions
  );

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

  const result = await gt.mail.markRead(messageId);

  if (!result.success) {
    return {
      success: false,
      error: {
        code: result.error?.code ?? "MARK_READ_ERROR",
        message: result.error?.message ?? `Failed to mark message as read`,
      },
    };
  }

  return { success: true };
}
