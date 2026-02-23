/**
 * KanbanBoard - 7-column Kanban board for beads workflow.
 * Handles drag-and-drop with optimistic updates.
 */

import { type CSSProperties, useCallback, useState } from 'react';
import { KanbanColumn } from './KanbanColumn';
import { useKanban } from '../../hooks/useKanban';
import type { BeadInfo } from '../../types';

export interface KanbanBoardProps {
  beads: BeadInfo[];
  onBeadsChange: (updater: (prev: BeadInfo[]) => BeadInfo[]) => void;
  onBeadClick?: (bead: BeadInfo) => void;
}

export function KanbanBoard({ beads, onBeadsChange, onBeadClick }: KanbanBoardProps) {
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((err: Error, beadId: string) => {
    setError(`Failed to update ${beadId}: ${err.message}`);
    setTimeout(() => { setError(null); }, 3000);
  }, []);

  const {
    columns,
    dragState,
    isUpdating,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useKanban(beads, onBeadsChange, {
    onError: handleError,
  });

  return (
    <div style={styles.container}>
      {/* Error Toast */}
      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      {/* Updating Indicator */}
      {isUpdating && (
        <div style={styles.updating}>
          UPDATING...
        </div>
      )}

      {/* Columns */}
      <div style={styles.board}>
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            id={column.id}
            title={column.title}
            color={column.color}
            beads={column.beads}
            draggingBeadId={dragState.beadId}
            isDropTarget={dragState.overColumn === column.id && dragState.fromColumn !== column.id}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onBeadClick={onBeadClick}
          />
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  },
  board: {
    flex: 1,
    display: 'flex',
    gap: '8px',
    padding: '8px',
    overflowX: 'auto',
    overflowY: 'hidden',
  },
  error: {
    position: 'absolute',
    top: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(255, 68, 68, 0.9)',
    color: '#fff',
    padding: '8px 16px',
    borderRadius: '4px',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    zIndex: 100,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
  },
  updating: {
    position: 'absolute',
    top: '8px',
    right: '16px',
    color: 'var(--crt-phosphor)',
    fontSize: '0.7rem',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
    zIndex: 100,
  },
} satisfies Record<string, CSSProperties>;
