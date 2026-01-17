import type { CSSProperties } from 'react';
import type { Convoy, TrackedIssue } from '../../types';

interface ConvoyCardProps {
  convoy: Convoy;
}

/**
 * Display a single convoy with its progress and tracked issues.
 */
export function ConvoyCard({ convoy }: ConvoyCardProps) {
  const progress = convoy.progress.total > 0
    ? Math.round((convoy.progress.completed / convoy.progress.total) * 100)
    : 100;

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.id}>{convoy.id.toUpperCase()}</span>
        <span style={styles.status}>{convoy.status.toUpperCase()}</span>
      </div>
      <div style={styles.title}>{convoy.title}</div>

      <div style={styles.progressSection}>
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${progress}%` }} />
        </div>
        <span style={styles.progressText}>
          {convoy.progress.completed}/{convoy.progress.total} ({progress}%)
        </span>
      </div>

      {convoy.trackedIssues.length > 0 && (
        <div style={styles.issuesList}>
          {convoy.trackedIssues.slice(0, 3).map((issue: TrackedIssue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
          {convoy.trackedIssues.length > 3 && (
            <div style={styles.moreIssues}>
              +{convoy.trackedIssues.length - 3} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: TrackedIssue }) {
  const statusColor = getStatusColor(issue.status);

  return (
    <div style={styles.issueRow}>
      <span style={{ ...styles.issueStatus, color: statusColor }}>
        [{issue.status.toUpperCase().slice(0, 4)}]
      </span>
      <span style={styles.issueId}>{issue.id}</span>
      <span style={styles.issueTitle}>{issue.title}</span>
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'open':
      return 'var(--crt-phosphor)';
    case 'in_progress':
    case 'in-progress':
      return 'var(--crt-phosphor-bright)';
    case 'closed':
    case 'done':
      return 'var(--crt-phosphor-dim)';
    case 'blocked':
      return '#FF4444';
    default:
      return 'var(--crt-phosphor)';
  }
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
    marginBottom: '10px',
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
  issuesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    borderTop: '1px solid rgba(0, 255, 0, 0.1)',
    paddingTop: '8px',
  },
  issueRow: {
    display: 'flex',
    gap: '8px',
    fontSize: '11px',
    alignItems: 'center',
  },
  issueStatus: {
    fontSize: '9px',
    fontWeight: 600,
    minWidth: '50px',
  },
  issueId: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '10px',
    minWidth: '60px',
  },
  issueTitle: {
    color: 'var(--crt-phosphor)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  moreIssues: {
    fontSize: '10px',
    color: 'var(--crt-phosphor-dim)',
    textAlign: 'center',
    paddingTop: '4px',
  },
} satisfies Record<string, CSSProperties>;
