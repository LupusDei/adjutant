import type { CSSProperties } from 'react';
import type { EpicWithProgress } from '../../types/epics';

interface EpicCardProps {
  epic: EpicWithProgress;
}

/**
 * Display a single epic with its progress.
 */
export function EpicCard({ epic }: EpicCardProps) {
  const progressPercent = Math.round(epic.progress * 100);

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.id}>{epic.epic.id.toUpperCase()}</span>
        <span style={styles.status}>{epic.epic.status.toUpperCase()}</span>
      </div>
      <div style={styles.title}>{epic.epic.title}</div>

      <div style={styles.progressSection}>
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${progressPercent}%` }} />
        </div>
        <span style={styles.progressText}>
          {epic.progressText} ({progressPercent}%)
        </span>
      </div>
    </div>
  );
}

const styles = {
  card: {
    backgroundColor: 'rgba(0, 255, 0, 0.03)',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
    padding: '12px',
    fontFamily: '"Share Tech Mono", monospace',
    transition: 'border-color 0.2s',
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
    color: 'var(--crt-phosphor)',
    padding: '2px 6px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderRadius: '2px',
    letterSpacing: '0.05em',
  },
  title: {
    fontSize: '13px',
    color: 'var(--crt-phosphor)',
    marginBottom: '10px',
    lineHeight: 1.3,
  },
  progressSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  progressBar: {
    flex: 1,
    height: '6px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderRadius: '1px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--crt-phosphor)',
    transition: 'width 0.3s',
  },
  progressText: {
    fontSize: '10px',
    color: 'var(--crt-phosphor-dim)',
    whiteSpace: 'nowrap',
    minWidth: '70px',
    textAlign: 'right',
  },
} satisfies Record<string, CSSProperties>;
