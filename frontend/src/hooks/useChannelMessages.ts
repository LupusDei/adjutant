/**
 * useChannelMessages (adj-164.5.3 / 5.4) — the data layer for a single channel
 * room.
 *
 * Mirrors `useChatMessages` but for a `kind='channel'` conversation:
 *  - history is fetched scoped strictly by `channelId` (the conversation id),
 *    reusing `api.conversations.listMessages` (no agent/recipient widening);
 *  - sends go through `api.channels.postMessage` (member-only, room fan-out);
 *  - real-time delivery rides the SHARED CommunicationContext connection — the
 *    SAME pipe DMs use — instead of a separate WS-only socket (adj-83hau). The
 *    hook joins the room via `subscribeConversation` (the explicit opt-in the
 *    backend's `wsBroadcastToConversation` requires; CommunicationContext
 *    re-sends it on reconnect) and applies only incoming messages whose
 *    `conversationId` matches. This inherits the context's WS→SSE→polling
 *    resilience and matches DM real-time behavior exactly.
 *
 * Multi-party attribution is intrinsic: every message keeps its real
 * `agentId`/`role`, so MessageBubble renders each sender's callsign.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import type { DisplayMessage } from './useChatMessages';
import { useCommunicationActions, type IncomingChatMessage } from '../contexts/CommunicationContext';

export interface UseChannelMessagesResult {
  messages: DisplayMessage[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  /** Post a message to the channel as the operator (optimistic). */
  sendMessage: (body: string) => Promise<void>;
  /** Load older messages (cursor pagination). */
  loadMore: () => Promise<void>;
}

export function useChannelMessages(channelId: string | null): UseChannelMessagesResult {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const mountedRef = useRef(true);
  const channelIdRef = useRef<string | null>(channelId);
  channelIdRef.current = channelId;

  const { subscribe, subscribeConversation, unsubscribeConversation } = useCommunicationActions();

  // Fetch the channel's message history, scoped by conversation id.
  const fetchMessages = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!channelId) {
        if (mountedRef.current) {
          setMessages([]);
          setHasMore(false);
          setIsLoading(false);
        }
        return;
      }
      const response = await api.conversations.listMessages(channelId, {});
      if (mountedRef.current) {
        setMessages((prev) => {
          // Preserve unconfirmed optimistic sends that belong to this channel.
          const optimistic = prev.filter(
            (m) => m.optimisticStatus === 'sending' && m.conversationId === channelId,
          );
          const serverIds = new Set(response.items.map((m) => m.id));
          const unresolved = optimistic.filter((m) => !serverIds.has(m.id));
          return [...response.items, ...unresolved];
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
  }, [channelId]);

  useEffect(() => {
    mountedRef.current = true;
    setMessages([]);
    void fetchMessages();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchMessages]);

  // Room-scoped real-time delivery over the SHARED connection (adj-83hau).
  // `subscribeConversation` joins the backend room fan-out (re-sent on reconnect
  // by CommunicationContext); `subscribe` receives every incoming chat message,
  // which we scope to this channel by conversationId. We drop the operator's own
  // messages (already present as optimistic entries) to avoid duplicates — the
  // identical contract `useChatMessages` uses for DMs.
  useEffect(() => {
    if (!channelId) return;
    subscribeConversation(channelId);
    const unsub = subscribe((incoming: IncomingChatMessage) => {
      const open = channelIdRef.current;
      if (!open) return;
      if (incoming.conversationId !== open) return;
      if (incoming.from === 'user') return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;
        const newMsg: DisplayMessage = {
          id: incoming.id,
          sessionId: null,
          agentId: incoming.from,
          recipient: open,
          role: 'agent',
          body: incoming.body,
          metadata: null,
          deliveryStatus: 'delivered',
          eventType: null,
          threadId: null,
          conversationId: open,
          createdAt: incoming.timestamp,
          updatedAt: incoming.timestamp,
        };
        return [...prev, newMsg];
      });
    });
    return () => {
      unsub();
      unsubscribeConversation(channelId);
    };
  }, [channelId, subscribe, subscribeConversation, unsubscribeConversation]);

  const sendMessage = useCallback(
    async (body: string) => {
      const channel = channelIdRef.current;
      if (!channel) return;
      const clientId = crypto.randomUUID();
      const now = new Date().toISOString();
      const optimistic: DisplayMessage = {
        id: `optimistic-${clientId}`,
        clientId,
        sessionId: null,
        agentId: 'user',
        recipient: channel,
        role: 'user',
        body,
        metadata: null,
        deliveryStatus: 'pending',
        optimisticStatus: 'sending',
        eventType: null,
        threadId: null,
        conversationId: channel,
        createdAt: now,
        updatedAt: now,
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const result = await api.channels.postMessage(channel, { body });
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
    [],
  );

  const loadMore = useCallback(async () => {
    const channel = channelIdRef.current;
    if (!hasMore || messages.length === 0 || !channel) return;
    const oldest = messages.reduce((o, m) => (m.createdAt < o.createdAt ? m : o));
    try {
      const response = await api.conversations.listMessages(channel, {
        before: oldest.createdAt,
        beforeId: oldest.id,
      });
      if (mountedRef.current) {
        setMessages((prev) => {
          const existing = new Set(prev.map((m) => m.id));
          const fresh = response.items.filter((m) => !existing.has(m.id));
          return [...fresh, ...prev];
        });
        setHasMore(response.hasMore);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, [hasMore, messages]);

  return { messages, isLoading, error, hasMore, sendMessage, loadMore };
}
