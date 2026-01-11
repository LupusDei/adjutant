/**
 * useMail hook for mail operations.
 *
 * TODO: Implement per gb-v52.3.6
 * This is a stub to allow tests to run. Tests should fail.
 */

import type { Message, SendMessageRequest } from "../types";

/** Options for the useMail hook. */
export interface UseMailOptions {
  /** Polling interval in milliseconds. Default: 30000 (30 seconds) */
  pollInterval?: number;
  /** Whether polling is enabled. Default: true */
  enabled?: boolean;
}

/** Return type for the useMail hook. */
export interface UseMailResult {
  /** List of mail messages */
  messages: Message[];
  /** Total count of messages (from server) */
  total: number;
  /** Whether more messages are available */
  hasMore: boolean;
  /** Whether initial fetch is in progress */
  loading: boolean;
  /** Error from last fetch attempt */
  error: Error | null;
  /** Manually refresh messages */
  refresh: () => Promise<void>;
  /** Send a new message */
  sendMessage: (request: SendMessageRequest) => Promise<void>;
  /** Whether a send operation is in progress */
  sending: boolean;
  /** Error from last send attempt */
  sendError: Error | null;
  /** Mark a message as read */
  markAsRead: (messageId: string) => Promise<void>;
  /** Currently selected message (full details) */
  selectedMessage: Message | null;
  /** Whether selected message is loading */
  selectedLoading: boolean;
  /** Error from selecting message */
  selectedError: Error | null;
  /** Select a message and fetch its full details */
  selectMessage: (messageId: string) => Promise<void>;
  /** Clear the current selection */
  clearSelection: () => void;
  /** Count of unread messages */
  unreadCount: number;
}

/**
 * React hook for mail operations.
 *
 * @param options - Hook configuration options
 * @returns Mail state and operations
 *
 * @example
 * ```tsx
 * const { messages, loading, sendMessage, markAsRead } = useMail();
 * ```
 */
export function useMail(_options: UseMailOptions = {}): UseMailResult {
  // TODO: Implement - this stub returns default values to allow tests to run
  throw new Error("useMail not implemented");
}
