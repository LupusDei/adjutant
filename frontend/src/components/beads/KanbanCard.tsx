/**
 * KanbanCard - Draggable bead card for Kanban board.
 * Pip-Boy terminal aesthetic with HTML5 drag events.
 */

import { type CSSProperties, type DragEvent, useCallback } from 'react';
import type { BeadInfo } from '../../types';

export interface KanbanCardProps {
  bead: BeadInfo;
  onDragStart: (e: DragEvent<HTMLDivElement>, bead: BeadInfo) => void;
  onDragEnd: (e: DragEvent<HTMLDivElement>) => void;
  onClick?: (bead: BeadInfo) => void;
  isDragging?: boolean;
}

/**
 * Gets priority display info.
 */
function getPriorityInfo(priority: number): { label: string; color: string } {
  switch (priority) {
    case 0:
      return { label: 'P0', color: '#FF4444' };
    case 1:
      return { label: 'P1', color: '#FFB000' };
    case 2:
      return { label: 'P2', color: 'var(--crt-phosphor)' };
    case 3:
      return { label: 'P3', color: 'var(--crt-phosphor-dim)' };
    case 4:
      return { label: 'P4', color: '#666666' };
    default:
      return { label: `P${priority}`, color: 'var(--crt-phosphor-dim)' };
  }
}

/**
 * Extracts short assignee name.
 */
function formatAssignee(assignee: string | null): string | null {
  if (!assignee) return null;
  const parts = assignee.split('/');
  return parts[parts.length - 1] ?? assignee;
}

export function KanbanCard({ bead, onDragStart, onDragEnd, onClick, isDragging = false }: KanbanCardProps) {
  const priorityInfo = getPriorityInfo(bead.priority);
  const assignee = formatAssignee(bead.assignee);

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', bead.id);
    onDragStart(e, bead);
  }, [bead, onDragStart]);

  const handleClick = useCallback(() => {
    onClick?.(bead);
  }, [bead, onClick]);

  const cardStyle: CSSProperties = {
    ...styles.card,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? '0 0 10px var(--crt-phosphor)' : 'none',
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      style={cardStyle}
    >
      {/* Header: ID + Priority */}
      <div style={styles.header}>
        <span style={styles.id}>{bead.id}</span>
        <span style={{ ...styles.priority, color: priorityInfo.color }}>
          {priorityInfo.label}
        </span>
      </div>

      {/* Title */}
      <div style={styles.title} title={bead.title}>
        {bead.title}
      </div>

      {/* Footer: Type + Assignee */}
      <div style={styles.footer}>
        <span style={styles.type}>{bead.type.toUpperCase()}</span>
        {assignee && <span style={styles.assignee}>{assignee}</span>}
      </div>
    </div>
  );
}

const styles = {
  card: {
    backgroundColor: '#111',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
    padding: '8px',
    marginBottom: '6px',
    cursor: 'grab',
    transition: 'all 0.15s ease',
    fontFamily: '"Share Tech Mono", monospace',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  id: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-bright)',
    fontWeight: 'bold',
    letterSpacing: '0.05em',
  },
  priority: {
    fontSize: '0.65rem',
    fontWeight: 'bold',
  },
  title: {
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor)',
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    marginBottom: '6px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.6rem',
  },
  type: {
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.05em',
  },
  assignee: {
    color: 'var(--crt-phosphor)',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    padding: '1px 4px',
    borderRadius: '2px',
  },
} satisfies Record<string, CSSProperties>;
