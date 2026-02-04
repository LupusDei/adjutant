import type { CSSProperties } from 'react';
import type { EpicWithProgress } from '../../types/epics';

interface EpicCardProps {
  epic: EpicWithProgress;
  onClick?: () => void;
}

/**
 * Get progress bar color based on completion percentage and status.
 */
function getProgressColor(progress: number, isComplete: boolean): string {
  if (isComplete) {
    return '#00FF00'; // Success green
  } else if (progress > 0.5) {
    return 'var(--crt-phosphor)';
  } else if (progress > 0) {
    return '#FFB000'; // Warning amber
  }
  return 'var(--crt-phosphor-dim)';
}

/**
 * Get status display info.
 */
function getStatusInfo(status: string, isComplete: boolean): { label: string; color: string } {
  if (isComplete) {
    return { label: 'COMPLETE', color: '#00FF00' };
  }
  switch (status) {
    case 'in_progress':
      return { label: 'IN PROGRESS', color: 'var(--crt-phosphor)' };
    case 'closed':
      return { label: 'CLOSED', color: '#00FF00' };
    case 'blocked':
      return { label: 'BLOCKED', color: '#FF4444' };
    default:
      return { label: status.toUpperCase(), color: 'var(--crt-phosphor-dim)' };
  }
}

/**
 * Display a single epic with its progress.
 */
export function EpicCard({ epic, onClick }: EpicCardProps) {
  const progressPercent = Math.round(epic.progress * 100);
  const progressColor = getProgressColor(epic.progress, epic.isComplete);
  const statusInfo = getStatusInfo(epic.epic.status, epic.isComplete);

  const cardStyle = onClick
    ? { ...styles.card, ...styles.cardClickable }
    : styles.card;

  return (
    <div
      style={cardStyle}
      className={onClick ? 'epic-card-clickable' : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div style={styles.header}>
        <span style={styles.id}>{epic.epic.id.toUpperCase()}</span>
        <span
          style={{
            ...styles.status,
            color: statusInfo.color,
            borderColor: statusInfo.color,
            backgroundColor: `${statusInfo.color}15`,
          }}
        >
          {statusInfo.label}
        </span>
      </div>

      <div style={styles.title}>{epic.epic.title}</div>

      {epic.epic.rig && (
        <div style={styles.rigRow}>
          <span style={styles.rigBadge}>{epic.epic.rig.toUpperCase()}</span>
        </div>
      )}

      <div style={styles.progressSection}>
        <div style={styles.progressBar}>
          <div
            style={{
              ...styles.progressFill,
              width: `${progressPercent}%`,
              backgroundColor: progressColor,
              boxShadow: `0 0 6px ${progressColor}`,
            }}
          />
        </div>
        <span style={styles.progressText}>
          {epic.progressText} ({progressPercent}%)
        </span>
      </div>

      {onClick && <span style={styles.chevron}>&gt;</span>}
    </div>
  );
}

const styles = {
  card: {
    position: 'relative',
    backgroundColor: 'rgba(0, 255, 0, 0.03)',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
    padding: '12px',
    fontFamily: '"Share Tech Mono", monospace',
    transition: 'border-color 0.2s, background-color 0.2s',
  },
  cardClickable: {
    cursor: 'pointer',
    paddingRight: '28px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  id: {
    fontSize: '11px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
  },
  status: {
    fontSize: '10px',
    padding: '2px 6px',
    border: '1px solid',
    borderRadius: '2px',
    letterSpacing: '0.05em',
  },
  title: {
    fontSize: '13px',
    color: 'var(--crt-phosphor)',
    marginBottom: '8px',
    lineHeight: 1.3,
  },
  rigRow: {
    marginBottom: '8px',
  },
  rigBadge: {
    fontSize: '10px',
    color: 'var(--crt-phosphor)',
    padding: '2px 6px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
    letterSpacing: '0.05em',
  },
  progressSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  progressBar: {
    flex: 1,
    height: '8px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s',
  },
  progressText: {
    fontSize: '10px',
    color: 'var(--crt-phosphor-dim)',
    whiteSpace: 'nowrap',
    minWidth: '70px',
    textAlign: 'right',
  },
  chevron: {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '14px',
  },
} satisfies Record<string, CSSProperties>;
