/**
 * useKanban - Hook for Kanban board state management.
 * Handles bead grouping, drag state, API calls, and optimistic updates.
 */

import { useState, useCallback, useMemo, type DragEvent } from 'react';
import { api } from '../services/api';
import type { BeadInfo, KanbanColumnId, KanbanColumn, KanbanDragState } from '../types';
import { getKanbanColumns, mapStatusToColumn } from '../types/kanban';
import { useMode } from '../contexts/ModeContext';

export interface UseKanbanOptions {
  /** Called after successful status update */
  onStatusUpdate?: (beadId: string, newStatus: KanbanColumnId) => void;
  /** Called on update error */
  onError?: (error: Error, beadId: string) => void;
  /**
   * Called when a bead is dropped on in_progress and has no assignee.
   * Should return an agent name to assign, or null to cancel the drop.
   */
  onAssignRequest?: ((beadId: string, targetColumn: KanbanColumnId) => Promise<string | null>) | undefined;
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
 * In Swarm mode, hooked beads are mapped to in_progress.
 */
function groupBeadsIntoColumns(beads: BeadInfo[], isSwarm: boolean): KanbanColumn[] {
  const columns = getKanbanColumns(isSwarm);

  // Initialize columns with empty bead arrays
  const columnMap = new Map<KanbanColumnId, BeadInfo[]>();
  for (const col of columns) {
    columnMap.set(col.id, []);
  }

  // Group beads by status
  for (const bead of beads) {
    const columnId = mapStatusToColumn(bead.status, isSwarm);
    const column = columnMap.get(columnId);
    if (column) {
      column.push(bead);
    }
  }

  // Build column objects
  return columns.map((col) => ({
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
  const { onStatusUpdate, onError, onAssignRequest } = options;
  const { isSwarm } = useMode();

  const [dragState, setDragState] = useState<KanbanDragState>({
    beadId: null,
    fromColumn: null,
    overColumn: null,
  });

  const [isUpdating, setIsUpdating] = useState(false);

  // Group beads into columns (swarm mode hides HOOKED column)
  const columns = useMemo(() => groupBeadsIntoColumns(beads, isSwarm), [beads, isSwarm]);

  // Find bead by ID
  const findBead = useCallback(
    (beadId: string) => beads.find((b) => b.id === beadId),
    [beads]
  );

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, bead: BeadInfo) => {
      const fromColumn = mapStatusToColumn(bead.status, isSwarm);
      setDragState({
        beadId: bead.id,
        fromColumn,
        overColumn: null,
      });
    },
    [isSwarm]
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

      // If dropping to in_progress and bead has no assignee, request assignment
      if (targetColumn === 'in_progress' && !bead.assignee && onAssignRequest) {
        const assignee = await onAssignRequest(beadId, targetColumn);
        if (!assignee) return; // User cancelled — abort the drop

        // Optimistic update with both status and assignee
        const previousStatus = bead.status;
        const previousAssignee = bead.assignee;
        onBeadsChange((prev) =>
          prev.map((b) =>
            b.id === beadId ? { ...b, status: targetColumn, assignee } : b
          )
        );

        setIsUpdating(true);
        try {
          await api.beads.update(beadId, { status: targetColumn, assignee });
          onStatusUpdate?.(beadId, targetColumn);
        } catch (err) {
          onBeadsChange((prev) =>
            prev.map((b) =>
              b.id === beadId ? { ...b, status: previousStatus, assignee: previousAssignee } : b
            )
          );
          onError?.(err instanceof Error ? err : new Error('Failed to update status'), beadId);
        } finally {
          setIsUpdating(false);
        }
        return;
      }

      // Standard drop: optimistic update, then API call
      const previousStatus = bead.status;
      onBeadsChange((prev) =>
        prev.map((b) =>
          b.id === beadId ? { ...b, status: targetColumn } : b
        )
      );

      setIsUpdating(true);
      try {
        await api.beads.update(beadId, { status: targetColumn });
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
    [dragState, findBead, onBeadsChange, onStatusUpdate, onError, onAssignRequest]
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
