import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { BeadInfo } from '../types';
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
 * Build EpicWithProgress from epic bead alone (no subtask fetch).
 * Uses the epic's own closed status as the progress signal.
 * This is a lightweight approximation that avoids fetching all beads.
 */
function buildLightweightEpicProgress(epic: BeadInfo): EpicWithProgress {
  const isComplete = epic.status === 'closed';
  return {
    epic,
    completedCount: isComplete ? 1 : 0,
    totalCount: 1,
    progress: isComplete ? 1 : 0,
    progressText: isComplete ? 'Done' : 'Active',
    isComplete,
  };
}

/**
 * Custom hook to fetch epic data for the dashboard.
 * Uses a single one-shot fetch of epics only (no polling, no all-beads fetch).
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
        // Fetch only epics (type=epic, status=all) - no need to fetch all beads
        const epics = await api.epics.list();

        // Sort by updatedAt descending
        const sorted = [...epics].sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime;
        });

        const epicsWithProgress = sorted.map(buildLightweightEpicProgress);

        const openEpics = epicsWithProgress.filter((e) => !e.isComplete);
        const closedEpics = epicsWithProgress.filter((e) => e.isComplete);

        // For in-progress, show non-closed epics (they have active work)
        setInProgress({
          items: openEpics.slice(0, DASHBOARD_EPIC_LIMIT),
          totalCount: openEpics.length,
        });
        setCompleted({
          items: closedEpics.slice(0, DASHBOARD_EPIC_LIMIT),
          totalCount: closedEpics.length,
        });
        setTotalCount(epics.length);
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
