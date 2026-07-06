/**
 * useChatMessages - Hook for persistent chat messages from the SQLite message store.
 *
 * Fetches messages via REST and subscribes to WebSocket events for real-time updates.
 * Supports pagination, optimistic sending with delivery confirmation, and marking
 * messages as read.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import type { ChatMessage, MessageAttachment } from '../types';
import { useCommunicationActions, type IncomingChatMessage } from '../contexts/CommunicationContext';

/** Options for {@link UseChatMessagesResult.sendMessage} (adj-203). */
export interface SendMessageOptions {
  /** Optional thread id for the outgoing message. */
  threadId?: string;
  /** Ids of previously-uploaded image attachments to link to the message. */
  attachmentIds?: string[];
  /**
   * Attachment metadata to show on the optimistic bubble immediately (before
   * the persisted message — with its hydrated attachments — arrives on refetch).
   */
  attachments?: MessageAttachment[];
}

/**
 * The agent the default (no-agent-selected) chat view maps to (adj-ropat).
 *
 * Pre-overhaul, the "AGENTS" view aggregated coordinator messages. The
 * conversation model retired that aggregation, which left the default view
 * resolving to a dead `user↔user` conversation: permanently empty, with sends
 * routed nowhere visible. Mapping the default to a real DM with the coordinator
 * restores a live surface — the view is never empty and sends reach the
 * coordinator.
 */
export const DEFAULT_COORDINATOR_AGENT_ID = 'adjutant-coordinator';

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
  /**
   * The resolved DM conversation id for the open agent (null until resolved or
   * when no agent is selected). Consumers pass this to `useChatWebSocket` to
   * scope real-time delivery to this conversation.
   */
  conversationId: string | null;
  /** Send a message via HTTP. Adds it optimistically and confirms on API response. */
  sendMessage: (body: string, opts?: SendMessageOptions) => Promise<void>;
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
  // adj-ropat: an undefined agentId is the default view. Map it to the
  // coordinator so the conversation is a real, live DM rather than an empty
  // user↔user surface. Every read/write/real-time path below scopes on this
  // single resolved id.
  const effectiveAgentId = agentId ?? DEFAULT_COORDINATOR_AGENT_ID;

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // The resolved DM conversation id for the open agent. This is the single key
  // every read/write/real-time path scopes on — the root-cause bleed fix.
  const [conversationId, setConversationId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // Mirror the resolved conversation id into a ref so the WS subscription can
  // read the current value without re-subscribing (and without staleness).
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;
  const { subscribe } = useCommunicationActions();

  // Resolve the DM conversation for the agent, then fetch ONLY that
  // conversation's messages. There is no agent/recipient widening here — the
  // legacy fragile path is retired (adj-164.2).
  const fetchMessages = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const conversation = await api.conversations.getDm(effectiveAgentId);
      if (!mountedRef.current) return;
      setConversationId(conversation.id);

      const response = await api.conversations.listMessages(conversation.id, {});

      if (mountedRef.current) {
        setMessages((prev) => {
          // Preserve any optimistic messages that haven't been confirmed yet
          // AND belong to this conversation (so a stale optimistic from a
          // previous agent never bleeds across a switch).
          const optimistic = prev.filter(
            (m) =>
              m.optimisticStatus === 'sending' &&
              m.conversationId === conversation.id,
          );
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
  }, [effectiveAgentId]);

  // Initial fetch and refetch when agentId changes. Clear stale state up front
  // so a switch never momentarily shows the previous agent's messages.
  useEffect(() => {
    mountedRef.current = true;
    setMessages([]);
    setConversationId(null);
    void fetchMessages();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchMessages]);

  // Subscribe to real-time messages, scoped strictly by conversation id.
  // An incoming message is applied ONLY when its conversationId matches the
  // open conversation — this is the WS half of the bleed fix.
  useEffect(() => {
    const unsubscribe = subscribe((incoming: IncomingChatMessage) => {
      const openConversationId = conversationIdRef.current;
      // No open conversation, or the message belongs to a different one → drop.
      if (!openConversationId) return;
      if (incoming.conversationId !== openConversationId) return;

      // Skip user's own messages — they are already in state as optimistic entries.
      // The backend broadcasts all messages via WebSocket (including ones the user
      // just sent via HTTP POST), which would cause duplicates without this guard.
      if (incoming.from === 'user') return;

      // Convert to ChatMessage shape and append, deduplicating by server ID
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
          conversationId: incoming.conversationId ?? openConversationId,
          createdAt: incoming.timestamp,
          updatedAt: incoming.timestamp,
        };

        return [...prev, newMsg];
      });
    });

    return unsubscribe;
  }, [subscribe]);

  // Send a message with optimistic UI
  const sendMessage = useCallback(
    async (body: string, opts?: SendMessageOptions) => {
      const threadId = opts?.threadId;
      const clientId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Add optimistic message immediately, tagged with the open conversation
      // so it is preserved across re-fetches and never bleeds into another DM.
      const optimisticMsg: DisplayMessage = {
        id: `optimistic-${clientId}`,
        clientId,
        sessionId: null,
        agentId: 'user',
        recipient: effectiveAgentId,
        role: 'user',
        body,
        ...(opts?.attachments ? { attachments: opts.attachments } : {}),
        metadata: null,
        deliveryStatus: 'pending',
        optimisticStatus: 'sending',
        eventType: null,
        threadId: threadId ?? null,
        conversationId: conversationIdRef.current,
        createdAt: now,
        updatedAt: now,
      };

      setMessages((prev) => [...prev, optimisticMsg]);

      try {
        const params: Parameters<typeof api.messages.send>[0] = {
          to: effectiveAgentId,
          body,
        };
        if (threadId) params.threadId = threadId;
        if (opts?.attachmentIds && opts.attachmentIds.length > 0) {
          params.attachmentIds = opts.attachmentIds;
        }
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
    [effectiveAgentId],
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
        recipient: effectiveAgentId,
        role: 'user',
        body,
        metadata: null,
        deliveryStatus: 'pending',
        optimisticStatus: 'sending',
        eventType: null,
        threadId: null,
        conversationId: conversationIdRef.current,
        createdAt: now,
        updatedAt: now,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
    },
    [effectiveAgentId],
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

  // Load older messages (pagination) — scoped to the open conversation.
  const loadMore = useCallback(async () => {
    const currentConversationId = conversationIdRef.current;
    if (!hasMore || messages.length === 0 || !currentConversationId) return;

    // Find the oldest message by createdAt for correct cursor pagination
    const oldestMessage = messages.reduce((oldest, m) =>
      m.createdAt < oldest.createdAt ? m : oldest
    );

    try {
      const response = await api.conversations.listMessages(currentConversationId, {
        before: oldestMessage.createdAt,
        beforeId: oldestMessage.id,
      });

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
  }, [hasMore, messages]);

  return {
    messages,
    isLoading,
    error,
    hasMore,
    conversationId,
    sendMessage,
    addOptimistic,
    confirmDelivery,
    markFailed,
    markRead,
    loadMore,
  };
}
