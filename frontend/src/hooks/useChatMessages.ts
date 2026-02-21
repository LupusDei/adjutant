/**
 * useChatMessages - Hook for persistent chat messages from the SQLite message store.
 *
 * Fetches messages via REST and subscribes to WebSocket events for real-time updates.
 * Supports pagination, optimistic sending with delivery confirmation, and marking
 * messages as read.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import type { ChatMessage } from '../types';
import { useCommunication, type IncomingChatMessage } from '../contexts/CommunicationContext';

/** Delivery status used for optimistic UI on outgoing messages */
export type OptimisticStatus = 'sending' | 'delivered' | 'failed';

/** A ChatMessage extended with optional client-side tracking fields */
export interface DisplayMessage extends ChatMessage {
  /** Client-generated ID for matching delivery confirmations */
  clientId?: string | undefined;
  /** Optimistic delivery status (undefined = server-confirmed) */
  optimisticStatus?: OptimisticStatus | undefined;
}

export interface UseChatMessagesResult {
  messages: DisplayMessage[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  /** Send a message via HTTP. Adds it optimistically and confirms on API response. */
  sendMessage: (body: string, threadId?: string) => Promise<void>;
  /** Add an optimistic message without sending via HTTP (for WebSocket sends). */
  addOptimistic: (body: string, clientId: string) => void;
  /** Confirm delivery of an optimistic message by clientId */
  confirmDelivery: (clientId: string, messageId: string) => void;
  /** Mark a sent message as failed by clientId */
  markFailed: (clientId: string) => void;
  markRead: (messageId: string) => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useChatMessages(agentId?: string): UseChatMessagesResult {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const mountedRef = useRef(true);
  const { subscribe } = useCommunication();

  // Fetch messages from REST API
  const fetchMessages = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params: Parameters<typeof api.messages.list>[0] = {};
      if (agentId) params.agentId = agentId;
      const response = await api.messages.list(params);

      if (mountedRef.current) {
        setMessages((prev) => {
          // Preserve any optimistic messages that haven't been confirmed yet
          const optimistic = prev.filter((m) => m.optimisticStatus === 'sending');
          const serverIds = new Set(response.items.map((m) => m.id));
          const unresolvedOptimistic = optimistic.filter(
            (m) => !serverIds.has(m.id) && !(m.clientId && response.items.some((s) => s.id === m.clientId))
          );
          return [...response.items, ...unresolvedOptimistic];
        });
        setHasMore(response.hasMore);
        setIsLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    }
  }, [agentId]);

  // Initial fetch and refetch when agentId changes
  useEffect(() => {
    mountedRef.current = true;
    void fetchMessages();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchMessages]);

  // Subscribe to real-time messages, filtered by agent scope
  useEffect(() => {
    const unsubscribe = subscribe((incoming: IncomingChatMessage) => {
      // Filter by agent scope: only accept messages to/from the selected agent
      if (agentId && incoming.from !== agentId && incoming.to !== agentId) return;

      // Convert to ChatMessage shape and append, deduplicating by ID
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;

        const newMsg: DisplayMessage = {
          id: incoming.id,
          sessionId: null,
          agentId: incoming.from,
          recipient: incoming.to,
          role: 'agent',
          body: incoming.body,
          metadata: null,
          deliveryStatus: 'delivered',
          eventType: null,
          threadId: null,
          createdAt: incoming.timestamp,
          updatedAt: incoming.timestamp,
        };

        return [...prev, newMsg];
      });
    });

    return unsubscribe;
  }, [subscribe, agentId]);

  // Send a message with optimistic UI
  const sendMessage = useCallback(
    async (body: string, threadId?: string) => {
      const clientId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Add optimistic message immediately
      const optimisticMsg: DisplayMessage = {
        id: `optimistic-${clientId}`,
        clientId,
        sessionId: null,
        agentId: 'user',
        recipient: agentId ?? 'user',
        role: 'user',
        body,
        metadata: null,
        deliveryStatus: 'pending',
        optimisticStatus: 'sending',
        eventType: null,
        threadId: threadId ?? null,
        createdAt: now,
        updatedAt: now,
      };

      setMessages((prev) => [...prev, optimisticMsg]);

      try {
        const params: Parameters<typeof api.messages.send>[0] = {
          to: agentId ?? 'user',
          body,
        };
        if (threadId) params.threadId = threadId;
        const result = await api.messages.send(params);

        // Update optimistic message with server ID and delivered status
        if (mountedRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.clientId === clientId
                ? {
                    ...m,
                    id: result.messageId,
                    deliveryStatus: 'delivered',
                    optimisticStatus: 'delivered' as const,
                    updatedAt: result.timestamp,
                  }
                : m,
            ),
          );
        }
      } catch (err) {
        // Mark optimistic message as failed
        if (mountedRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.clientId === clientId
                ? { ...m, deliveryStatus: 'failed', optimisticStatus: 'failed' as const }
                : m,
            ),
          );
        }
        throw err;
      }
    },
    [agentId],
  );

  // Add an optimistic message without sending via HTTP (for WebSocket sends)
  const addOptimistic = useCallback(
    (body: string, clientId: string) => {
      const now = new Date().toISOString();
      const optimisticMsg: DisplayMessage = {
        id: `optimistic-${clientId}`,
        clientId,
        sessionId: null,
        agentId: 'user',
        recipient: agentId ?? 'user',
        role: 'user',
        body,
        metadata: null,
        deliveryStatus: 'pending',
        optimisticStatus: 'sending',
        eventType: null,
        threadId: null,
        createdAt: now,
        updatedAt: now,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
    },
    [agentId],
  );

  // Confirm delivery of a message sent via WebSocket
  const confirmDelivery = useCallback((clientId: string, messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.clientId === clientId
          ? { ...m, id: messageId, deliveryStatus: 'delivered', optimisticStatus: 'delivered' as const }
          : m,
      ),
    );
  }, []);

  // Mark a sent message as failed (e.g., WebSocket send failed)
  const markFailed = useCallback((clientId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.clientId === clientId
          ? { ...m, deliveryStatus: 'failed', optimisticStatus: 'failed' as const }
          : m,
      ),
    );
  }, []);

  // Mark a message as read
  const markRead = useCallback(async (messageId: string) => {
    await api.messages.markRead(messageId);
  }, []);

  // Load older messages (pagination)
  const loadMore = useCallback(async () => {
    if (!hasMore || messages.length === 0) return;

    // Find the oldest message by createdAt for correct cursor pagination
    const oldestMessage = messages.reduce((oldest, m) =>
      m.createdAt < oldest.createdAt ? m : oldest
    );

    try {
      const params: Parameters<typeof api.messages.list>[0] = {
        before: oldestMessage.createdAt,
        beforeId: oldestMessage.id,
      };
      if (agentId) params.agentId = agentId;
      const response = await api.messages.list(params);

      if (mountedRef.current) {
        setMessages((prev) => {
          // Deduplicate
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = response.items.filter((m) => !existingIds.has(m.id));
          return [...newMsgs, ...prev];
        });
        setHasMore(response.hasMore);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, [agentId, hasMore, messages]);

  return {
    messages,
    isLoading,
    error,
    hasMore,
    sendMessage,
    addOptimistic,
    confirmDelivery,
    markFailed,
    markRead,
    loadMore,
  };
}
