import { BeadInfo } from './index';

/**
 * An epic bead - a container for related subtasks.
 * Epics have type: 'epic' and contain child beads via hierarchical IDs.
 */
export interface Epic extends BeadInfo {
  // type: 'epic' - inherited from BeadInfo
}

/**
 * An epic with calculated progress information.
 * Used for displaying epics in lists and dashboards.
 */
export interface EpicWithProgress {
  /** The epic bead */
  epic: Epic;
  /** Number of completed (closed) subtasks */
  completedCount: number;
  /** Total number of subtasks */
  totalCount: number;
  /** Progress as a decimal (0-1) */
  progress: number;
  /** Human-readable progress text (e.g., "3/5") */
  progressText: string;
  /** Whether all subtasks are complete */
  isComplete: boolean;
}

/**
 * A subtask that belongs to an epic.
 * Subtasks are linked to their parent epic via hierarchical IDs (parent.X)
 * or via labels containing parent:{epicId}.
 */
export interface EpicSubtask extends BeadInfo {
  // Subtasks linked via hierarchical ID pattern (epicId.1, epicId.2, etc.)
  // or via labels containing parent:{epicId}
}
