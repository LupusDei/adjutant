/**
 * KanbanColumn - Drop zone column for Kanban board.
 * Shows column header with count and scrollable card list.
 */

import { type CSSProperties, type DragEvent, useCallback } from 'react';
import { KanbanCard } from './KanbanCard';
import type { BeadInfo, KanbanColumnId } from '../../types';

export interface KanbanColumnProps {
  id: KanbanColumnId;
  title: string;
  color: string;
  beads: BeadInfo[];
  draggingBeadId: string | null;
  isDropTarget: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>, bead: BeadInfo) => void;
  onDragEnd: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, columnId: KanbanColumnId) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, columnId: KanbanColumnId) => void;
  onBeadClick?: ((bead: BeadInfo) => void) | undefined;
  onAssign?: ((beadId: string, agentName: string) => void) | undefined;
}

export function KanbanColumn({
  id,
  title,
  color,
  beads,
  draggingBeadId,
  isDropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onBeadClick,
  onAssign,
}: KanbanColumnProps) {
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragOver(e, id);
  }, [id, onDragOver]);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    onDrop(e, id);
  }, [id, onDrop]);

  const columnStyle: CSSProperties = {
    ...styles.column,
    borderColor: isDropTarget ? color : 'var(--crt-phosphor-dim)',
    boxShadow: isDropTarget ? `0 0 8px ${color}40` : 'none',
  };

  const headerStyle: CSSProperties = {
    ...styles.header,
    borderBottomColor: color,
  };

  const titleStyle: CSSProperties = {
    ...styles.title,
    color,
  };

  return (
    <div
      style={columnStyle}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div style={headerStyle}>
        <span style={titleStyle}>{title}</span>
        <span style={styles.count}>{beads.length}</span>
      </div>

      {/* Cards Container */}
      <div style={styles.cards}>
        {beads.length === 0 ? (
          <div style={styles.empty}>
            {isDropTarget ? 'DROP HERE' : 'EMPTY'}
          </div>
        ) : (
          beads.map((bead) => (
            <KanbanCard
              key={bead.id}
              bead={bead}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onClick={onBeadClick}
              onAssign={onAssign}
              isDragging={draggingBeadId === bead.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

const styles = {
  column: {
    flex: '1 1 0',
    minWidth: '140px',
    backgroundColor: '#0A0A0A',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
    display: 'flex',
    flexDirection: 'column',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  },
  header: {
    padding: '8px',
    borderBottom: '2px solid',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '0.7rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    fontFamily: '"Share Tech Mono", monospace',
  },
  count: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
  },
  cards: {
    flex: 1,
    padding: '6px',
    overflowY: 'auto',
    minHeight: '100px',
  },
  empty: {
    textAlign: 'center',
    padding: '16px 8px',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    fontFamily: '"Share Tech Mono", monospace',
  },
} satisfies Record<string, CSSProperties>;
