/**
 * TimelineEventCard - Individual event card in the timeline.
 *
 * Displays timestamp, agent name, event type badge, action text,
 * and an expandable detail section for the raw JSON payload.
 */

import { useState, useCallback, type CSSProperties } from 'react';

import type { TimelineEvent } from '../../services/api';

const EVENT_TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  status_change: { icon: '\u{1F504}', label: 'STATUS', color: 'var(--crt-phosphor)' },
  progress_report: { icon: '\u{1F4CA}', label: 'PROGRESS', color: 'var(--crt-phosphor)' },
  announcement: { icon: '\u{1F4E2}', label: 'ANNOUNCE', color: '#ffaa00' },
  message_sent: { icon: '\u{1F4AC}', label: 'MESSAGE', color: 'var(--crt-phosphor)' },
  bead_updated: { icon: '\u{1F4DD}', label: 'BEAD UPD', color: 'var(--crt-phosphor)' },
  bead_closed: { icon: '\u2705', label: 'CLOSED', color: '#44ff44' },
  coordinator_action: { icon: '\u{1F4BB}', label: 'COORD', color: '#ffcc00' },
  auto_develop_enabled: { icon: '\u25B6', label: 'AUTO-DEV ON', color: '#44ff44' },
  auto_develop_disabled: { icon: '\u23F9', label: 'AUTO-DEV OFF', color: '#ff4444' },
  auto_develop_phase_changed: { icon: '\u27A1', label: 'PHASE', color: '#66ccff' },
  proposal_completed: { icon: '\u2714', label: 'PROPOSAL DONE', color: '#44ff44' },
  deploy_status: { icon: '\u{1F680}', label: 'DEPLOY', color: '#66ccff' },
};

const DEPLOY_STATUS_COLOR: Record<string, string> = {
  created: '#66ccff',
  succeeded: '#44ff44',
  error: '#ff4444',
  canceled: '#999999',
};

export interface TimelineEventCardProps {
  event: TimelineEvent;
  isNew?: boolean;
}

export function TimelineEventCard({ event, isNew }: TimelineEventCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const isCoordAction = event.eventType === 'coordinator_action';
  const isDeployStatus = event.eventType === 'deploy_status';
  const baseConfig = EVENT_TYPE_CONFIG[event.eventType] ?? {
    icon: '\u{1F50D}',
    label: event.eventType.toUpperCase(),
    color: 'var(--crt-phosphor-dim)',
  };
  const deployStatus = isDeployStatus ? String(event.detail?.status ?? '') : '';
  const config = isDeployStatus && DEPLOY_STATUS_COLOR[deployStatus]
    ? { ...baseConfig, color: DEPLOY_STATUS_COLOR[deployStatus] }
    : baseConfig;

  const timestamp = formatTime(event.createdAt);
  const hasDetail = event.detail && Object.keys(event.detail).length > 0;

  return (
    <div
      style={{
        ...styles.card,
        ...(isNew ? styles.cardNew : {}),
      }}
      onClick={hasDetail ? toggleExpand : undefined}
      role={hasDetail ? 'button' : undefined}
      tabIndex={hasDetail ? 0 : undefined}
      onKeyDown={hasDetail ? (e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(); } : undefined}
    >
      <div style={styles.row}>
        {/* Timestamp */}
        <span style={styles.timestamp}>{timestamp}</span>

        {/* Agent */}
        <span style={styles.agent}>{event.agentId}</span>

        {/* Event type badge */}
        <span style={{ ...styles.badge, borderColor: config.color, color: config.color }}>
          {config.icon} {config.label}
        </span>

        {/* Action text */}
        <span style={{
          ...styles.action,
          ...(isCoordAction ? { color: '#ffcc00' } : {}),
        }}>
          {isCoordAction ? '>> ' : ''}{event.action}
        </span>

        {/* Bead tag */}
        {event.beadId && (
          <span style={styles.beadTag}>{event.beadId}</span>
        )}

        {/* Expand indicator */}
        {hasDetail && (
          <span style={styles.expandIcon}>{expanded ? '\u25BC' : '\u25B6'}</span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div style={styles.detail}>
          {isCoordAction && event.detail ? (
            <div style={styles.coordDetail}>
              {event.detail.behavior && (
                <div style={styles.coordField}>
                  <span style={styles.coordLabel}>BEHAVIOR:</span>{' '}
                  <span style={styles.coordValue}>{String(event.detail.behavior)}</span>
                </div>
              )}
              {event.detail.target && (
                <div style={styles.coordField}>
                  <span style={styles.coordLabel}>TARGET:</span>{' '}
                  <span style={styles.coordValue}>{String(event.detail.target)}</span>
                </div>
              )}
              {event.detail.reason && (
                <div style={styles.coordField}>
                  <span style={styles.coordLabel}>REASON:</span>{' '}
                  <span style={styles.coordReason}>{String(event.detail.reason)}</span>
                </div>
              )}
            </div>
          ) : isDeployStatus && event.detail ? (
            <DeployStatusDetail detail={event.detail} statusColor={config.color} />
          ) : (
            <pre style={styles.detailPre}>
              {JSON.stringify(event.detail, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

interface DeployStatusDetailProps {
  detail: Record<string, unknown>;
  statusColor: string;
}

function DeployStatusDetail({ detail, statusColor }: DeployStatusDetailProps) {
  const status = String(detail.status ?? '').toUpperCase() || 'UNKNOWN';
  const projectName = detail.projectName ? String(detail.projectName) : null;
  const environment = detail.environment ? String(detail.environment) : null;
  const deployUrl = detail.deployUrl ? String(detail.deployUrl) : null;
  const inspectorUrl = detail.inspectorUrl ? String(detail.inspectorUrl) : null;
  const commitShaShort = detail.commitShaShort ? String(detail.commitShaShort) : null;
  const commitUrl = detail.commitUrl ? String(detail.commitUrl) : null;

  return (
    <div style={styles.deployDetail}>
      <div style={styles.deployRow}>
        <span style={styles.deployLabel}>STATUS:</span>{' '}
        <span style={{ ...styles.deployValue, color: statusColor }}>{status}</span>
      </div>
      {projectName && (
        <div style={styles.deployRow}>
          <span style={styles.deployLabel}>PROJECT:</span>{' '}
          <span style={styles.deployValue}>{projectName}</span>
        </div>
      )}
      {environment && (
        <div style={styles.deployRow}>
          <span style={styles.deployLabel}>ENV:</span>{' '}
          <span style={styles.deployValue}>{environment}</span>
        </div>
      )}
      {commitShaShort && (
        <div style={styles.deployRow}>
          <span style={styles.deployLabel}>COMMIT:</span>{' '}
          {commitUrl ? (
            <a href={commitUrl} target="_blank" rel="noopener noreferrer" style={styles.deployLink}>
              {commitShaShort}
            </a>
          ) : (
            <span style={styles.deployValue}>{commitShaShort}</span>
          )}
        </div>
      )}
      {deployUrl && (
        <div style={styles.deployRow}>
          <span style={styles.deployLabel}>URL:</span>{' '}
          <a href={deployUrl} target="_blank" rel="noopener noreferrer" style={styles.deployLink}>
            {deployUrl}
          </a>
        </div>
      )}
      {inspectorUrl && (
        <div style={styles.deployRow}>
          <span style={styles.deployLabel}>INSPECT:</span>{' '}
          <a href={inspectorUrl} target="_blank" rel="noopener noreferrer" style={styles.deployLink}>
            vercel
          </a>
        </div>
      )}
    </div>
  );
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '??:??:??';
  }
}

const styles = {
  card: {
    padding: '8px 12px',
    borderBottom: '1px solid rgba(0, 255, 0, 0.08)',
    cursor: 'default',
    transition: 'background-color 0.15s ease',
  },
  cardNew: {
    animation: 'timeline-glow 1.5s ease-out',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  timestamp: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  agent: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.05em',
    fontWeight: 'bold',
    minWidth: '80px',
    textTransform: 'uppercase',
  },
  badge: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.6rem',
    border: '1px solid var(--crt-phosphor-dim)',
    padding: '1px 5px',
    letterSpacing: '0.05em',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  action: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor)',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  beadTag: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    border: '1px solid var(--crt-phosphor-dim)',
    padding: '0 4px',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  expandIcon: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.6rem',
    color: 'var(--crt-phosphor-dim)',
    flexShrink: 0,
  },
  detail: {
    marginTop: '6px',
    paddingLeft: '20px',
  },
  detailPre: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    backgroundColor: 'var(--theme-bg-elevated)',
    border: '1px solid rgba(0, 255, 0, 0.1)',
    padding: '6px 8px',
    margin: 0,
    overflow: 'auto',
    maxHeight: '150px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  coordDetail: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.7rem',
    padding: '6px 8px',
    backgroundColor: 'var(--theme-bg-elevated)',
    border: '1px solid rgba(255, 204, 0, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  coordField: {
    display: 'flex',
    gap: '6px',
    alignItems: 'baseline',
  },
  coordLabel: {
    color: '#ffcc00',
    fontSize: '0.6rem',
    letterSpacing: '0.08em',
    flexShrink: 0,
    fontWeight: 'bold',
  },
  coordValue: {
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.04em',
  },
  coordReason: {
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.04em',
    fontStyle: 'italic',
  },
  deployDetail: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.7rem',
    padding: '6px 8px',
    backgroundColor: 'var(--theme-bg-elevated)',
    border: '1px solid rgba(102, 204, 255, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  deployRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  deployLabel: {
    color: '#66ccff',
    fontSize: '0.6rem',
    letterSpacing: '0.08em',
    flexShrink: 0,
    fontWeight: 'bold',
    minWidth: '60px',
  },
  deployValue: {
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.04em',
    wordBreak: 'break-all',
  },
  deployLink: {
    color: '#66ccff',
    letterSpacing: '0.04em',
    textDecoration: 'underline',
    wordBreak: 'break-all',
  },
} satisfies Record<string, CSSProperties>;
