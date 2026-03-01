/**
 * Kanban workflow types for the Beads board.
 */

import type { BeadInfo } from './index';

/**
 * Valid Kanban column IDs matching bead status values.
 * Workflow: open -> hooked -> in_progress -> closed
 */
export type KanbanColumnId =
  | 'open'
  | 'hooked'
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
 * All column definitions in workflow order (Gastown mode).
 */
export const KANBAN_COLUMNS: { id: KanbanColumnId; title: string; color: string }[] = [
  { id: 'open', title: 'OPEN', color: '#00FF00' },
  { id: 'hooked', title: 'HOOKED', color: '#00FFFF' },
  { id: 'in_progress', title: 'IN PROGRESS', color: '#00FF88' },
  { id: 'closed', title: 'CLOSED', color: '#444444' },
];

/**
 * Returns the Kanban column definitions.
 * Hooked beads are mapped to IN PROGRESS (no separate HOOKED column).
 */
export function getKanbanColumns(): { id: KanbanColumnId; title: string; color: string }[] {
  return [
    { id: 'open', title: 'OPEN', color: '#00FF00' },
    { id: 'in_progress', title: 'IN PROGRESS', color: '#00FF88' },
    { id: 'closed', title: 'CLOSED', color: '#444444' },
  ];
}

/**
 * Maps bead statuses to Kanban columns.
 * Hooked beads are mapped to in_progress.
 */
export function mapStatusToColumn(status: string): KanbanColumnId {
  const normalized = status.toLowerCase();

  switch (normalized) {
    case 'open':
      return 'open';
    case 'hooked':
    case 'in_progress':
      return 'in_progress';
    case 'closed':
      return 'closed';
    default:
      return 'open';
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
