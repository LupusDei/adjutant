/**
 * useChatWebSocket - WebSocket hook for real-time chat messaging.
 *
 * Manages connection to /ws/chat with:
 * - Auth handshake (API key from session storage)
 * - Auto-reconnect with exponential backoff
 * - Message send/receive
 * - Delivery confirmations
 * - Streaming token accumulation
 * - Typing indicators
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiKey } from '../services/api';
import type { ConnectionStatus } from '../types';

// ============================================================================
// Types
// ============================================================================

/** Server → Client message types */
interface WsServerMessage {
  type: 'auth_challenge' | 'connected' | 'message' | 'chat_message' | 'stream_token' | 'stream_end' | 'typing' | 'delivered' | 'error' | 'sync_response' | 'pong';
  id?: string;
  clientId?: string;
  seq?: number;
  from?: string;
  to?: string;
  body?: string;
  timestamp?: string;
  threadId?: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
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

/** Incoming chat message from WebSocket */
export interface WsChatMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  timestamp: string;
  replyTo?: string | undefined;
}

/** Delivery confirmation */
export interface WsDeliveryConfirmation {
  messageId: string;
  clientId: string;
  timestamp: string;
}

/** Streaming token */
export interface WsStreamToken {
  streamId: string;
  token: string;
  seq?: number | undefined;
  done: boolean;
}

/** Typing indicator */
export interface WsTypingIndicator {
  from: string;
  state: string;
}

/** Callbacks for WS events */
export interface ChatWebSocketCallbacks {
  onMessage?: (msg: WsChatMessage) => void;
  onDelivery?: (confirmation: WsDeliveryConfirmation) => void;
  onStreamToken?: (token: WsStreamToken) => void;
  onStreamEnd?: (streamId: string, messageId?: string) => void;
  onTyping?: (indicator: WsTypingIndicator) => void;
}

/** Hook return value */
export interface ChatWebSocketResult {
  /** Whether WS is connected and authenticated */
  connected: boolean;
  /** Current connection status */
  connectionStatus: ConnectionStatus;
  /** Send a chat message via WS. Returns the client-side message ID. */
  sendMessage: (body: string, to?: string, clientId?: string) => string | null;
  /** Send a typing indicator */
  sendTyping: (state: 'started' | 'stopped') => void;
}

// ============================================================================
// Constants
// ============================================================================

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_MULTIPLIER = 2;

// ============================================================================
// Hook
// ============================================================================

/**
 * WebSocket hook for CommandChat real-time messaging.
 *
 * @param enabled - Whether to connect (based on communication priority)
 * @param callbacks - Event handlers for incoming messages
 */
export function useChatWebSocket(
  enabled: boolean,
  callbacks: ChatWebSocketCallbacks,
): ChatWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const callbacksRef = useRef(callbacks);
  const enabledRef = useRef(enabled);
  const seqRef = useRef(0);

  // Keep callbacks ref current without triggering reconnects
  callbacksRef.current = callbacks;
  enabledRef.current = enabled;

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setConnectionStatus('disconnected');
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;

    setConnectionStatus('reconnecting');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Server will send auth_challenge, handled in onmessage
    };

    ws.onmessage = (event) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(event.data as string) as WsServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'auth_challenge': {
          // Send auth response
          const apiKey = getApiKey();
          ws.send(JSON.stringify({
            type: 'auth_response',
            apiKey: apiKey ?? undefined,
          }));
          break;
        }

        case 'connected':
          setConnected(true);
          setConnectionStatus('websocket');
          reconnectDelay.current = RECONNECT_BASE_MS;
          seqRef.current = msg.lastSeq ?? 0;
          break;

        case 'chat_message':
          if (msg.id && msg.from && msg.to && msg.body !== undefined) {
            if (msg.seq) seqRef.current = msg.seq;
            callbacksRef.current.onMessage?.({
              id: msg.id,
              from: msg.from,
              to: msg.to,
              body: msg.body,
              timestamp: msg.timestamp ?? new Date().toISOString(),
              replyTo: msg.replyTo,
            });
          }
          break;

        case 'delivered':
          if (msg.messageId && msg.clientId) {
            callbacksRef.current.onDelivery?.({
              messageId: msg.messageId,
              clientId: msg.clientId,
              timestamp: msg.timestamp ?? new Date().toISOString(),
            });
          }
          break;

        case 'stream_token':
          if (msg.streamId && msg.token !== undefined) {
            callbacksRef.current.onStreamToken?.({
              streamId: msg.streamId,
              token: msg.token,
              seq: msg.seq,
              done: false,
            });
          }
          break;

        case 'stream_end':
          if (msg.streamId) {
            callbacksRef.current.onStreamEnd?.(msg.streamId, msg.messageId);
          }
          break;

        case 'typing':
          if (msg.from && msg.state) {
            callbacksRef.current.onTyping?.({
              from: msg.from,
              state: msg.state,
            });
          }
          break;

        case 'error':
          // Auth errors close the connection
          if (msg.code === 'auth_failed' || msg.code === 'auth_timeout') {
            setConnected(false);
            setConnectionStatus('disconnected');
          }
          break;

        // sync_response, pong handled silently
      }
    };

    ws.onerror = () => {
      // onclose will handle reconnection
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      if (!enabledRef.current) {
        setConnectionStatus('disconnected');
        return;
      }

      // Schedule reconnect with exponential backoff
      setConnectionStatus('reconnecting');
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        if (enabledRef.current) {
          connect();
        }
      }, reconnectDelay.current);

      reconnectDelay.current = Math.min(
        reconnectDelay.current * RECONNECT_MULTIPLIER,
        RECONNECT_MAX_MS,
      );
    };
  }, []);

  // Connect/disconnect based on enabled flag
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      cleanup();
    }
    return cleanup;
  }, [enabled, connect, cleanup]);

  const sendMessage = useCallback((body: string, to?: string, clientId?: string): string | null => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return null;

    const id = clientId ?? crypto.randomUUID();
    ws.send(JSON.stringify({
      type: 'message',
      id,
      to: to ?? 'mayor/',
      body,
    }));
    return id;
  }, []);

  const sendTyping = useCallback((state: 'started' | 'stopped') => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'typing', state }));
  }, []);

  return {
    connected,
    connectionStatus,
    sendMessage,
    sendTyping,
  };
}
