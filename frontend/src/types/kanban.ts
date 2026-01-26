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
 * Maps bead statuses to Kanban columns.
 * Valid statuses: open, hooked, in_progress, blocked, closed
 */
export function mapStatusToColumn(status: string): KanbanColumnId {
  const normalized = status.toLowerCase();

  switch (normalized) {
    case 'open':
      return 'open';
    case 'hooked':
    case 'in_progress':
    case 'blocked':
      return 'in_progress';
    case 'closed':
      return 'closed';
    default:
      return 'open'; // Unknown statuses default to open
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
