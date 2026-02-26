import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import type { DashboardResponse } from '../types/dashboard';

export interface UseDashboardOptions {
  /** Polling interval in ms. Default: 30000 (30s) */
  pollInterval?: number;
  /** Whether polling is enabled. Default: true */
  enabled?: boolean;
}

export interface UseDashboardResult {
  /** Full dashboard data, null on initial load */
  data: DashboardResponse | null;
  /** Whether the initial fetch is in progress */
  loading: boolean;
  /** Whether a background refetch is in progress */
  refreshing: boolean;
  /** Global fetch error (network-level, not per-section) */
  error: Error | null;
  /** Timestamp of last successful fetch */
  lastUpdated: Date | null;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
}

/**
 * Unified dashboard hook that fetches all dashboard data in a single request.
 *
 * Features:
 * - Initial fetch on mount with loading state
 * - Configurable polling interval (default 30s)
 * - Stale-while-revalidate: keeps old data visible during refetch
 * - Tab visibility awareness: pauses polling when hidden, resumes on focus
 * - Manual refresh via exposed function
 */
export function useDashboard(options: UseDashboardOptions = {}): UseDashboardResult {
  const { pollInterval = 30000, enabled = true } = options;

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchDashboard = useCallback(async (isInitial: boolean) => {
    if (!mountedRef.current) return;

    if (isInitial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const result = await api.dashboard.get();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setData(result);
        setError(null);
        setLastUpdated(new Date());
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        // Keep stale data on refetch error (stale-while-revalidate)
      }
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchDashboard(false);
  }, [fetchDashboard]);

  // Initial fetch + polling with tab visibility awareness
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => { mountedRef.current = false; };
    }

    // Initial fetch
    void fetchDashboard(true);

    // Polling with tab visibility awareness
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        if (!document.hidden) {
          void fetchDashboard(false);
        }
      }, pollInterval);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        // Pause polling when tab is hidden
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } else {
        // Resume polling + immediate refresh when tab becomes visible
        void fetchDashboard(false);
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchDashboard, pollInterval, enabled]);

  return { data, loading, refreshing, error, lastUpdated, refresh };
}
