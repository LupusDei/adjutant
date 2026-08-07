/**
 * useSwarmAgents - Real-time agent monitoring over the shared communication
 * stream, with a polling fallback.
 *
 * Combines:
 * 1. Initial fetch via api.agents.list()
 * 2. Agent status changes pushed on the SHARED /ws/chat connection owned by
 *    CommunicationContext (adj-bgpup — this hook no longer opens a second
 *    long-lived socket of its own)
 * 3. Optimistic status updates from those events
 * 4. Periodic full refresh to catch roster joins/leaves, throttled while the
 *    stream is connected and skipped entirely in a hidden tab
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import {
  useCommunicationActions,
  useCommunicationStatus,
} from '../contexts/CommunicationContext';
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
  /** Whether the shared status stream is connected */
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
/**
 * While the status stream is connected, do a full roster refetch only every
 * Nth tick (adj-bgpup) — the stream already carries status changes, so the
 * refetch exists purely to notice agents joining or leaving.
 */
const CONNECTED_REFRESH_FACTOR = 6;

// ============================================================================
// Hook
// ============================================================================

export function useSwarmAgents(): UseSwarmAgentsResult {
  const [agents, setAgents] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const mountedRef = useRef(true);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Latest stream state, read by the refresh interval without re-arming it. */
  const streamingRef = useRef(false);

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

  // ---- Agent status via the SHARED stream (adj-bgpup) ----
  // This hook used to open its own WebSocket to /api/agents/stream. Because
  // the crew view is mounted on every tab (just hidden), that meant every tab
  // held TWO long-lived connections — doubling the tunnel/socket pressure that
  // this bug is about. Status now rides the one connection the communication
  // context already owns; the endpoint stays available for other clients.
  const { subscribeAgentStatus } = useCommunicationActions();
  const { connectionStatus } = useCommunicationStatus();
  const streaming = connectionStatus === 'websocket';

  useEffect(() => {
    streamingRef.current = streaming;
    setConnected(streaming);
  }, [streaming]);

  useEffect(() => {
    return subscribeAgentStatus((event) => {
      applyStatusChange({
        type: 'status_change',
        agent: event.agent,
        to: event.status as CrewMemberStatus,
        timestamp: event.timestamp,
      });
    });
  }, [subscribeAgentStatus, applyStatusChange]);

  // ---- Cleanup ----
  const cleanup = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  // ---- Mount/unmount lifecycle ----
  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    void fetchAgents();

    // Periodic refresh. adj-bgpup: a hidden tab never refreshes, and while the
    // WS is delivering status changes the full refetch drops to
    // CONNECTED_REFRESH_FACTOR× the interval — it is then only needed to pick
    // up agents joining or leaving the roster, which the stream doesn't carry.
    let tick = 0;
    refreshTimer.current = setInterval(() => {
      tick++;
      if (document.hidden) return;
      if (streamingRef.current && tick % CONNECTED_REFRESH_FACTOR !== 0) return;
      void fetchAgents();
    }, REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [fetchAgents, cleanup]);

  // ---- Manual refresh ----
  const refresh = useCallback(() => {
    void fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, connected, refresh };
}
