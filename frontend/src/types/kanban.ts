/**
 * Kanban workflow types for the Beads board.
 */

import type { BeadInfo } from './index';

/**
 * Valid Kanban column IDs matching bead status values.
 * Simplified workflow: open -> in_progress -> closed
 */
export type KanbanColumnId =
  | 'open'
  | 'in_progress'
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
  { id: 'open', title: 'OPEN', color: '#00FF00' },
  { id: 'in_progress', title: 'IN PROGRESS', color: '#00FF88' },
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

  // Map legacy/alternative statuses to the 3 columns
  switch (normalized) {
    case 'hooked':
    case 'blocked':
    case 'testing':
    case 'merging':
      return 'in_progress'; // All active work goes to in_progress
    case 'complete':
      return 'closed'; // Complete maps to closed
    case 'backlog':
    case 'deferred':
    default:
      return 'open'; // Backlog, deferred, and unknown go to open
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
