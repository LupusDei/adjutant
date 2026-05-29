import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import type { CommunicationPriority, ConnectionStatus } from '../types';
import { getApiKey, api } from '../services/api';

// ============================================================================
// Types
// ============================================================================

/** An incoming chat message received via WebSocket or SSE. */
export interface IncomingChatMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  timestamp: string;
  seq?: number;
  /**
   * Stable conversation id (adj-164). Consumers scope real-time delivery by
   * this field so a message never bleeds into the wrong open conversation.
   */
  conversationId?: string;
}

/** An incoming timeline event received via WebSocket. */
export interface IncomingTimelineEvent {
  id: string;
  eventType: string;
  agentId: string;
  action: string;
  detail: Record<string, unknown> | null;
  beadId?: string;
  messageId?: string;
  createdAt: string;
}

/** Options for sending a chat message. */
export interface SendMessageOptions {
  to?: string;
  body: string;
  replyTo?: string;
}

type MessageHandler = (msg: IncomingChatMessage) => void;
type TimelineEventHandler = (event: IncomingTimelineEvent) => void;

/** Shape of a parsed WebSocket server message. */
interface WsServerMsg {
  type: string;
  id?: string;
  from?: string;
  to?: string;
  body?: string;
  timestamp?: string;
  seq?: number;
  conversationId?: string;
  code?: string;
  sessionId?: string;
  lastSeq?: number;
  serverTime?: string;
  // sync_response carries an array of missed chat_messages
  missed?: WsServerMsg[];
  // Timeline event fields
  eventType?: string;
  agentId?: string;
  action?: string;
  detail?: Record<string, unknown> | null;
  beadId?: string;
  messageId?: string;
  createdAt?: string;
}

/**
 * Stable actions for sending messages and subscribing to incoming streams.
 *
 * Consumers of this context will NOT re-render on connection status changes,
 * because all members are stable callbacks defined once on mount.
 */
export interface CommunicationActionsContextValue {
  /** Send a chat message via WebSocket (falls back to HTTP POST /api/messages) */
  sendMessage: (opts: SendMessageOptions) => Promise<void>;
  /** Subscribe to incoming chat messages. Returns an unsubscribe function. */
  subscribe: (callback: MessageHandler) => () => void;
  /** Subscribe to incoming timeline events. Returns an unsubscribe function. */
  subscribeTimeline: (callback: TimelineEventHandler) => () => void;
}

/**
 * Volatile connection-status and priority state.
 *
 * Consumers of this context re-render on every status flip — keep usage
 * narrow (e.g. the status indicator and the priority selector only).
 */
export interface CommunicationStatusContextValue {
  /** Current communication priority */
  priority: CommunicationPriority;
  /** Set the communication priority */
  setPriority: (priority: CommunicationPriority) => void;
  /** Current connection status */
  connectionStatus: ConnectionStatus;
}

/**
 * Combined value, retained for backward compatibility with `useCommunication()`.
 */
export interface CommunicationContextValue
  extends CommunicationActionsContextValue,
    CommunicationStatusContextValue {}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'adjutant-comm-priority';
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_WS_RETRIES = 5;
const MAX_SSE_RETRIES = 3;
/**
 * Dev-mode threshold for the subscriber-Set leak diagnostic. If either
 * subscribersRef or timelineSubscribersRef grows past this many entries,
 * `subscribe()` / `subscribeTimeline()` emit a console.warn pointing at
 * a likely missing unsubscribe call. No effect in production builds.
 */
const SUBSCRIBER_LEAK_THRESHOLD = 50;

// ============================================================================
// Contexts
// ============================================================================

const CommunicationActionsContext = createContext<CommunicationActionsContextValue | null>(null);
const CommunicationStatusContext = createContext<CommunicationStatusContextValue | null>(null);

/**
 * Provider component for communication state.
 *
 * Manages real WebSocket and SSE connections based on the user's priority
 * preference, with automatic reconnection and fallback:
 *   real-time  → WebSocket /ws/chat (falls back to SSE after retries)
 *   efficient  → EventSource /api/events (falls back to polling after retries)
 *   polling    → No persistent connection
 *
 * Exposes two contexts:
 *   - CommunicationActionsContext (stable callbacks)
 *   - CommunicationStatusContext (volatile status/priority)
 */
export function CommunicationProvider({ children }: { children: ReactNode }) {
  // ---------------------------------------------------------------------------
  // Priority state (persisted to localStorage)
  // ---------------------------------------------------------------------------
  const [priority, setPriorityState] = useState<CommunicationPriority>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ['real-time', 'efficient', 'polling-only'].includes(stored)) {
        return stored as CommunicationPriority;
      }
    } catch {
      // Ignore storage errors
    }
    return 'real-time';
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // ---------------------------------------------------------------------------
  // Refs for connection state (not reactive — avoids re-render churn)
  // ---------------------------------------------------------------------------
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const subscribersRef = useRef<Set<MessageHandler>>(new Set());
  const timelineSubscribersRef = useRef<Set<TimelineEventHandler>>(new Set());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  /**
   * Highest `seq` we've already dispatched to subscribers. Updated when:
   *   - the server's `connected` frame announces its current `lastSeq`
   *   - we deliver a `chat_message` with a higher `seq`
   * Messages with `seq <= lastProcessedSeqRef.current` are dropped to
   * eliminate duplicates from replay buffer / reconnect storms.
   */
  const lastProcessedSeqRef = useRef<number>(0);

  // ---------------------------------------------------------------------------
  // Subscriber management
  // ---------------------------------------------------------------------------
  const notify = useCallback((msg: IncomingChatMessage) => {
    for (const cb of subscribersRef.current) {
      try { cb(msg); } catch { /* ignore subscriber errors */ }
    }
  }, []);

  const notifyTimeline = useCallback((event: IncomingTimelineEvent) => {
    for (const cb of timelineSubscribersRef.current) {
      try { cb(event); } catch { /* ignore subscriber errors */ }
    }
  }, []);

  const subscribe = useCallback((callback: MessageHandler) => {
    subscribersRef.current.add(callback);
    if (import.meta.env.DEV && subscribersRef.current.size > SUBSCRIBER_LEAK_THRESHOLD) {
      // eslint-disable-next-line no-console
      console.warn(
        `[CommunicationContext] subscriber Set has grown to ${String(subscribersRef.current.size)} ` +
        "subscribers — possible leak; check for missing unsubscribe calls in hooks/components.",
      );
    }
    return () => { subscribersRef.current.delete(callback); };
  }, []);

  const subscribeTimeline = useCallback((callback: TimelineEventHandler) => {
    timelineSubscribersRef.current.add(callback);
    if (import.meta.env.DEV && timelineSubscribersRef.current.size > SUBSCRIBER_LEAK_THRESHOLD) {
      // eslint-disable-next-line no-console
      console.warn(
        `[CommunicationContext] timeline subscriber Set has grown to ${String(timelineSubscribersRef.current.size)} ` +
        "subscribers — possible leak; check for missing unsubscribe calls in hooks/components.",
      );
    }
    return () => { timelineSubscribersRef.current.delete(callback); };
  }, []);

  // ---------------------------------------------------------------------------
  // Priority setter (persists to localStorage)
  // ---------------------------------------------------------------------------
  const setPriority = useCallback((newPriority: CommunicationPriority) => {
    setPriorityState(newPriority);
    try {
      localStorage.setItem(STORAGE_KEY, newPriority);
    } catch {
      // Ignore storage errors
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Connection lifecycle (single effect driven by priority)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    reconnectAttemptsRef.current = 0;

    /**
     * Map each EventSource to the handler it registered for 'connected' so
     * we can remove the listener before `close()`. Without this, anonymous
     * handlers would leak across priority toggles — see closeSse().
     */
    const sseConnectedHandlers = new WeakMap<EventSource, () => void>();

    /**
     * Close an EventSource cleanly. Removes any registered 'connected'
     * listener before close() to prevent listener leaks across reconnects.
     */
    function closeSse(es: EventSource) {
      const handler = sseConnectedHandlers.get(es);
      if (handler) {
        // Some test mocks may lack removeEventListener — guard defensively.
        if (typeof es.removeEventListener === 'function') {
          es.removeEventListener('connected', handler);
        }
        sseConnectedHandlers.delete(es);
      }
      es.close();
    }

    // -- Cleanup helper --
    function teardown() {
      mounted = false;
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (sseRef.current) {
        closeSse(sseRef.current);
        sseRef.current = null;
      }
    }

    // -- SSE connection --
    function startSSE() {
      if (!mounted) return;

      // Mutual exclusion: close any open WebSocket before opening SSE.
      // Defends against future code paths that fall back to SSE without
      // first nulling wsRef (e.g. error handlers, race conditions).
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }

      // Close any prior SSE (removes its 'connected' listener first)
      if (sseRef.current) {
        closeSse(sseRef.current);
        sseRef.current = null;
      }

      let es: EventSource;
      try {
        es = new EventSource('/api/events');
      } catch {
        setConnectionStatus('polling');
        return;
      }

      sseRef.current = es;
      let sseRetries = 0;

      // Named handler so we can remove it before close (prevents leak)
      const handleConnected = () => {
        sseRetries = 0;
        if (mounted) setConnectionStatus('sse');
      };
      es.addEventListener('connected', handleConnected);
      sseConnectedHandlers.set(es, handleConnected);

      es.onerror = () => {
        sseRetries++;
        if (sseRetries > MAX_SSE_RETRIES && mounted) {
          closeSse(es);
          sseRef.current = null;
          setConnectionStatus('polling');
        }
        // EventSource auto-reconnects on transient errors
      };
    }

    // -- WebSocket connection --
    function startWebSocket() {
      if (!mounted) return;

      // Mutual exclusion: close any open SSE before opening WebSocket
      // (uses closeSse so the SSE 'connected' listener is removed first).
      // Defends against startWebSocket being invoked from a reconnect path
      // while an SSE is still alive (defensive belt-and-suspenders).
      if (sseRef.current) {
        closeSse(sseRef.current);
        sseRef.current = null;
      }

      setConnectionStatus('reconnecting');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/chat`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        // WebSocket unavailable (e.g. test environment) — fall back to SSE
        startSSE();
        return;
      }

      wsRef.current = ws;

      ws.onmessage = (event) => {
        let msg: WsServerMsg;
        try {
          msg = JSON.parse(event.data as string) as WsServerMsg;
        } catch { return; }

        switch (msg.type) {
          case 'auth_challenge': {
            const apiKey = getApiKey();
            ws.send(JSON.stringify({
              type: 'auth_response',
              apiKey: apiKey ?? undefined,
            }));
            break;
          }
          case 'connected':
            reconnectAttemptsRef.current = 0;
            // Record the server's current sequence number as our baseline so
            // that older replayed messages can be deduped on reconnect.
            lastProcessedSeqRef.current = msg.lastSeq ?? 0;
            // Send a sync request carrying the highest seq we've processed,
            // so the server can replay only what we missed (see handleSync
            // in ws-server.ts).
            try {
              ws.send(JSON.stringify({
                type: 'sync',
                lastSeqSeen: lastProcessedSeqRef.current,
              }));
            } catch { /* socket may have closed mid-frame */ }
            if (mounted) setConnectionStatus('websocket');
            break;
          case 'chat_message':
            if (msg.id && msg.from && msg.to && msg.body && msg.timestamp) {
              // Dedup: drop any message at or below our watermark.
              if (msg.seq != null && msg.seq <= lastProcessedSeqRef.current) {
                break;
              }
              if (msg.seq != null) {
                lastProcessedSeqRef.current = msg.seq;
              }
              const incoming: IncomingChatMessage = {
                id: msg.id,
                from: msg.from,
                to: msg.to,
                body: msg.body,
                timestamp: msg.timestamp,
              };
              if (msg.seq != null) incoming.seq = msg.seq;
              if (msg.conversationId != null) incoming.conversationId = msg.conversationId;
              notify(incoming);
            }
            break;
          case 'sync_response': {
            // Server replays messages we missed while disconnected.
            // Dedup by seq against the watermark — both for stale messages
            // already delivered and for duplicates within the payload itself.
            const missed = msg.missed ?? [];
            for (const entry of missed) {
              if (entry.type !== 'chat_message') continue;
              if (!entry.id || !entry.from || !entry.to || !entry.body || !entry.timestamp) continue;
              if (entry.seq != null && entry.seq <= lastProcessedSeqRef.current) continue;
              if (entry.seq != null) {
                lastProcessedSeqRef.current = entry.seq;
              }
              const incoming: IncomingChatMessage = {
                id: entry.id,
                from: entry.from,
                to: entry.to,
                body: entry.body,
                timestamp: entry.timestamp,
              };
              if (entry.seq != null) incoming.seq = entry.seq;
              if (entry.conversationId != null) incoming.conversationId = entry.conversationId;
              notify(incoming);
            }
            break;
          }
          case 'timeline_event':
            if (msg.id && msg.eventType && msg.agentId && msg.action && msg.createdAt) {
              notifyTimeline({
                id: msg.id,
                eventType: msg.eventType,
                agentId: msg.agentId,
                action: msg.action,
                detail: msg.detail ?? null,
                beadId: msg.beadId,
                messageId: msg.messageId,
                createdAt: msg.createdAt,
              });
            }
            break;
          case 'error':
            if (msg.code === 'auth_failed' || msg.code === 'auth_timeout') {
              // Auth failure — fall back to SSE rather than retrying
              ws.onclose = null;
              ws.close();
              wsRef.current = null;
              if (mounted) startSSE();
            }
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!mounted) return;

        reconnectAttemptsRef.current++;

        if (reconnectAttemptsRef.current > MAX_WS_RETRIES) {
          // Too many failures — fall back to SSE
          startSSE();
          return;
        }

        // Exponential backoff. Always clear any previous reconnect timer first
        // to avoid stacking timers on rapid disconnects.
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1),
          MAX_RECONNECT_DELAY_MS,
        );
        setConnectionStatus('reconnecting');
        // Always clear any outstanding reconnect timer before scheduling a new
        // one — otherwise rapid onclose firings stack timers and produce a
        // burst of concurrent reconnect attempts.
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(startWebSocket, delay);
      };

      ws.onerror = () => {
        // onclose fires after onerror — reconnection handled there
      };
    }

    // -- Start the appropriate channel --
    switch (priority) {
      case 'real-time':
        startWebSocket();
        break;
      case 'efficient':
        startSSE();
        break;
      case 'polling-only':
        setConnectionStatus('polling');
        break;
    }

    return teardown;
  }, [priority, notify, notifyTimeline]);

  // ---------------------------------------------------------------------------
  // Send message — WebSocket if open, otherwise HTTP fallback
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(async (opts: SendMessageOptions) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'message',
        id: crypto.randomUUID(),
        to: opts.to ?? 'mayor/',
        body: opts.body,
        replyTo: opts.replyTo,
      }));
    } else {
      // HTTP fallback — use persistent messages API
      await api.messages.send({
        to: opts.to ?? 'mayor/',
        body: opts.body,
      });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Context values — actions are stable; status is volatile
  // ---------------------------------------------------------------------------
  const actionsValue = useMemo<CommunicationActionsContextValue>(
    () => ({ sendMessage, subscribe, subscribeTimeline }),
    [sendMessage, subscribe, subscribeTimeline],
  );

  const statusValue = useMemo<CommunicationStatusContextValue>(
    () => ({ priority, setPriority, connectionStatus }),
    [priority, setPriority, connectionStatus],
  );

  return (
    <CommunicationActionsContext.Provider value={actionsValue}>
      <CommunicationStatusContext.Provider value={statusValue}>
        {children}
      </CommunicationStatusContext.Provider>
    </CommunicationActionsContext.Provider>
  );
}

/**
 * Hook to access stable communication actions.
 *
 * Consumers will not re-render when connectionStatus or priority change.
 */
export function useCommunicationActions(): CommunicationActionsContextValue {
  const context = useContext(CommunicationActionsContext);
  if (!context) {
    throw new Error('useCommunicationActions must be used within a CommunicationProvider');
  }
  return context;
}

/**
 * Hook to access volatile communication status (connectionStatus + priority).
 *
 * Consumers re-render every time the connection status flips — keep usage
 * scoped to status indicators / priority selectors only.
 */
export function useCommunicationStatus(): CommunicationStatusContextValue {
  const context = useContext(CommunicationStatusContext);
  if (!context) {
    throw new Error('useCommunicationStatus must be used within a CommunicationProvider');
  }
  return context;
}

/**
 * Legacy combined hook — returns both actions and status.
 *
 * Prefer `useCommunicationActions()` or `useCommunicationStatus()` for new
 * code. This hook re-renders consumers on every status change.
 */
export function useCommunication(): CommunicationContextValue {
  const actions = useContext(CommunicationActionsContext);
  const status = useContext(CommunicationStatusContext);
  if (!actions || !status) {
    throw new Error('useCommunication must be used within a CommunicationProvider');
  }
  return {
    ...actions,
    ...status,
  };
}

export default CommunicationActionsContext;
