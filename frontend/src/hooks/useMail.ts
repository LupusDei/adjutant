/**
 * useMail hook for mail operations.
 *
 * Provides state management for fetching, sending, and managing mail messages
 * with polling support and optimistic updates.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "../services/api";
import type { Message, SendMessageRequest } from "../types";

/** Message with thread count for grouped display */
export interface GroupedMessage extends Message {
  /** Number of messages in this thread */
  threadCount: number;
}

/** Notification info for new messages */
export interface NewMessageNotification {
  id: string;
  subject: string;
  from: string;
  priority: number;
}

/** Options for the useMail hook. */
export interface UseMailOptions {
  /** Polling interval in milliseconds. Default: 60000 (1 minute) */
  pollInterval?: number;
  /** Whether polling is enabled. Default: true */
  enabled?: boolean;
  /** Callback when new unread messages arrive (for audio notifications) - T044 */
  onNewMessage?: (notification: NewMessageNotification) => void;
  /** Enable overseer view filter (shows only mayor/overseer related messages) */
  overseerView?: boolean;
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
  /** All messages in the same thread as selected message, sorted by timestamp */
  threadMessages: Message[];
  /** Messages grouped by thread (one entry per thread with count) */
  groupedMessages: GroupedMessage[];
}

const DEFAULT_POLL_INTERVAL = 60000;

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
/**
 * Check if a message is relevant to the overseer.
 * Matches messages where from/to contains "mayor" or "overseer".
 */
function isOverseerRelevant(msg: Message): boolean {
  const fromLower = msg.from.toLowerCase();
  const toLower = msg.to.toLowerCase();
  return (
    fromLower.includes('mayor') ||
    fromLower.includes('overseer') ||
    toLower.includes('mayor') ||
    toLower.includes('overseer')
  );
}

export function useMail(options: UseMailOptions = {}): UseMailResult {
  const { pollInterval = DEFAULT_POLL_INTERVAL, enabled = true, onNewMessage, overseerView = false } = options;

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

  // Track seen message IDs for new message detection - T044
  const seenMessageIdsRef = useRef(new Set<string>());
  const isInitialFetchRef = useRef(true);

  // Fetch messages from API with optional retry logic
  const fetchMessages = useCallback(async (retries = 0, retryDelay = 1000) => {
    if (!mountedRef.current) return;

    setLoading(true);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await api.mail.list({ all: true });
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
        if (mountedRef.current) {
          // T044: Detect new unread messages for audio notifications
          if (!isInitialFetchRef.current && onNewMessage) {
            for (const msg of response.items) {
              if (!msg.read && !seenMessageIdsRef.current.has(msg.id)) {
                onNewMessage({
                  id: msg.id,
                  subject: msg.subject,
                  from: msg.from,
                  priority: msg.priority,
                });
              }
            }
          }

          // Update seen IDs
          seenMessageIdsRef.current = new Set(response.items.map((m) => m.id));
          isInitialFetchRef.current = false;

          setMessages(response.items);
          setTotal(response.total);
          setHasMore(response.hasMore);
          setError(null);
          setLoading(false);
        }
        return; // Success - exit early
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // If we have retries left and component is still mounted, wait and retry
        if (attempt < retries && mountedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
        }
      }
    }

    // All retries exhausted - set error state
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
    if (mountedRef.current) {
      setError(lastError);
      setLoading(false);
    }
  }, [onNewMessage]);

  // Initial fetch and polling
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    // Initial fetch with retries (backend may not be ready immediately)
    void fetchMessages(3, 1000);

    // Set up polling (no retries needed for background refresh)
    const intervalId = setInterval(() => {
      void fetchMessages(0);
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

  // Apply overseer filter if enabled
  const filteredMessages = useMemo(
    () => (overseerView ? messages.filter(isOverseerRelevant) : messages),
    [messages, overseerView]
  );

  // Compute unread count (respects overseer filter)
  const unreadCount = useMemo(
    () => filteredMessages.filter((msg) => !msg.read).length,
    [filteredMessages]
  );

  // Compute thread messages for selected message
  const threadMessages = useMemo(() => {
    if (!selectedMessage?.threadId) return [];
    return messages
      .filter((msg) => msg.threadId === selectedMessage.threadId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, selectedMessage?.threadId]);

  // Group messages by thread, showing only the most recent message per thread
  // Uses filteredMessages to respect overseer filter
  const groupedMessages = useMemo((): GroupedMessage[] => {
    const threadMap = new Map<string, { messages: Message[]; latest: Message }>();

    for (const msg of filteredMessages) {
      const existing = threadMap.get(msg.threadId);
      if (existing) {
        existing.messages.push(msg);
        // Keep the most recent message
        if (new Date(msg.timestamp).getTime() > new Date(existing.latest.timestamp).getTime()) {
          existing.latest = msg;
        }
      } else {
        threadMap.set(msg.threadId, { messages: [msg], latest: msg });
      }
    }

    // Convert to array of GroupedMessage, sorted by latest timestamp descending
    return Array.from(threadMap.values())
      .map(({ messages: threadMsgs, latest }) => ({
        ...latest,
        threadCount: threadMsgs.length,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [filteredMessages]);

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
    threadMessages,
    groupedMessages,
  };
}
