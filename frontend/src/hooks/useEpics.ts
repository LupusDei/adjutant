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
 * Find subtasks for an epic using hierarchical ID pattern.
 * Children are identified by: parent.X where X starts with a number.
 * Example: epic "adj-xyz123" has children "adj-xyz123.1", "adj-xyz123.2", etc.
 * Also checks labels as fallback for backwards compatibility.
 */
function findSubtasks(epicId: string, allBeads: BeadInfo[]): BeadInfo[] {
  const epicIdPrefix = epicId + '.';

  return allBeads.filter((bead) => {
    if (bead.id === epicId) return false;

    // Primary: Check hierarchical ID pattern (matching iOS)
    if (bead.id.startsWith(epicIdPrefix)) {
      const suffix = bead.id.slice(epicIdPrefix.length);
      // Direct children have a numeric prefix (e.g., "1", "1.2", "12")
      if (suffix.length > 0 && /^\d/.test(suffix)) {
        return true;
      }
    }

    // Fallback: Check labels for parent:{epicId} pattern
    if (bead.labels?.some((label) => label === `parent:${epicId}` || label.includes(epicId))) {
      return true;
    }

    return false;
  });
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

// =============================================================================
// useEpicDetail - Single Epic with Subtasks
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
 * Fetch a single epic and all beads to find its subtasks.
 */
async function fetchEpicDetailData(epicId: string): Promise<{
  epic: BeadInfo | null;
  allBeads: BeadInfo[];
}> {
  const [epicResult, allBeads] = await Promise.all([
    api.epics.get(epicId),
    api.beads.list({ status: 'all' }),
  ]);
  return { epic: epicResult, allBeads };
}

/**
 * Hook for fetching a single epic and its subtasks.
 * Polls every 30 seconds (matching iOS).
 */
export function useEpicDetail(
  epicId: string | null,
  options: UseEpicDetailOptions = {}
): UseEpicDetailResult {
  const { enabled = true } = options;

  const fetchFn = useCallback(
    () => (epicId ? fetchEpicDetailData(epicId) : Promise.resolve({ epic: null, allBeads: [] })),
    [epicId]
  );

  const { data, loading, error, refresh } = usePolling(fetchFn, {
    interval: 30000,
    enabled: enabled && epicId !== null,
  });

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

    const { epic, allBeads } = data;
    const subtasks = findSubtasks(epic.id, allBeads);

    // Sort by priority then by updatedAt
    const sorted = [...subtasks].sort((a, b) => {
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
