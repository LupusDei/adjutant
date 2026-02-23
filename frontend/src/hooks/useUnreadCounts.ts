/**
 * useUnreadCounts - Hook for tracking unread message counts per agent.
 *
 * Fetches initial counts from GET /api/messages/unread, then subscribes
 * to WebSocket chat_message events to increment counts in real-time.
 * Provides markRead to clear counts when a conversation is opened.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import { useCommunication, type IncomingChatMessage } from '../contexts/CommunicationContext';

export interface UseUnreadCountsResult {
  /** Map of agentId -> unread count */
  counts: Map<string, number>;
  /** Total unread across all agents */
  totalUnread: number;
  /** Whether initial fetch is in progress */
  isLoading: boolean;
  /** Fetch error */
  error: Error | null;
  /** Mark all messages from an agent as read, resetting their count */
  markRead: (agentId: string) => Promise<void>;
  /** Increment count for an agent (used internally by WS subscription) */
  incrementCount: (agentId: string) => void;
}

export function useUnreadCounts(): UseUnreadCountsResult {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const { subscribe } = useCommunication();

  // Fetch initial unread counts from API
  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);

    void (async () => {
      try {
        const result = await api.messages.getUnread();
        if (mountedRef.current) {
          const map = new Map<string, number>();
          for (const item of result.counts) {
            if (item.count > 0) {
              map.set(item.agentId, item.count);
            }
          }
          setCounts(map);
          setIsLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Subscribe to real-time messages to increment counts
  useEffect(() => {
    const unsubscribe = subscribe((incoming: IncomingChatMessage) => {
      // Only count messages from agents (not from user)
      if (incoming.from === 'user') return;

      setCounts((prev) => {
        const next = new Map(prev);
        const agentId = incoming.from;
        next.set(agentId, (prev.get(agentId) ?? 0) + 1);
        return next;
      });
    });

    return unsubscribe;
  }, [subscribe]);

  // Mark all messages from an agent as read
  const markRead = useCallback(async (agentId: string) => {
    // Optimistically clear the count
    setCounts((prev) => {
      if (!prev.has(agentId)) return prev;
      const next = new Map(prev);
      next.delete(agentId);
      return next;
    });

    try {
      await api.messages.markAllRead(agentId);
    } catch {
      // Silently fail - the count will be corrected on next fetch
    }
  }, []);

  // Manual increment (for external callers)
  const incrementCount = useCallback((agentId: string) => {
    setCounts((prev) => {
      const next = new Map(prev);
      next.set(agentId, (prev.get(agentId) ?? 0) + 1);
      return next;
    });
  }, []);

  // Compute total
  let totalUnread = 0;
  for (const count of counts.values()) {
    totalUnread += count;
  }

  return {
    counts,
    totalUnread,
    isLoading,
    error,
    markRead,
    incrementCount,
  };
}
