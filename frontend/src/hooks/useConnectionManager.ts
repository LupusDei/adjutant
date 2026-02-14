/**
 * Connection manager hook for chat communication.
 *
 * Manages WebSocket → SSE → HTTP polling fallback chain.
 * Tracks current connection method, streaming state, and reconnection.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiKey } from '../services/api';

// ============================================================================
// Types
// ============================================================================

export type ConnectionMethod = 'ws' | 'sse' | 'http';
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export interface StreamingMessage {
  streamId: string;
  tokens: string;
  done: boolean;
}

interface WsServerMessage {
  type: string;
  id?: string;
  seq?: number;
  from?: string;
  to?: string;
  body?: string;
  timestamp?: string;
  streamId?: string;
  token?: string;
  done?: boolean;
  messageId?: string;
  state?: string;
  code?: string;
  message?: string;
  sessionId?: string;
  lastSeq?: number;
  serverTime?: string;
  missed?: WsServerMessage[];
}

export interface ConnectionManagerState {
  /** Current communication method */
  method: ConnectionMethod;
  /** Connection state */
  state: ConnectionState;
  /** Whether an agent response is actively streaming */
  isStreaming: boolean;
  /** Current streaming message (accumulated tokens) */
  streamingMessage: StreamingMessage | null;
}

export interface ConnectionManager extends ConnectionManagerState {
  /** Send a message over the current connection */
  sendMessage: (to: string, body: string) => void;
  /** Register a callback for incoming messages */
  onMessage: (handler: (msg: WsServerMessage) => void) => () => void;
}

// ============================================================================
// Constants
// ============================================================================

const WS_RECONNECT_DELAY_MS = 3000;
const WS_MAX_RECONNECT_ATTEMPTS = 5;
const SSE_RECONNECT_DELAY_MS = 5000;

// ============================================================================
// Hook
// ============================================================================

export function useConnectionManager(isActive: boolean): ConnectionManager {
  const [method, setMethod] = useState<ConnectionMethod>('http');
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageHandlersRef = useRef<Set<(msg: WsServerMessage) => void>>(new Set());
  const isActiveRef = useRef(isActive);

  isActiveRef.current = isActive;

  const notifyHandlers = useCallback((msg: WsServerMessage) => {
    for (const handler of messageHandlersRef.current) {
      handler(msg);
    }
  }, []);

  // -- WebSocket connection --
  const connectWebSocket = useCallback(() => {
    if (!isActiveRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setState('reconnecting');

      ws.onopen = () => {
        // Send auth response immediately
        const apiKey = getApiKey();
        ws.send(JSON.stringify({
          type: 'auth_response',
          apiKey: apiKey ?? undefined,
        }));
      };

      ws.onmessage = (event) => {
        let msg: WsServerMessage;
        try {
          msg = JSON.parse(event.data as string) as WsServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'connected':
            setMethod('ws');
            setState('connected');
            reconnectAttemptsRef.current = 0;
            break;

          case 'message':
            notifyHandlers(msg);
            break;

          case 'stream_token':
            setIsStreaming(true);
            setStreamingMessage((prev) => ({
              streamId: msg.streamId ?? prev?.streamId ?? '',
              tokens: (prev?.tokens ?? '') + (msg.token ?? ''),
              done: false,
            }));
            break;

          case 'stream_end':
            setIsStreaming(false);
            setStreamingMessage((prev) =>
              prev ? { ...prev, done: true } : null
            );
            notifyHandlers(msg);
            break;

          case 'typing':
            notifyHandlers(msg);
            break;

          case 'error':
            if (msg.code === 'auth_failed' || msg.code === 'auth_timeout') {
              // Auth failed, fall back to SSE
              ws.close();
            }
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;

        if (!isActiveRef.current) return;

        if (reconnectAttemptsRef.current < WS_MAX_RECONNECT_ATTEMPTS) {
          setState('reconnecting');
          reconnectAttemptsRef.current++;
          reconnectTimerRef.current = setTimeout(
            connectWebSocket,
            WS_RECONNECT_DELAY_MS
          );
        } else {
          // Fall back to SSE
          connectSSE();
        }
      };

      ws.onerror = () => {
        // onclose will fire next, which handles reconnection
      };
    } catch {
      // WebSocket constructor failed, fall back to SSE
      connectSSE();
    }
  }, [notifyHandlers]);

  // -- SSE connection --
  const connectSSE = useCallback(() => {
    if (!isActiveRef.current) return;

    // Close any existing SSE
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    try {
      const eventSource = new EventSource('/api/events');
      sseRef.current = eventSource;
      setState('reconnecting');

      eventSource.addEventListener('connected', () => {
        setMethod('sse');
        setState('connected');
      });

      eventSource.addEventListener('mail_received', (event) => {
        try {
          const data = JSON.parse(event.data as string) as WsServerMessage;
          notifyHandlers({ ...data, type: 'message' });
        } catch { /* ignore parse errors */ }
      });

      eventSource.addEventListener('stream_status', (event) => {
        try {
          const data = JSON.parse(event.data as string) as { streamId: string; state: string };
          if (data.state === 'started') {
            setIsStreaming(true);
          } else if (data.state === 'completed' || data.state === 'error') {
            setIsStreaming(false);
            setStreamingMessage((prev) =>
              prev ? { ...prev, done: true } : null
            );
          }
        } catch { /* ignore */ }
      });

      eventSource.onerror = () => {
        eventSource.close();
        sseRef.current = null;

        if (!isActiveRef.current) return;

        // Fall back to HTTP polling
        setMethod('http');
        setState('connected');

        // Try SSE again after a delay
        reconnectTimerRef.current = setTimeout(connectSSE, SSE_RECONNECT_DELAY_MS);
      };
    } catch {
      // SSE failed, fall to HTTP
      setMethod('http');
      setState('connected');
    }
  }, [notifyHandlers]);

  // -- Send message --
  const sendMessage = useCallback((to: string, body: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        id: crypto.randomUUID(),
        to,
        body,
      }));
    }
    // HTTP send is handled by the existing api.mail.send in CommandChat
  }, []);

  // -- Register message handler --
  const onMessage = useCallback((handler: (msg: WsServerMessage) => void) => {
    messageHandlersRef.current.add(handler);
    return () => {
      messageHandlersRef.current.delete(handler);
    };
  }, []);

  // -- Lifecycle --
  useEffect(() => {
    if (!isActive) {
      // Clean up all connections
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setState('disconnected');
      return;
    }

    // Start connection chain: try WS first
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [isActive, connectWebSocket, connectSSE]);

  // Clear streaming message after it's marked done (after a brief display)
  useEffect(() => {
    if (!streamingMessage?.done) return;
    const timer = setTimeout(() => setStreamingMessage(null), 500);
    return () => clearTimeout(timer);
  }, [streamingMessage?.done]);

  return {
    method,
    state,
    isStreaming,
    streamingMessage,
    sendMessage,
    onMessage,
  };
}

export default useConnectionManager;
