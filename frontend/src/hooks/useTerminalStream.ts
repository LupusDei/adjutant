/**
 * Hook for streaming terminal output via WebSocket with polling fallback.
 *
 * Connects to /api/terminal/stream for real-time output. Falls back to
 * polling GET /api/agents/session/:id/terminal if WebSocket fails.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';

/** Strip ANSI escape codes for clean text display. */
function stripAnsi(str: string): string {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[^[\]].?/g, '')
    .replace(/\r/g, '');
}

/** Convert parsed output events to displayable text lines. */
function eventsToText(events: { type: string; content?: string; tool?: string; output?: string; message?: string; data?: string }[]): string {
  const lines: string[] = [];
  for (const evt of events) {
    switch (evt.type) {
      case 'message':
        if (evt.content) lines.push(evt.content);
        break;
      case 'user_input':
        if (evt.content) lines.push(`> ${evt.content}`);
        break;
      case 'tool_use':
        lines.push(`[${evt.tool ?? 'tool'}]`);
        break;
      case 'tool_result':
        if (evt.output) lines.push(evt.output);
        break;
      case 'error':
        if (evt.message) lines.push(`ERROR: ${evt.message}`);
        break;
      case 'raw':
        if (evt.data) lines.push(evt.data);
        break;
    }
  }
  return lines.join('\n');
}

const POLL_INTERVAL_MS = 3000;
const WS_RECONNECT_DELAY_MS = 5000;

interface UseTerminalStreamOptions {
  sessionId: string | undefined;
  enabled: boolean;
}

interface UseTerminalStreamResult {
  content: string | null;
  error: string | null;
  loading: boolean;
  connected: boolean;
  mode: 'ws' | 'polling' | 'disconnected';
}

export function useTerminalStream({ sessionId, enabled }: UseTerminalStreamOptions): UseTerminalStreamResult {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<'ws' | 'polling' | 'disconnected'>('disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const wsAttemptedRef = useRef(false);

  // Polling fallback
  const startPolling = useCallback(() => {
    if (!sessionId || pollTimerRef.current) return;

    const fetchContent = async () => {
      try {
        const result = await api.agents.getSessionTerminal(sessionId);
        if (mountedRef.current) {
          setContent(stripAnsi(result.content));
          setError(null);
          setMode('polling');
          setConnected(true);
          setLoading(false);
        }
      } catch {
        if (mountedRef.current) {
          setError('Failed to fetch terminal output');
          setLoading(false);
        }
      }
    };

    void fetchContent();
    pollTimerRef.current = setInterval(() => { void fetchContent(); }, POLL_INTERVAL_MS);
  }, [sessionId]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // WebSocket connection
  const connectWs = useCallback(() => {
    if (!sessionId || wsRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/terminal/stream`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>;
          const msgType = msg['type'] as string;

          switch (msgType) {
            case 'subscribed': {
              const initialContent = msg['content'] as string | undefined;
              setContent(initialContent ? stripAnsi(initialContent) : '');
              setConnected(true);
              setMode('ws');
              setLoading(false);
              setError(null);
              break;
            }
            case 'output': {
              const events = msg['events'] as { type: string; content?: string; tool?: string; output?: string; message?: string; data?: string }[];
              if (events.length > 0) {
                const newText = eventsToText(events);
                if (newText) {
                  setContent(prev => prev ? `${prev}\n${newText}` : newText);
                }
              }
              break;
            }
            case 'snapshot': {
              // Full refresh — replace content entirely
              const snapshot = msg['content'] as string | undefined;
              if (snapshot) {
                setContent(stripAnsi(snapshot));
              }
              break;
            }
            case 'error': {
              const errMsg = msg['message'] as string | undefined;
              setError(errMsg ?? 'Stream error');
              break;
            }
          }
        } catch {
          // Invalid message — ignore
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        wsAttemptedRef.current = true;
        if (mountedRef.current && enabled) {
          setConnected(false);
          // Fall back to polling
          startPolling();
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror — handle there
      };
    } catch {
      // WebSocket not available — fall back to polling
      wsAttemptedRef.current = true;
      startPolling();
    }
  }, [sessionId, enabled, startPolling]);

  const disconnectWs = useCallback(() => {
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe' }));
      }
      ws.close();
    }
  }, []);

  // Main effect: connect/disconnect based on enabled state
  useEffect(() => {
    mountedRef.current = true;

    if (enabled && sessionId) {
      setLoading(true);
      wsAttemptedRef.current = false;

      // Try WebSocket first
      connectWs();

      // If WS hasn't connected after a delay, start polling
      const fallbackTimer = setTimeout(() => {
        if (mountedRef.current && !connected && !pollTimerRef.current) {
          startPolling();
        }
      }, WS_RECONNECT_DELAY_MS);

      return () => {
        mountedRef.current = false;
        clearTimeout(fallbackTimer);
        disconnectWs();
        stopPolling();
        setConnected(false);
        setMode('disconnected');
      };
    }

    // Disabled — clean up
    disconnectWs();
    stopPolling();
    setContent(null);
    setError(null);
    setConnected(false);
    setMode('disconnected');
    setLoading(false);

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, sessionId, connectWs, disconnectWs, startPolling, stopPolling, connected]);

  return { content, error, loading, connected, mode };
}
