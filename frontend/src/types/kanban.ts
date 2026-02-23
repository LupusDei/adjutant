/**
 * Kanban workflow types for the Beads board.
 */

import type { BeadInfo } from './index';

/**
 * Valid Kanban column IDs matching bead status values.
 * Workflow: open -> hooked -> in_progress -> closed -> blocked
 */
export type KanbanColumnId =
  | 'open'
  | 'hooked'
  | 'in_progress'
  | 'blocked'
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
  { id: 'blocked', title: 'BLOCKED', color: '#FF6B35' },
];

/**
 * Column definitions for Swarm mode (no HOOKED column).
 * Hooked beads are mapped to IN PROGRESS.
 */
export const KANBAN_COLUMNS_SWARM: { id: KanbanColumnId; title: string; color: string }[] = [
  { id: 'open', title: 'OPEN', color: '#00FF00' },
  { id: 'in_progress', title: 'IN PROGRESS', color: '#00FF88' },
  { id: 'closed', title: 'CLOSED', color: '#444444' },
  { id: 'blocked', title: 'BLOCKED', color: '#FF6B35' },
];

/**
 * Returns the appropriate column definitions based on mode.
 */
export function getKanbanColumns(isSwarm: boolean): { id: KanbanColumnId; title: string; color: string }[] {
  return isSwarm ? KANBAN_COLUMNS_SWARM : KANBAN_COLUMNS;
}

/**
 * Maps bead statuses to Kanban columns.
 * In Swarm mode, hooked maps to in_progress.
 */
export function mapStatusToColumn(status: string, isSwarm = false): KanbanColumnId {
  const normalized = status.toLowerCase();

  switch (normalized) {
    case 'open':
      return 'open';
    case 'hooked':
      return isSwarm ? 'in_progress' : 'hooked';
    case 'in_progress':
      return 'in_progress';
    case 'blocked':
      return 'blocked';
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
