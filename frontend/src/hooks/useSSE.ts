/**
 * Hook for consuming Server-Sent Events from the Adjutant backend.
 *
 * Connects to GET /api/events and dispatches typed event callbacks.
 * Supports Last-Event-ID for automatic gap recovery on reconnect.
 */

import { useEffect, useRef, useCallback } from 'react';
import { getApiKey } from '../services/api';

/** SSE event types emitted by the backend */
export type SSEEventType =
  | 'bead_update'
  | 'agent_status'
  | 'power_state'
  | 'mail_received'
  | 'mail_read'
  | 'mode_changed'
  | 'stream_status';

export type SSEHandler = (data: Record<string, unknown>) => void;

interface UseSSEOptions {
  /** Event types to subscribe to (empty = none) */
  events: Partial<Record<SSEEventType, SSEHandler>>;
  /** Whether the connection is enabled (default: true) */
  enabled?: boolean;
}

const API_BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

/**
 * Hook to subscribe to backend SSE events.
 *
 * Manages EventSource lifecycle, reconnection, and gap recovery.
 * Pass event handlers as a stable object (useMemo or module-level).
 */
export function useSSE({ events, enabled = true }: UseSSEOptions): void {
  const lastSeqRef = useRef<string | null>(null);
  const handlersRef = useRef(events);
  handlersRef.current = events;

  const connect = useCallback(() => {
    if (!enabled) return undefined;

    // EventSource doesn't support custom headers, so we pass the API key as a query param
    const apiKey = getApiKey();
    const params = new URLSearchParams();
    if (apiKey) params.set('token', apiKey);
    if (lastSeqRef.current) params.set('lastEventId', lastSeqRef.current);

    const query = params.toString();
    const url = `${API_BASE_URL}/events${query ? `?${query}` : ''}`;
    const es = new EventSource(url);

    // Register listeners for each event type we care about
    const eventTypes: SSEEventType[] = [
      'bead_update', 'agent_status', 'power_state',
      'mail_received', 'mail_read', 'mode_changed', 'stream_status',
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (event: MessageEvent) => {
        const handler = handlersRef.current[eventType];
        if (!handler) return;

        // Track sequence for gap recovery
        if (event.lastEventId) {
          lastSeqRef.current = event.lastEventId;
        }

        try {
          const data = JSON.parse(event.data as string) as Record<string, unknown>;
          handler(data);
        } catch {
          // Ignore parse errors
        }
      });
    }

    return es;
  }, [enabled]);

  useEffect(() => {
    const es = connect();
    if (!es) return;

    return () => {
      es.close();
    };
  }, [connect]);
}
