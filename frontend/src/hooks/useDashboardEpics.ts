import { useEpics } from './useEpics';
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
 * Custom hook to fetch epic data for the dashboard.
 * Returns in-progress and completed epics, limited to 5 per category.
 */
export function useDashboardEpics(): DashboardEpics {
  const { openEpics, completedEpics, loading, error } = useEpics();

  const totalCount = openEpics.length + completedEpics.length;

  // In-progress: epics with subtasks where some are completed but not all
  const inProgressEpics = openEpics.filter(
    (e) => e.totalCount > 0 && e.completedCount > 0 && e.completedCount < e.totalCount,
  );
  // Sort by progress descending (closest to done first)
  const sortedInProgress = [...inProgressEpics].sort((a, b) => b.progress - a.progress);

  return {
    inProgress: {
      items: sortedInProgress.slice(0, DASHBOARD_EPIC_LIMIT),
      totalCount: inProgressEpics.length,
    },
    completed: {
      items: completedEpics.slice(0, DASHBOARD_EPIC_LIMIT),
      totalCount: completedEpics.length,
    },
    totalCount,
    loading,
    error,
  };
}
