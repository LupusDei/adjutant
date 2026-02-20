/**
 * MailTransport interface for abstracting mail delivery mechanisms.
 *
 * Implementations:
 * - GasTownTransport: Uses gt mail send with tmux notifications
 * - BeadsTransport: Direct bd/beads operations (swarm mode)
 */

import type { Message, MessagePriority, MessageType } from "../../types/index.js";

/**
 * Options for sending a message.
 */
export interface SendOptions {
  /** Recipient address */
  to: string;
  /** Sender address */
  from: string;
  /** Message subject */
  subject: string;
  /** Message body */
  body: string;
  /** Priority (0-4, default 2) */
  priority?: MessagePriority;
  /** Message type */
  type?: MessageType;
  /** ID of message being replied to */
  replyTo?: string;
  /** Whether to include reply instructions in body */
  includeReplyInstructions?: boolean;
}

/**
 * Result type for transport operations.
 */
export interface TransportResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Options for listing mail.
 */
export interface ListMailOptions {
  /** Filter by recipient identity (null = no filter) */
  identity?: string | null;
  /** Include messages from this sender in results */
  includeSentBy?: boolean;
  /** Maximum number of results */
  limit?: number;
}

/**
 * Abstract interface for mail transport operations.
 *
 * Implementations handle the actual storage and delivery
 * of messages, while the mail-service provides the public API.
 */
export interface MailTransport {
  /** Transport name for logging/debugging */
  readonly name: string;

  /**
   * List mail messages.
   *
   * @param options List options (identity filter, limit, etc.)
   * @returns List of messages sorted by newest first
   */
  listMail(options?: ListMailOptions): Promise<TransportResult<Message[]>>;

  /**
   * Get a single message by ID.
   *
   * @param messageId The message ID
   * @returns The message or error if not found
   */
  getMessage(messageId: string): Promise<TransportResult<Message>>;

  /**
   * Send a message.
   *
   * Implementations should handle:
   * - Storage of the message
   * - Thread management (replyTo, threadId)
   * - Notifications (tmux, push, etc.)
   *
   * @param options Send options
   * @returns Success/error result with optional message ID
   */
  sendMessage(options: SendOptions): Promise<TransportResult<{ messageId?: string }>>;

  /**
   * Mark a message as read.
   *
   * @param messageId The message ID
   * @returns Success/error result
   */
  markRead(messageId: string): Promise<TransportResult<void>>;

  /**
   * Get the current sender identity.
   * Used for determining "from" address when not explicitly specified.
   *
   * @returns The identity string (e.g., "overseer", "mayor/")
   */
  getSenderIdentity(): string;
}

/**
 * Notification provider interface for sending alerts.
 *
 * Separates notification delivery from mail transport,
 * allowing different notification mechanisms per deployment.
 */
export interface NotificationProvider {
  /** Provider name */
  readonly name: string;

  /**
   * Send a notification about new mail.
   *
   * @param to Recipient address
   * @param from Sender address
   * @param subject Message subject
   * @param messageId Optional message ID for deep linking
   */
  notifyNewMail(to: string, from: string, subject: string, messageId?: string): Promise<void>;
}
