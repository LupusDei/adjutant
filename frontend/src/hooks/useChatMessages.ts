/**
 * useChatMessages - Hook for persistent chat messages from the SQLite message store.
 *
 * Fetches messages via REST and subscribes to WebSocket events for real-time updates.
 * Supports pagination, sending, and marking messages as read.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import type { ChatMessage } from '../types';
import { useCommunication, type IncomingChatMessage } from '../contexts/CommunicationContext';

export interface UseChatMessagesResult {
  messages: ChatMessage[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  sendMessage: (body: string, threadId?: string) => Promise<void>;
  markRead: (messageId: string) => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useChatMessages(agentId?: string): UseChatMessagesResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
        setMessages(response.items);
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

  // Subscribe to real-time messages
  useEffect(() => {
    const unsubscribe = subscribe((incoming: IncomingChatMessage) => {
      // Convert to ChatMessage shape and append, deduplicating by ID
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;

        const newMsg: ChatMessage = {
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
  }, [subscribe]);

  // Send a message
  const sendMessage = useCallback(
    async (body: string, threadId?: string) => {
      const params: Parameters<typeof api.messages.send>[0] = {
        to: agentId ?? 'user',
        body,
      };
      if (threadId) params.threadId = threadId;
      await api.messages.send(params);

      // Refetch to see the sent message
      if (mountedRef.current) {
        await fetchMessages();
      }
    },
    [agentId, fetchMessages]
  );

  // Mark a message as read
  const markRead = useCallback(async (messageId: string) => {
    await api.messages.markRead(messageId);
  }, []);

  // Load older messages (pagination)
  const loadMore = useCallback(async () => {
    if (!hasMore || messages.length === 0) return;

    const oldestMessage = messages[0];
    if (!oldestMessage) return;

    try {
      const params: Parameters<typeof api.messages.list>[0] = {
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
    markRead,
    loadMore,
  };
}
