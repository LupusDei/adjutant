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
}

/** Options for sending a chat message. */
export interface SendMessageOptions {
  to?: string;
  body: string;
  replyTo?: string;
}

type MessageHandler = (msg: IncomingChatMessage) => void;

/** Shape of a parsed WebSocket server message. */
interface WsServerMsg {
  type: string;
  id?: string;
  from?: string;
  to?: string;
  body?: string;
  timestamp?: string;
  seq?: number;
  code?: string;
  sessionId?: string;
  lastSeq?: number;
  serverTime?: string;
}

/**
 * Communication state and actions.
 */
export interface CommunicationContextValue {
  /** Current communication priority */
  priority: CommunicationPriority;
  /** Set the communication priority */
  setPriority: (priority: CommunicationPriority) => void;
  /** Current connection status */
  connectionStatus: ConnectionStatus;
  /** Send a chat message via WebSocket (falls back to HTTP POST /api/messages) */
  sendMessage: (opts: SendMessageOptions) => Promise<void>;
  /** Subscribe to incoming chat messages. Returns an unsubscribe function. */
  subscribe: (callback: MessageHandler) => () => void;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'adjutant-comm-priority';
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_WS_RETRIES = 5;
const MAX_SSE_RETRIES = 3;

// ============================================================================
// Context
// ============================================================================

const CommunicationContext = createContext<CommunicationContextValue | null>(null);

/**
 * Provider component for communication state.
 *
 * Manages real WebSocket and SSE connections based on the user's priority
 * preference, with automatic reconnection and fallback:
 *   real-time  → WebSocket /ws/chat (falls back to SSE after retries)
 *   efficient  → EventSource /api/events (falls back to polling after retries)
 *   polling    → No persistent connection
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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Subscriber management
  // ---------------------------------------------------------------------------
  const notify = useCallback((msg: IncomingChatMessage) => {
    for (const cb of subscribersRef.current) {
      try { cb(msg); } catch { /* ignore subscriber errors */ }
    }
  }, []);

  const subscribe = useCallback((callback: MessageHandler) => {
    subscribersRef.current.add(callback);
    return () => { subscribersRef.current.delete(callback); };
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
        sseRef.current.close();
        sseRef.current = null;
      }
    }

    // -- SSE connection --
    function startSSE() {
      if (!mounted) return;

      // Close any prior SSE
      if (sseRef.current) {
        sseRef.current.close();
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

      es.addEventListener('connected', () => {
        sseRetries = 0;
        if (mounted) setConnectionStatus('sse');
      });

      // When a new mail arrives, notify subscribers with available data.
      // Subscribers that need the full message body can fetch it themselves.
      es.addEventListener('mail_received', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as {
            id: string; from: string; to: string; subject: string; preview: string;
          };
          notify({
            id: data.id,
            from: data.from,
            to: data.to,
            body: data.preview || data.subject,
            timestamp: new Date().toISOString(),
          });
        } catch { /* ignore parse errors */ }
      });

      es.onerror = () => {
        sseRetries++;
        if (sseRetries > MAX_SSE_RETRIES && mounted) {
          es.close();
          sseRef.current = null;
          setConnectionStatus('polling');
        }
        // EventSource auto-reconnects on transient errors
      };
    }

    // -- WebSocket connection --
    function startWebSocket() {
      if (!mounted) return;

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
            if (mounted) setConnectionStatus('websocket');
            break;
          case 'chat_message':
            if (msg.id && msg.from && msg.to && msg.body && msg.timestamp) {
              const incoming: IncomingChatMessage = {
                id: msg.id,
                from: msg.from,
                to: msg.to,
                body: msg.body,
                timestamp: msg.timestamp,
              };
              if (msg.seq != null) incoming.seq = msg.seq;
              notify(incoming);
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

        // Exponential backoff
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1),
          MAX_RECONNECT_DELAY_MS,
        );
        setConnectionStatus('reconnecting');
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
  }, [priority, notify]);

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
  // Context value
  // ---------------------------------------------------------------------------
  const value = useMemo(() => ({
    priority,
    setPriority,
    connectionStatus,
    sendMessage,
    subscribe,
  }), [priority, setPriority, connectionStatus, sendMessage, subscribe]);

  return (
    <CommunicationContext.Provider value={value}>
      {children}
    </CommunicationContext.Provider>
  );
}

/**
 * Hook to access communication context.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useCommunication(): CommunicationContextValue {
  const context = useContext(CommunicationContext);
  if (!context) {
    throw new Error('useCommunication must be used within a CommunicationProvider');
  }
  return context;
}

export default CommunicationContext;
