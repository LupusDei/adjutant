import { useMemo, useCallback } from 'react';
import { usePolling } from './usePolling';
import { api } from '../services/api';
import type { BeadInfo } from '../types';
import type { EpicWithProgress } from '../types/epics';

export interface UseEpicsOptions {
  /** Optional rig filter */
  rig?: string;
  /** Whether this hook is active (for tab switching) */
  enabled?: boolean;
}

export interface UseEpicsResult {
  openEpics: EpicWithProgress[];
  completedEpics: EpicWithProgress[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetch epics and all beads, then compute progress for each epic.
 */
async function fetchEpicsData(rig?: string): Promise<{
  epics: BeadInfo[];
  allBeads: BeadInfo[];
}> {
  const [epics, allBeads] = await Promise.all([
    api.epics.list(rig ? { rig } : undefined),
    api.beads.list({ status: 'all' }),
  ]);
  return { epics, allBeads };
}

/**
 * Find subtasks for an epic by checking labels for parent:{epicId} or epicId.
 */
function findSubtasks(epicId: string, allBeads: BeadInfo[]): BeadInfo[] {
  return allBeads.filter(
    (bead) =>
      bead.id !== epicId &&
      bead.labels?.some((label) => label.includes(epicId) || label.includes(`parent:${epicId}`))
  );
}

/**
 * Build EpicWithProgress from epic and its subtasks.
 */
function buildEpicWithProgress(epic: BeadInfo, subtasks: BeadInfo[]): EpicWithProgress {
  const totalCount = subtasks.length;
  const completedCount = subtasks.filter((s) => s.status === 'closed').length;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;
  const isComplete = totalCount > 0 && completedCount === totalCount;

  return {
    epic,
    completedCount,
    totalCount,
    progress,
    progressText: `${completedCount}/${totalCount}`,
    isComplete,
  };
}

/**
 * Hook for fetching and managing epics with progress calculation.
 * Polls every 30 seconds (matching iOS).
 */
export function useEpics(options: UseEpicsOptions = {}): UseEpicsResult {
  const { rig, enabled = true } = options;

  const fetchFn = useCallback(() => fetchEpicsData(rig), [rig]);

  const { data, loading, error, refresh } = usePolling(fetchFn, {
    interval: 30000,
    enabled,
  });

  const { openEpics, completedEpics } = useMemo(() => {
    if (!data) {
      return { openEpics: [], completedEpics: [] };
    }

    const { epics, allBeads } = data;

    // Build EpicWithProgress for each epic
    const epicsWithProgress = epics.map((epic) => {
      const subtasks = findSubtasks(epic.id, allBeads);
      return buildEpicWithProgress(epic, subtasks);
    });

    // Sort by updatedAt descending
    const sorted = [...epicsWithProgress].sort((a, b) => {
      const aTime = a.epic.updatedAt ? new Date(a.epic.updatedAt).getTime() : 0;
      const bTime = b.epic.updatedAt ? new Date(b.epic.updatedAt).getTime() : 0;
      return bTime - aTime;
    });

    // Split into open and completed
    const open: EpicWithProgress[] = [];
    const completed: EpicWithProgress[] = [];

    for (const ewp of sorted) {
      if (ewp.epic.status === 'closed' || ewp.isComplete) {
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
