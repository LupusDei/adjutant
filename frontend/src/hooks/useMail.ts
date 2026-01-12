/**
 * useMail hook for mail operations.
 *
 * Provides state management for fetching, sending, and managing mail messages
 * with polling support and optimistic updates.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "../services/api";
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
  /** Clear the send error state */
  clearSendError: () => void;
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

const DEFAULT_POLL_INTERVAL = 30000;

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
export function useMail(options: UseMailOptions = {}): UseMailResult {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  // Message list state
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Send state
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<Error | null>(null);

  // Selection state
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<Error | null>(null);

  // Track mounted state
  const mountedRef = useRef(true);

  // Fetch messages from API
  const fetchMessages = useCallback(async () => {
    if (!mountedRef.current) return;

    setLoading(true);
    try {
      const response = await api.mail.list();
      if (mountedRef.current) {
        setMessages(response.items);
        setTotal(response.total);
        setHasMore(response.hasMore);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        // Preserve existing messages on error
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch and polling
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    // Initial fetch
    void fetchMessages();

    // Set up polling
    const intervalId = setInterval(() => {
      void fetchMessages();
    }, pollInterval);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [enabled, pollInterval, fetchMessages]);

  // Manual refresh
  const refresh = useCallback(async () => {
    await fetchMessages();
  }, [fetchMessages]);

  // Clear send error
  const clearSendError = useCallback(() => {
    setSendError(null);
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (request: SendMessageRequest) => {
      // Clear previous error and set sending state before async operation
      // This pattern matches markAsRead's "optimistic update then revert" approach
      setSendError(null);
      setSending(true);

      try {
        await api.mail.send(request);
        if (mountedRef.current) {
          // Refresh messages after successful send
          await fetchMessages();
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setSendError(error);
        throw error;
      } finally {
        setSending(false);
      }
    },
    [fetchMessages]
  );

  // Mark message as read with optimistic update
  const markAsRead = useCallback(async (messageId: string) => {
    // Optimistically update the message
    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, read: true } : msg))
    );

    try {
      await api.mail.markRead(messageId);
    } catch (err) {
      // Revert on error
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, read: false } : msg
        )
      );
      throw err;
    }
  }, []);

  // Select message and fetch full details
  const selectMessage = useCallback(
    async (messageId: string) => {
      // Clear previous error and set loading state before async operation
      setSelectedError(null);
      setSelectedLoading(true);

      try {
        const fullMessage = await api.mail.get(messageId);
        if (mountedRef.current) {
          setSelectedMessage(fullMessage);

          // Check if message is unread in our local list and mark as read
          const localMessage = messages.find((m) => m.id === messageId);
          if (localMessage && !localMessage.read) {
            // Fire and forget - don't block on this
            void markAsRead(messageId);
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setSelectedError(error);
        throw error;
      } finally {
        setSelectedLoading(false);
      }
    },
    [messages, markAsRead]
  );

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedMessage(null);
    setSelectedError(null);
  }, []);

  // Compute unread count
  const unreadCount = useMemo(
    () => messages.filter((msg) => !msg.read).length,
    [messages]
  );

  return {
    messages,
    total,
    hasMore,
    loading,
    error,
    refresh,
    sendMessage,
    sending,
    sendError,
    clearSendError,
    markAsRead,
    selectedMessage,
    selectedLoading,
    selectedError,
    selectMessage,
    clearSelection,
    unreadCount,
  };
}
