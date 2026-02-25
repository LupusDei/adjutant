import { useMemo, useCallback, useEffect } from 'react';
import { usePolling } from './usePolling';
import { api } from '../services/api';
import type { BeadInfo, EpicWithProgressResponse } from '../types';
import type { EpicWithProgress } from '../types/epics';

export interface UseEpicsOptions {
  /** Optional rig filter */
  rig?: string | undefined;
  /** Whether this hook is active (for tab switching) */
  enabled?: boolean | undefined;
}

export interface UseEpicsResult {
  openEpics: EpicWithProgress[];
  completedEpics: EpicWithProgress[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
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
 * Hook for fetching and managing epics with progress calculation.
 * Uses the server-side epics-with-progress endpoint (dependency graph based).
 * Polls every 30 seconds (matching iOS).
 */
export function useEpics(options: UseEpicsOptions = {}): UseEpicsResult {
  const { rig: _rig, enabled = true } = options;

  const fetchFn = useCallback(
    () => api.epics.listWithProgress({ status: 'all' }),
    []
  );

  const { data, loading, error, refresh } = usePolling(fetchFn, {
    interval: 30000,
    enabled,
  });

  const { openEpics, completedEpics } = useMemo(() => {
    if (!data) {
      return { openEpics: [], completedEpics: [] };
    }

    const epicsWithProgress = data.map(toEpicWithProgress);

    // Split into open and completed
    const open: EpicWithProgress[] = [];
    const completed: EpicWithProgress[] = [];

    for (const ewp of epicsWithProgress) {
      if (ewp.isComplete) {
        completed.push(ewp);
      } else {
        open.push(ewp);
      }
    }

    return { openEpics: open, completedEpics: completed };
  }, [data]);

  return {
    openEpics,
    completedEpics,
    loading,
    error: error?.message ?? null,
    refresh,
  };
}

// =============================================================================
// useEpicDetail - Single Epic with Subtasks (using dependency graph)
// =============================================================================

export interface UseEpicDetailOptions {
  /** Whether this hook is active */
  enabled?: boolean;
}

export interface UseEpicDetailResult {
  /** The epic being displayed */
  epic: BeadInfo | null;
  /** All subtasks */
  subtasks: BeadInfo[];
  /** Open subtasks (in_progress, hooked, open) */
  openSubtasks: BeadInfo[];
  /** Closed subtasks */
  closedSubtasks: BeadInfo[];
  /** Progress as a decimal (0-1) */
  progress: number;
  /** Human-readable progress text (e.g., "3/5") */
  progressText: string;
  /** Whether all subtasks are complete */
  isComplete: boolean;
  /** Whether data is loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
}

/**
 * Fetch a single epic and its children using the dependency graph endpoint.
 * No longer fetches all beads — uses GET /api/beads/:id/children.
 */
async function fetchEpicDetailData(epicId: string): Promise<{
  epic: BeadInfo | null;
  children: BeadInfo[];
}> {
  const [epicResult, children] = await Promise.all([
    api.epics.get(epicId),
    api.epics.getChildren(epicId),
  ]);
  return { epic: epicResult, children };
}

/**
 * Hook for fetching a single epic and its subtasks.
 * Uses the dependency graph via GET /api/beads/:id/children.
 * Polls every 30 seconds (matching iOS).
 */
export function useEpicDetail(
  epicId: string | null,
  options: UseEpicDetailOptions = {}
): UseEpicDetailResult {
  const { enabled = true } = options;

  const fetchFn = useCallback(
    () => (epicId ? fetchEpicDetailData(epicId) : Promise.resolve({ epic: null, children: [] })),
    [epicId]
  );

  const { data, loading, error, refresh } = usePolling(fetchFn, {
    interval: 30000,
    enabled: enabled && epicId !== null,
  });

  // Force refresh when epicId changes to ensure we fetch new data immediately
  useEffect(() => {
    if (epicId && enabled) {
      void refresh();
    }
  }, [epicId, enabled, refresh]);

  const result = useMemo(() => {
    if (!data?.epic) {
      return {
        epic: null,
        subtasks: [],
        openSubtasks: [],
        closedSubtasks: [],
        progress: 0,
        progressText: '0/0',
        isComplete: false,
      };
    }

    const { epic, children } = data;

    // Sort by priority then by updatedAt
    const sorted = [...children].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });

    const openSubtasks = sorted.filter((s) => s.status !== 'closed');
    const closedSubtasks = sorted.filter((s) => s.status === 'closed');

    const totalCount = sorted.length;
    const completedCount = closedSubtasks.length;
    const progress = totalCount > 0 ? completedCount / totalCount : 0;
    const isComplete = totalCount > 0 && completedCount === totalCount;

    return {
      epic,
      subtasks: sorted,
      openSubtasks,
      closedSubtasks,
      progress,
      progressText: `${completedCount}/${totalCount}`,
      isComplete,
    };
  }, [data]);

  return {
    ...result,
    loading,
    error: error?.message ?? null,
    refresh,
  };
}
