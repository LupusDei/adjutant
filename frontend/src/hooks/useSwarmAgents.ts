/**
 * useSwarmAgents - Real-time agent monitoring with WebSocket + polling fallback.
 *
 * Combines:
 * 1. Initial fetch via api.agents.list()
 * 2. WebSocket subscription to /api/agents/stream for status_change events
 * 3. Optimistic status updates from WS events
 * 4. Periodic full refresh every 10s as fallback
 * 5. Exponential backoff reconnection on WS disconnect
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import type { CrewMember, CrewMemberStatus } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface UseSwarmAgentsResult {
  /** Current agent list */
  agents: CrewMember[];
  /** Whether the initial fetch is in progress */
  loading: boolean;
  /** Error from latest fetch, or null */
  error: string | null;
  /** Whether the WebSocket is connected */
  connected: boolean;
  /** Manually trigger a full refresh */
  refresh: () => void;
}

/** Server → Client status change event */
interface StatusChangeEvent {
  type: 'status_change';
  agent: string;
  to: CrewMemberStatus;
  timestamp: string;
}

// ============================================================================
// Constants
// ============================================================================

const REFRESH_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;

// ============================================================================
// Hook
// ============================================================================

export function useSwarmAgents(): UseSwarmAgentsResult {
  const [agents, setAgents] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const mountedRef = useRef(true);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Fetch agents from API ----
  const fetchAgents = useCallback(async () => {
    try {
      const data = await api.agents.list();
      if (mountedRef.current) {
        setAgents(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // ---- Apply optimistic status update ----
  const applyStatusChange = useCallback((event: StatusChangeEvent) => {
    setAgents(prev => {
      const idx = prev.findIndex(a => a.name === event.agent);
      if (idx === -1) return prev;

      const updated = [...prev];
      const agent = updated[idx];
      // Use Object.assign to satisfy exactOptionalPropertyTypes
      updated[idx] = Object.assign({}, agent, { status: event.to });
      return updated;
    });
  }, []);

  // ---- WebSocket connection ----
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/agents/stream`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (mountedRef.current) {
        setConnected(true);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as StatusChangeEvent;
        // Successful message — reset backoff since connection is stable
        reconnectDelay.current = RECONNECT_BASE_MS;
        applyStatusChange(msg);
      } catch {
        // Ignore unparseable messages
      }
    };

    ws.onerror = () => {
      // onclose handles reconnection
    };

    ws.onclose = () => {
      if (mountedRef.current) {
        setConnected(false);
        wsRef.current = null;

        // Schedule reconnect with exponential backoff
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          if (mountedRef.current) {
            connectWs();
          }
        }, reconnectDelay.current);

        reconnectDelay.current = Math.min(
          reconnectDelay.current * RECONNECT_MULTIPLIER,
          RECONNECT_MAX_MS,
        );
      }
    };
  }, [applyStatusChange]);

  // ---- Cleanup ----
  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // ---- Mount/unmount lifecycle ----
  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    void fetchAgents();

    // Connect WebSocket
    connectWs();

    // Periodic refresh as fallback
    refreshTimer.current = setInterval(() => {
      void fetchAgents();
    }, REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [fetchAgents, connectWs, cleanup]);

  // ---- Manual refresh ----
  const refresh = useCallback(() => {
    void fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, connected, refresh };
}
