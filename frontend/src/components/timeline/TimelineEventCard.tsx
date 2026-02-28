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

  const config = EVENT_TYPE_CONFIG[event.eventType] ?? {
    icon: '\u{1F50D}',
    label: event.eventType.toUpperCase(),
    color: 'var(--crt-phosphor-dim)',
  };

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
        <span style={styles.action}>{event.action}</span>

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
          <pre style={styles.detailPre}>
            {JSON.stringify(event.detail, null, 2)}
          </pre>
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
    backgroundColor: '#050505',
    border: '1px solid rgba(0, 255, 0, 0.1)',
    padding: '6px 8px',
    margin: 0,
    overflow: 'auto',
    maxHeight: '150px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
} satisfies Record<string, CSSProperties>;
