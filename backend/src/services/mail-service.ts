import { gt } from './gt-executor.js';
import type {
  Message,
  SendMessageRequest,
  PaginatedResponse,
} from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ListMailOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface MailServiceError extends Error {
  code: string;
  details?: string;
}

// ============================================================================
// Error Helpers
// ============================================================================

function createMailError(
  code: string,
  message: string,
  details?: string
): MailServiceError {
  const error = new Error(message) as MailServiceError;
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

// ============================================================================
// Mail Service
// ============================================================================

/**
 * List mail messages with optional pagination and filtering.
 */
export async function listMail(
  options: ListMailOptions = {}
): Promise<PaginatedResponse<Message>> {
  const result = await gt.mail.inbox<Message[]>();

  if (!result.success) {
    throw createMailError(
      result.error?.code ?? 'LIST_MAIL_ERROR',
      result.error?.message ?? 'Failed to list mail',
      result.error?.stderr
    );
  }

  const allMessages = result.data ?? [];

  // Apply filtering
  let filtered = options.unreadOnly
    ? allMessages.filter((m) => !m.read)
    : allMessages;

  // Apply pagination
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  const items = filtered.slice(offset, offset + limit);
  const total = filtered.length;
  const hasMore = offset + items.length < total;

  return { items, total, hasMore };
}

/**
 * Get a single message by ID.
 */
export async function getMessage(messageId: string): Promise<Message> {
  if (!messageId) {
    throw createMailError('INVALID_MESSAGE_ID', 'Message ID is required');
  }

  const result = await gt.mail.read<Message>(messageId);

  if (!result.success) {
    throw createMailError(
      result.error?.code ?? 'GET_MESSAGE_ERROR',
      result.error?.message ?? `Failed to get message: ${messageId}`,
      result.error?.stderr
    );
  }

  if (!result.data) {
    throw createMailError('MESSAGE_NOT_FOUND', `Message not found: ${messageId}`);
  }

  return result.data;
}

/**
 * Send a new mail message.
 */
export async function sendMail(
  request: SendMessageRequest
): Promise<{ messageId: string }> {
  if (!request.subject || !request.body) {
    throw createMailError(
      'INVALID_REQUEST',
      'Subject and body are required'
    );
  }

  const to = request.to ?? 'mayor/';

  // Build send options, only including defined values
  const sendOptions: {
    type?: 'notification' | 'task' | 'scavenge' | 'reply';
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
    throw createMailError(
      result.error?.code ?? 'SEND_MAIL_ERROR',
      result.error?.message ?? 'Failed to send mail',
      result.error?.stderr
    );
  }

  // Parse message ID from response
  // gt mail send returns the message ID in stdout
  const messageId = (result.data ?? '').trim() || generateMessageId();

  return { messageId };
}

/**
 * Mark a message as read.
 */
export async function markRead(messageId: string): Promise<void> {
  if (!messageId) {
    throw createMailError('INVALID_MESSAGE_ID', 'Message ID is required');
  }

  const result = await gt.mail.markRead(messageId);

  if (!result.success) {
    throw createMailError(
      result.error?.code ?? 'MARK_READ_ERROR',
      result.error?.message ?? `Failed to mark message as read: ${messageId}`,
      result.error?.stderr
    );
  }
}

/**
 * Get all messages in a thread.
 */
export async function getThread(threadId: string): Promise<Message[]> {
  if (!threadId) {
    throw createMailError('INVALID_THREAD_ID', 'Thread ID is required');
  }

  const result = await gt.mail.thread<Message[]>(threadId);

  if (!result.success) {
    throw createMailError(
      result.error?.code ?? 'GET_THREAD_ERROR',
      result.error?.message ?? `Failed to get thread: ${threadId}`,
      result.error?.stderr
    );
  }

  return result.data ?? [];
}

// ============================================================================
// Helpers
// ============================================================================

function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `msg-${timestamp}-${random}`;
}

// ============================================================================
// Export
// ============================================================================

export const mailService = {
  listMail,
  getMessage,
  sendMail,
  markRead,
  getThread,
};

export default mailService;
