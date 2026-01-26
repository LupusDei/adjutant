/**
 * Kanban workflow types for the Beads board.
 */

import type { BeadInfo } from './index';

/**
 * Valid Kanban column IDs matching bead status values.
 * Workflow: backlog -> open -> in_progress -> testing -> merging -> complete -> closed
 */
export type KanbanColumnId =
  | 'backlog'
  | 'open'
  | 'in_progress'
  | 'testing'
  | 'merging'
  | 'complete'
  | 'closed';

/**
 * Column configuration for the Kanban board.
 */
export interface KanbanColumn {
  id: KanbanColumnId;
  title: string;
  beads: BeadInfo[];
  color: string;
}

/**
 * Column definitions in workflow order.
 */
export const KANBAN_COLUMNS: Array<{ id: KanbanColumnId; title: string; color: string }> = [
  { id: 'backlog', title: 'BACKLOG', color: '#666666' },
  { id: 'open', title: 'OPEN', color: '#00FF00' },
  { id: 'in_progress', title: 'IN PROGRESS', color: '#00FF88' },
  { id: 'testing', title: 'TESTING', color: '#FFB000' },
  { id: 'merging', title: 'MERGING', color: '#00BFFF' },
  { id: 'complete', title: 'COMPLETE', color: '#88FF88' },
  { id: 'closed', title: 'CLOSED', color: '#444444' },
];

/**
 * Maps legacy/alternative statuses to Kanban columns.
 * Used for beads that have statuses not directly matching column IDs.
 */
export function mapStatusToColumn(status: string): KanbanColumnId {
  const normalized = status.toLowerCase();

  // Direct matches
  if (KANBAN_COLUMNS.some(col => col.id === normalized)) {
    return normalized as KanbanColumnId;
  }

  // Map legacy/alternative statuses
  switch (normalized) {
    case 'hooked':
      return 'in_progress';
    case 'blocked':
      return 'in_progress'; // Blocked items stay visible in in_progress
    case 'deferred':
      return 'backlog'; // Deferred goes back to backlog
    default:
      return 'backlog'; // Unknown statuses default to backlog
  }
}

/**
 * Drag state for Kanban interactions.
 */
export interface KanbanDragState {
  /** Bead being dragged */
  beadId: string | null;
  /** Source column */
  fromColumn: KanbanColumnId | null;
  /** Target column (during hover) */
  overColumn: KanbanColumnId | null;
}
