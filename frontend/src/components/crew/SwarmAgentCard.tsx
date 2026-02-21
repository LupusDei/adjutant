import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { CrewMember } from '../../types';

/** Format ISO timestamp as relative time (e.g., "2m ago", "just now"). */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  return `${days}d ago`;
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryBright: 'var(--crt-phosphor-bright)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  backgroundDark: '#050505',
  panelBorder: 'var(--crt-phosphor-dim)',
  offlineBorder: '#333333',
  working: 'var(--crt-phosphor-bright)',
  idle: 'var(--crt-phosphor)',
  blocked: '#FFB000',
  stuck: '#FF4444',
  offline: '#666666',
} as const;

function getStatusColor(status: string): string {
  switch (status) {
    case 'working':
    case 'active':
      return colors.working;
    case 'idle':
      return colors.idle;
    case 'blocked':
      return colors.blocked;
    case 'stuck':
      return colors.stuck;
    case 'offline':
      return colors.offline;
    default:
      return colors.idle;
  }
}

interface SwarmAgentCardProps {
  agent: CrewMember;
}

/**
 * Rich agent card for swarm mode.
 * Shows status, current task, branch, last activity, mail preview, and worktree.
 */
export function SwarmAgentCard({ agent }: SwarmAgentCardProps) {
  const isOnline = agent.status !== 'offline';
  const isActive = agent.currentTask && agent.status === 'idle';
  const displayStatus = isActive ? 'active' : agent.status;
  const statusColor = getStatusColor(displayStatus);
  const isWorking = displayStatus === 'working' || displayStatus === 'active';

  const relativeTime = useMemo(() => {
    if (!agent.lastActivity) return null;
    return formatRelativeTime(agent.lastActivity);
  }, [agent.lastActivity]);

  const hasFooter = relativeTime || agent.worktreePath || agent.progress;

  return (
    <div
      style={{
        ...styles.card,
        borderColor: isOnline ? colors.panelBorder : colors.offlineBorder,
        boxShadow: isWorking
          ? `0 0 12px ${colors.primaryGlow}, inset 0 0 6px ${colors.primaryGlow}`
          : 'none',
        opacity: isOnline ? 1 : 0.6,
      }}
      role="listitem"
      aria-label={`${agent.name} - ${displayStatus}`}
    >
      {/* Header: status dot + name + badges */}
      <div style={styles.header}>
        <span
          className={isActive ? 'pulsate' : ''}
          style={{
            ...styles.statusDot,
            backgroundColor: statusColor,
            boxShadow: isOnline ? `0 0 8px ${statusColor}` : 'none',
          }}
        />
        <span style={styles.name}>{agent.name.toUpperCase()}</span>
        <span style={{ ...styles.statusLabel, color: statusColor }}>
          {displayStatus.toUpperCase()}
        </span>
        {agent.isCoordinator && (
          <span style={styles.coordinatorBadge}>COORD</span>
        )}
        {agent.unreadMail > 0 && (
          <span style={styles.mailBadge}>📬{agent.unreadMail}</span>
        )}
      </div>

      {/* Current task — shown prominently */}
      {agent.currentTask && (
        <div style={styles.taskRow}>
          <span style={styles.rowIcon}>⚡</span>
          <span style={styles.taskText}>{agent.currentTask}</span>
        </div>
      )}

      {/* Branch */}
      {agent.branch && (
        <div style={styles.detailRow}>
          <span style={styles.rowIcon}>⎇</span>
          <span style={styles.detailText}>{agent.branch}</span>
        </div>
      )}

      {/* Mail preview */}
      {agent.firstSubject && (
        <div style={styles.detailRow}>
          <span style={styles.rowIcon}>📨</span>
          <span style={styles.mailPreview}>
            "{agent.firstSubject}"{agent.firstFrom && ` from ${agent.firstFrom}`}
          </span>
        </div>
      )}

      {/* Footer: last activity, worktree, progress */}
      {hasFooter && (
        <div style={styles.footer}>
          {relativeTime && (
            <span style={styles.footerItem}>◷ {relativeTime}</span>
          )}
          {agent.worktreePath && (
            <span style={styles.footerItem} title={agent.worktreePath}>
              📁 {agent.worktreePath.split('/').slice(-2).join('/')}
            </span>
          )}
          {agent.progress && (
            <span style={styles.footerItem}>
              {agent.progress.completed}/{agent.progress.total} tasks
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  card: {
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.backgroundDark,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
    transition: 'border-color 0.2s ease, box-shadow 0.3s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'all 0.2s ease',
  },
  name: {
    fontSize: '0.9rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusLabel: {
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    flexShrink: 0,
  },
  coordinatorBadge: {
    fontSize: '0.55rem',
    border: `1px solid ${colors.primaryDim}`,
    padding: '1px 4px',
    letterSpacing: '0.05em',
    color: colors.primaryBright,
    flexShrink: 0,
  },
  mailBadge: {
    fontSize: '0.75rem',
    color: colors.primaryBright,
    fontWeight: 'bold',
    flexShrink: 0,
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.8rem',
    color: colors.primaryBright,
  },
  rowIcon: {
    fontSize: '0.75rem',
    flexShrink: 0,
    width: '16px',
    textAlign: 'center',
  },
  taskText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 'bold',
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.7rem',
    color: colors.primaryDim,
  },
  detailText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
    fontSize: '0.65rem',
  },
  mailPreview: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontStyle: 'italic',
    fontSize: '0.65rem',
  },
  footer: {
    display: 'flex',
    gap: '12px',
    fontSize: '0.6rem',
    color: colors.primaryDim,
    borderTop: `1px solid ${colors.offlineBorder}`,
    paddingTop: '6px',
    marginTop: '2px',
    flexWrap: 'wrap',
  },
  footerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
} satisfies Record<string, CSSProperties>;
