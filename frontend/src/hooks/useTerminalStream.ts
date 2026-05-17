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
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
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

/**
 * adj-139.3.5: Maximum number of characters the terminal content holds in memory.
 *
 * The terminal stream is append-only and was unbounded — long-running sessions
 * grew to hundreds of MB and crashed the page. 100KB is enough scrollback for
 * typical debugging while keeping memory pressure tiny.
 *
 * (Note: we use string length as a byte proxy. For ASCII terminal output that
 * matches actual bytes; for multi-byte content it's a slight under-count, which
 * is the safer direction.)
 */
export const MAX_TERMINAL_BYTES = 100_000;

/**
 * Append new text to existing terminal content, capping at MAX_TERMINAL_BYTES.
 * Drops the OLDEST content first, always at a line boundary — never truncates
 * mid-line, so the terminal display never shows corrupt partial lines.
 *
 * Exported for unit testing.
 */
export function appendWithRingBuffer(prev: string | null, newText: string): string {
  if (!newText) return prev ?? '';
  const combined = prev ? `${prev}\n${newText}` : newText;
  if (combined.length <= MAX_TERMINAL_BYTES) return combined;

  // Need to drop content from the front. Find the earliest newline such that
  // the resulting tail fits in MAX_TERMINAL_BYTES. If no newline exists in the
  // overflow region (single huge line), fall back to dropping the entire prev
  // content and keeping only newText (or the tail of newText that fits).
  const overflow = combined.length - MAX_TERMINAL_BYTES;
  // The "cut" must be at or after `overflow` so the remainder is ≤ MAX.
  const newlineIdx = combined.indexOf('\n', overflow);
  if (newlineIdx === -1) {
    // No safe line boundary found in the overflow region — drop everything
    // before the start of the newest line in the tail.
    const lastNewline = combined.lastIndexOf('\n');
    if (lastNewline === -1 || combined.length - (lastNewline + 1) > MAX_TERMINAL_BYTES) {
      // Single-line content longer than the cap: keep the last MAX bytes.
      return combined.slice(combined.length - MAX_TERMINAL_BYTES);
    }
    return combined.slice(lastNewline + 1);
  }
  // Skip past the newline so we don't start with a blank line.
  return combined.slice(newlineIdx + 1);
}

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
                  // adj-139.3.5: ring-buffer cap so long sessions can't OOM.
                  setContent(prev => appendWithRingBuffer(prev, newText));
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
