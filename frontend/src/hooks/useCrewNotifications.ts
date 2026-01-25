/**
 * useCrewNotifications Hook
 * Monitors for new mail from crew members and provides notification state.
 * Complements useOverseerNotifications by tracking crew-specific messages.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '../services/api';
import type { Message, CrewMember } from '../types';
import { isCrewMessage } from './useCrewMessaging';

export interface CrewNotificationInfo {
  /** The message */
  message: Message;
  /** Sender name extracted from address */
  senderName: string;
  /** Sender type (polecat, witness, etc.) */
  senderType: CrewMember['type'] | null;
}

export interface UseCrewNotificationsOptions {
  /** Poll interval in milliseconds (default: 30000) */
  pollInterval?: number;
  /** Whether polling is enabled (default: true) */
  enabled?: boolean;
  /** Callback when new crew message arrives */
  onNewCrewMessage?: (info: CrewNotificationInfo) => void;
}

export interface UseCrewNotificationsReturn {
  /** Unread crew messages */
  unreadCrewMessages: Message[];
  /** Count of unread crew messages */
  unreadCount: number;
  /** Most recent unread crew message */
  latestMessage: Message | null;
  /** Whether currently loading */
  loading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Manually refresh */
  refresh: () => Promise<void>;
  /** Mark a message as read */
  markAsRead: (messageId: string) => Promise<void>;
}

const DEFAULT_POLL_INTERVAL = 30000; // 30 seconds

/**
 * Extract sender name from message address.
 * Examples:
 *   "greenplace/Toast" -> "Toast"
 *   "greenplace/witness" -> "witness"
 *   "mayor/" -> "mayor"
 */
function extractSenderName(address: string): string {
  const parts = address.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] ?? address;
}

/**
 * Guess sender type from address pattern.
 */
function guessSenderType(address: string): CrewMember['type'] | null {
  const lower = address.toLowerCase();
  if (lower.includes('mayor')) return 'mayor';
  if (lower.includes('deacon')) return 'deacon';
  if (lower.includes('witness')) return 'witness';
  if (lower.includes('refinery')) return 'refinery';
  if (lower.includes('/crew/')) return 'crew';
  // Default to polecat for rig/name pattern
  if (/^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(lower)) return 'polecat';
  return null;
}

/**
 * Hook for monitoring crew message notifications.
 *
 * @example
 * ```tsx
 * const { unreadCount, latestMessage } = useCrewNotifications({
 *   onNewCrewMessage: (info) => console.log('New from:', info.senderName),
 * });
 * ```
 */
export function useCrewNotifications(
  options: UseCrewNotificationsOptions = {}
): UseCrewNotificationsReturn {
  const {
    pollInterval = DEFAULT_POLL_INTERVAL,
    enabled = true,
    onNewCrewMessage,
  } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Track seen message IDs for new message detection
  const seenMessageIdsRef = useRef(new Set<string>());
  const isInitialFetchRef = useRef(true);
  const mountedRef = useRef(true);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!mountedRef.current) return;

    try {
      const response = await api.mail.list({ all: true });

      if (!mountedRef.current) return;

      // Filter for crew messages
      const crewMessages = response.items.filter((msg) =>
        isCrewMessage(msg.from, msg.to)
      );

      // Detect new unread messages
      if (!isInitialFetchRef.current && onNewCrewMessage) {
        for (const msg of crewMessages) {
          if (!msg.read && !seenMessageIdsRef.current.has(msg.id)) {
            onNewCrewMessage({
              message: msg,
              senderName: extractSenderName(msg.from),
              senderType: guessSenderType(msg.from),
            });
          }
        }
      }

      // Update seen IDs
      seenMessageIdsRef.current = new Set(response.items.map((m) => m.id));
      isInitialFetchRef.current = false;

      setMessages(crewMessages);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }
  }, [onNewCrewMessage]);

  // Initial fetch and polling
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    void fetchMessages();

    const intervalId = setInterval(() => {
      void fetchMessages();
    }, pollInterval);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [enabled, pollInterval, fetchMessages]);

  // Mark message as read
  const markAsRead = useCallback(async (messageId: string) => {
    // Optimistic update
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

  // Computed values
  const unreadCrewMessages = useMemo(
    () => messages.filter((msg) => !msg.read),
    [messages]
  );

  const unreadCount = unreadCrewMessages.length;

  const latestMessage = useMemo(() => {
    if (unreadCrewMessages.length === 0) return null;
    return unreadCrewMessages.reduce((latest, msg) =>
      new Date(msg.timestamp).getTime() > new Date(latest.timestamp).getTime()
        ? msg
        : latest
    );
  }, [unreadCrewMessages]);

  return {
    unreadCrewMessages,
    unreadCount,
    latestMessage,
    loading,
    error,
    refresh: fetchMessages,
    markAsRead,
  };
}

export default useCrewNotifications;
