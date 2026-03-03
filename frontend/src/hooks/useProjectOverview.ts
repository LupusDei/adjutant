import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import { useProject } from '../contexts/ProjectContext';
import type { ProjectOverview } from '../types/overview';

export interface UseProjectOverviewResult {
  /** Full overview data, null on initial load or no active project */
  data: ProjectOverview | null;
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
  /** Whether there is no active project selected */
  noProject: boolean;
}

/**
 * Hook that fetches project overview data from GET /api/projects/:id/overview.
 *
 * Features:
 * - Gets active project ID from ProjectContext
 * - Polling with configurable interval (default 30s)
 * - Stale-while-revalidate: keeps old data visible during refetch
 * - Tab visibility awareness: pauses polling when hidden, resumes on focus
 * - Manual refresh via exposed function
 */
export function useProjectOverview(pollInterval = 30000): UseProjectOverviewResult {
  const { selectedProject, loading: projectLoading } = useProject();
  const projectId = selectedProject?.id ?? null;

  const [data, setData] = useState<ProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchOverview = useCallback(async (id: string, isInitial: boolean) => {
    if (!mountedRef.current) return;

    if (isInitial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const result = await api.projects.getOverview(id);
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
    if (projectId) {
      await fetchOverview(projectId, false);
    }
  }, [fetchOverview, projectId]);

  // Reset state when project changes
  useEffect(() => {
    if (!projectId) {
      setData(null);
      setLoading(false);
      setError(null);
    }
  }, [projectId]);

  // Initial fetch + polling with tab visibility awareness
  useEffect(() => {
    mountedRef.current = true;

    if (!projectId) {
      return () => { mountedRef.current = false; };
    }

    // Initial fetch
    void fetchOverview(projectId, true);

    // Polling with tab visibility awareness
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        if (!document.hidden) {
          void fetchOverview(projectId, false);
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
        void fetchOverview(projectId, false);
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
  }, [fetchOverview, projectId, pollInterval]);

  const noProject = !projectLoading && !projectId;

  return { data, loading: loading || projectLoading, refreshing, error, lastUpdated, refresh, noProject };
}
