import { useEpics } from './useEpics';
import type { EpicWithProgress } from '../types/epics';

interface DashboardEpics {
  recentEpics: EpicWithProgress[];
  totalCount: number;
  activeCount: number;
  completedCount: number;
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook to fetch epic data for the dashboard.
 * Returns recent epics (open/in-progress first), with counts.
 */
export function useDashboardEpics(): DashboardEpics {
  const { openEpics, completedEpics, loading, error } = useEpics();

  const totalCount = openEpics.length + completedEpics.length;
  const activeCount = openEpics.filter((e) => e.totalCount > 0 && e.completedCount < e.totalCount).length;
  const completedCount = completedEpics.length;

  // Show open epics first (in-progress before unstarted), then limit to reasonable count
  const sorted = [...openEpics].sort((a, b) => {
    const aInProgress = a.totalCount > 0 && a.completedCount < a.totalCount;
    const bInProgress = b.totalCount > 0 && b.completedCount < b.totalCount;
    if (aInProgress && !bInProgress) return -1;
    if (!aInProgress && bInProgress) return 1;
    return 0;
  });

  return {
    recentEpics: sorted,
    totalCount,
    activeCount,
    completedCount,
    loading,
    error,
  };
}
