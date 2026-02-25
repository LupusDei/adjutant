import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { EpicWithProgressResponse } from '../types';
import type { EpicWithProgress } from '../types/epics';

const DASHBOARD_EPIC_LIMIT = 5;

export interface EpicCategory {
  items: EpicWithProgress[];
  totalCount: number;
}

interface DashboardEpics {
  inProgress: EpicCategory;
  completed: EpicCategory;
  totalCount: number;
  loading: boolean;
  error: string | null;
}

/**
 * Transform server response to frontend EpicWithProgress type.
 */
function toEpicWithProgress(item: EpicWithProgressResponse): EpicWithProgress {
  const isComplete = item.epic.status === 'closed' ||
    (item.totalCount > 0 && item.closedCount === item.totalCount);
  return {
    epic: item.epic,
    completedCount: item.closedCount,
    totalCount: item.totalCount,
    progress: item.progress,
    progressText: item.totalCount > 0 ? `${item.closedCount}/${item.totalCount}` : '0/0',
    isComplete,
  };
}

/**
 * Custom hook to fetch epic data for the dashboard.
 * Uses the server-side epics-with-progress endpoint (dependency graph based).
 * Single one-shot fetch — no polling on the dashboard overview.
 * Returns in-progress and completed epics, limited to 5 per category.
 */
export function useDashboardEpics(): DashboardEpics {
  const [inProgress, setInProgress] = useState<EpicCategory>({ items: [], totalCount: 0 });
  const [completed, setCompleted] = useState<EpicCategory>({ items: [], totalCount: 0 });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEpics = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.epics.listWithProgress({ status: 'all' });

        const epicsWithProgress = data.map(toEpicWithProgress);

        const openEpics = epicsWithProgress.filter((e) => !e.isComplete);
        const closedEpics = epicsWithProgress.filter((e) => e.isComplete);

        // Sort in-progress by progress descending (closest to done first)
        const sortedInProgress = [...openEpics].sort((a, b) => b.progress - a.progress);

        setInProgress({
          items: sortedInProgress.slice(0, DASHBOARD_EPIC_LIMIT),
          totalCount: openEpics.length,
        });
        setCompleted({
          items: closedEpics.slice(0, DASHBOARD_EPIC_LIMIT),
          totalCount: closedEpics.length,
        });
        setTotalCount(data.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch epics');
      } finally {
        setLoading(false);
      }
    };

    void fetchEpics();
  }, []);

  return { inProgress, completed, totalCount, loading, error };
}
