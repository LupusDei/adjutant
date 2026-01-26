/**
 * useKanban - Hook for Kanban board state management.
 * Handles bead grouping, drag state, API calls, and optimistic updates.
 */

import { useState, useCallback, useMemo, type DragEvent } from 'react';
import { api } from '../services/api';
import type { BeadInfo, KanbanColumnId, KanbanColumn, KanbanDragState } from '../types';
import { KANBAN_COLUMNS, mapStatusToColumn } from '../types/kanban';

export interface UseKanbanOptions {
  /** Called after successful status update */
  onStatusUpdate?: (beadId: string, newStatus: KanbanColumnId) => void;
  /** Called on update error */
  onError?: (error: Error, beadId: string) => void;
}

export interface UseKanbanResult {
  /** Columns with grouped beads */
  columns: KanbanColumn[];
  /** Current drag state */
  dragState: KanbanDragState;
  /** Whether an update is in progress */
  isUpdating: boolean;
  /** Handle drag start on a card */
  handleDragStart: (e: DragEvent<HTMLDivElement>, bead: BeadInfo) => void;
  /** Handle drag end */
  handleDragEnd: (e: DragEvent<HTMLDivElement>) => void;
  /** Handle drag over a column */
  handleDragOver: (e: DragEvent<HTMLDivElement>, columnId: KanbanColumnId) => void;
  /** Handle drag leave from a column */
  handleDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  /** Handle drop on a column */
  handleDrop: (e: DragEvent<HTMLDivElement>, columnId: KanbanColumnId) => Promise<void>;
}

/**
 * Groups beads by status into Kanban columns.
 */
function groupBeadsIntoColumns(beads: BeadInfo[]): KanbanColumn[] {
  // Initialize columns with empty bead arrays
  const columnMap = new Map<KanbanColumnId, BeadInfo[]>();
  for (const col of KANBAN_COLUMNS) {
    columnMap.set(col.id, []);
  }

  // Group beads by status
  for (const bead of beads) {
    const columnId = mapStatusToColumn(bead.status);
    const column = columnMap.get(columnId);
    if (column) {
      column.push(bead);
    }
  }

  // Build column objects
  return KANBAN_COLUMNS.map((col) => ({
    id: col.id,
    title: col.title,
    color: col.color,
    beads: columnMap.get(col.id) ?? [],
  }));
}

export function useKanban(
  beads: BeadInfo[],
  onBeadsChange: (updater: (prev: BeadInfo[]) => BeadInfo[]) => void,
  options: UseKanbanOptions = {}
): UseKanbanResult {
  const { onStatusUpdate, onError } = options;

  const [dragState, setDragState] = useState<KanbanDragState>({
    beadId: null,
    fromColumn: null,
    overColumn: null,
  });

  const [isUpdating, setIsUpdating] = useState(false);

  // Group beads into columns
  const columns = useMemo(() => groupBeadsIntoColumns(beads), [beads]);

  // Find bead by ID
  const findBead = useCallback(
    (beadId: string) => beads.find((b) => b.id === beadId),
    [beads]
  );

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, bead: BeadInfo) => {
      const fromColumn = mapStatusToColumn(bead.status);
      setDragState({
        beadId: bead.id,
        fromColumn,
        overColumn: null,
      });
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDragState({
      beadId: null,
      fromColumn: null,
      overColumn: null,
    });
  }, []);

  const handleDragOver = useCallback(
    (_e: DragEvent<HTMLDivElement>, columnId: KanbanColumnId) => {
      setDragState((prev) => ({
        ...prev,
        overColumn: columnId,
      }));
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragState((prev) => ({
      ...prev,
      overColumn: null,
    }));
  }, []);

  const handleDrop = useCallback(
    async (_e: DragEvent<HTMLDivElement>, targetColumn: KanbanColumnId) => {
      const { beadId, fromColumn } = dragState;

      // Reset drag state immediately
      setDragState({
        beadId: null,
        fromColumn: null,
        overColumn: null,
      });

      // Validate drop
      if (!beadId || !fromColumn || fromColumn === targetColumn) {
        return;
      }

      const bead = findBead(beadId);
      if (!bead) return;

      // Optimistic update
      const previousStatus = bead.status;
      onBeadsChange((prev) =>
        prev.map((b) =>
          b.id === beadId ? { ...b, status: targetColumn } : b
        )
      );

      // API call
      setIsUpdating(true);
      try {
        await api.beads.update(beadId, targetColumn);
        onStatusUpdate?.(beadId, targetColumn);
      } catch (err) {
        // Rollback on error
        onBeadsChange((prev) =>
          prev.map((b) =>
            b.id === beadId ? { ...b, status: previousStatus } : b
          )
        );
        onError?.(err instanceof Error ? err : new Error('Failed to update status'), beadId);
      } finally {
        setIsUpdating(false);
      }
    },
    [dragState, findBead, onBeadsChange, onStatusUpdate, onError]
  );

  return {
    columns,
    dragState,
    isUpdating,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
