import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import type { GlobalOverview } from '../types/overview';

export interface UseOverviewResult {
  /** Full overview data, null on initial load */
  data: GlobalOverview | null;
  /** Whether the initial fetch is in progress */
  loading: boolean;
  /** Whether a background refetch is in progress */
  refreshing: boolean;
  /** Global fetch error (network-level) */
  error: Error | null;
  /** Timestamp of last successful fetch */
  lastUpdated: Date | null;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
}

/**
 * Hook that fetches the global overview from GET /api/overview.
 *
 * Features:
 * - No project dependency — aggregates across all projects
 * - Polling with configurable interval (default 30s)
 * - Stale-while-revalidate: keeps old data visible during refetch
 * - Tab visibility awareness: pauses polling when hidden, resumes on focus
 * - Manual refresh via exposed function
 */
export function useOverview(pollInterval = 30000): UseOverviewResult {
  const [data, setData] = useState<GlobalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchOverview = useCallback(async (isInitial: boolean) => {
    if (!mountedRef.current) return;

    if (isInitial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const result = await api.overview.get();
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
    await fetchOverview(false);
  }, [fetchOverview]);

  // Initial fetch + polling with tab visibility awareness
  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    void fetchOverview(true);

    // Polling with tab visibility awareness
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        if (!document.hidden) {
          void fetchOverview(false);
        }
      }, pollInterval);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } else {
        void fetchOverview(false);
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
  }, [fetchOverview, pollInterval]);

  return { data, loading, refreshing, error, lastUpdated, refresh };
}

/**
 * @deprecated Use useOverview() instead. This alias exists for backward compatibility.
 */
export const useProjectOverview = useOverview;
