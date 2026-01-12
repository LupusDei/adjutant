import type { CSSProperties } from 'react';
import type { Message } from '../../types';

/**
 * Props for the MailDetail component.
 */
export interface MailDetailProps {
  /** The message to display */
  message: Message | null;
  /** Whether the message is currently loading */
  loading?: boolean;
  /** Callback when close/back button is clicked */
  onClose?: () => void;
  /** Callback when reply button is clicked */
  onReply?: () => void;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Pip-Boy styled mail detail component.
 * Displays full message content with header, metadata, and body.
 */
export function MailDetail({
  message,
  loading = false,
  onClose,
  onReply,
  className = '',
}: MailDetailProps) {
  if (loading) {
    return (
      <div style={styles.container} className={className}>
        <div style={styles.loadingState}>LOADING MESSAGE...</div>
      </div>
    );
  }

  if (!message) {
    return (
      <div style={styles.container} className={className}>
        <div style={styles.emptyState}>SELECT A MESSAGE TO VIEW</div>
      </div>
    );
  }

  return (
    <article style={styles.container} className={className} aria-label="Message details">
      {/* Header with close button */}
      <header style={styles.header}>
        {onClose && (
          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close message"
          >
            ← BACK
          </button>
        )}
        <div style={styles.headerContent}>
          <span style={styles.priorityBadge} data-priority={message.priority}>
            {getPriorityLabel(message.priority)}
          </span>
          <span style={styles.typeBadge} data-type={message.type}>
            [{message.type.toUpperCase()}]
          </span>
        </div>
      </header>

      {/* Subject line */}
      <h1 style={styles.subject}>{message.subject}</h1>

      {/* Message metadata */}
      <dl style={styles.metadata}>
        <div style={styles.metaRow}>
          <dt style={styles.metaLabel}>FROM:</dt>
          <dd style={styles.metaValue}>{formatAddress(message.from)}</dd>
        </div>
        <div style={styles.metaRow}>
          <dt style={styles.metaLabel}>TO:</dt>
          <dd style={styles.metaValue}>{formatAddress(message.to)}</dd>
        </div>
        {message.cc && message.cc.length > 0 && (
          <div style={styles.metaRow}>
            <dt style={styles.metaLabel}>CC:</dt>
            <dd style={styles.metaValue}>{message.cc.map(formatAddress).join(', ')}</dd>
          </div>
        )}
        <div style={styles.metaRow}>
          <dt style={styles.metaLabel}>DATE:</dt>
          <dd style={styles.metaValue}>{formatFullTimestamp(message.timestamp)}</dd>
        </div>
        <div style={styles.metaRow}>
          <dt style={styles.metaLabel}>ID:</dt>
          <dd style={{ ...styles.metaValue, ...styles.messageId }}>{message.id}</dd>
        </div>
      </dl>

      {/* Divider */}
      <hr style={styles.divider} />

      {/* Message body */}
      <div style={styles.body}>
        {message.body.split('\n').map((line, i) => (
          <p key={i} style={styles.bodyParagraph}>
            {line || '\u00A0'}
          </p>
        ))}
      </div>

      {/* Footer with status indicators and actions */}
      <footer style={styles.footer}>
        <div style={styles.footerLeft}>
          {message.pinned && <span style={styles.statusBadge}>📌 PINNED</span>}
          {message.replyTo && <span style={styles.statusBadge}>↩ REPLY</span>}
        </div>
        <div style={styles.footerRight}>
          {onReply && (
            <button
              type="button"
              style={styles.replyButton}
              onClick={onReply}
              aria-label="Reply to message"
            >
              ↩ REPLY
            </button>
          )}
          <span style={styles.readStatus}>
            {message.read ? '● READ' : '○ UNREAD'}
          </span>
        </div>
      </footer>
    </article>
  );
}

/**
 * Get human-readable priority label.
 */
function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 0: return '!!! URGENT';
    case 1: return '!! HIGH';
    case 2: return ''; // Normal - no label
    case 3: return '▽ LOW';
    case 4: return '▽▽ LOWEST';
    default: return '';
  }
}

/**
 * Format address for display.
 * Cleans up trailing slashes and capitalizes.
 */
function formatAddress(address: string): string {
  const cleaned = address.replace(/\/$/, '');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Format timestamp for full display.
 */
function formatFullTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Pip-Boy color palette (matching MailList)
const colors = {
  primary: '#14F07D',
  primaryDim: '#0A7A3E',
  primaryGlow: '#14F07D40',
  background: '#0A0A0A',
  urgent: '#FF4444',
  high: '#FFAA00',
} as const;

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
    padding: '16px',
    background: colors.background,
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '4px',
    minHeight: '200px',
  },

  loadingState: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.primaryDim,
    animation: 'blink 1s ease-in-out infinite',
  },

  emptyState: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px',
  },

  closeButton: {
    padding: '4px 8px',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    background: 'transparent',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    cursor: 'pointer',
    transition: 'border-color 0.1s, background-color 0.1s',
  },

  headerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  },

  priorityBadge: {
    fontSize: '0.75rem',
    color: colors.high,
    fontWeight: 'bold',
    letterSpacing: '0.05em',
  },

  typeBadge: {
    fontSize: '0.7rem',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
  },

  subject: {
    fontSize: '1.1rem',
    fontWeight: 'normal',
    margin: '0 0 16px 0',
    letterSpacing: '0.05em',
    lineHeight: 1.3,
    textShadow: `0 0 8px ${colors.primaryGlow}`,
  },

  metadata: {
    margin: 0,
    padding: 0,
    fontSize: '0.8rem',
  },

  metaRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '4px',
  },

  metaLabel: {
    minWidth: '48px',
    color: colors.primaryDim,
    fontWeight: 'normal',
  },

  metaValue: {
    color: colors.primary,
    margin: 0,
  },

  messageId: {
    fontSize: '0.7rem',
    opacity: 0.7,
  },

  divider: {
    border: 'none',
    borderTop: `1px dashed ${colors.primaryDim}`,
    margin: '16px 0',
  },

  body: {
    flex: 1,
    fontSize: '0.9rem',
    lineHeight: 1.6,
    letterSpacing: '0.02em',
  },

  bodyParagraph: {
    margin: '0 0 8px 0',
  },

  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '16px',
    paddingTop: '12px',
    borderTop: `1px solid ${colors.primaryDim}`,
    fontSize: '0.75rem',
  },

  footerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  footerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  statusBadge: {
    padding: '2px 6px',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    color: colors.primaryDim,
  },

  replyButton: {
    padding: '6px 12px',
    border: `1px solid ${colors.primary}`,
    borderRadius: '2px',
    background: colors.primaryGlow,
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.1s, box-shadow 0.1s',
    letterSpacing: '0.05em',
    boxShadow: `0 0 6px ${colors.primaryGlow}`,
  },

  readStatus: {
    color: colors.primaryDim,
    letterSpacing: '0.1em',
  },
} satisfies Record<string, CSSProperties>;

export default MailDetail;
