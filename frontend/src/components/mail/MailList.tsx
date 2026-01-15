import type { CSSProperties } from 'react';
import type { Message } from '../../types';

/**
 * Props for the MailList component.
 */
export interface MailListProps {
  /** List of messages to display */
  messages: Message[];
  /** ID of currently selected message (if any) */
  selectedId?: string | null;
  /** Callback when a message is selected */
  onSelect?: (messageId: string) => void;
  /** Whether the list is currently loading */
  loading?: boolean;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Pip-Boy styled mail list component.
 * Displays messages with subject, sender, timestamp, and read status.
 * Supports selection highlighting.
 */
export function MailList({
  messages,
  selectedId,
  onSelect,
  loading = false,
  className = '',
}: MailListProps) {
  if (loading) {
    return (
      <div style={styles.container} className={className}>
        <div style={styles.loadingState}>LOADING MESSAGES...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div style={styles.container} className={className}>
        <div style={styles.emptyState}>NO MESSAGES</div>
      </div>
    );
  }

  return (
    <div style={styles.container} className={className} role="listbox" aria-label="Mail messages">
      {messages.map((message) => {
        const isSelected = message.id === selectedId;
        return (
          <button
            key={message.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            style={{
              ...styles.messageItem,
              ...(isSelected ? styles.messageItemSelected : {}),
              ...(message.read ? {} : styles.messageItemUnread),
            }}
            onClick={() => onSelect?.(message.id)}
          >
            <div style={styles.messageHeader}>
              <span style={styles.priorityIndicator} data-priority={message.priority}>
                {getPrioritySymbol(message.priority)}
              </span>
              <span style={styles.subject} title={message.subject}>
                {!message.read && <span style={styles.unreadDot}>●</span>}
                {message.subject}
              </span>
            </div>
            <div style={styles.messageMeta}>
              <div style={styles.fromToStack}>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>FROM:</span>
                  <span style={styles.metaValue}>{formatSender(message.from)}</span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>TO:</span>
                  <span style={styles.metaValue}>{formatSender(message.to)}</span>
                </div>
              </div>
              <span style={styles.timestamp}>{formatTimestamp(message.timestamp)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Get priority indicator symbol.
 */
function getPrioritySymbol(priority: number): string {
  switch (priority) {
    case 0: return '!!!'; // Urgent
    case 1: return '!!';  // High
    case 2: return '';    // Normal (no indicator)
    case 3: return '▽';   // Low
    case 4: return '▽▽';  // Lowest
    default: return '';
  }
}

/**
 * Format sender address for display.
 * Removes trailing slashes and extracts readable name.
 */
function formatSender(from: string): string {
  // Remove trailing slash (e.g., "mayor/" -> "mayor")
  const cleaned = from.replace(/\/$/, '');
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Format timestamp for display.
 * Shows relative time or date depending on age.
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'NOW';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  // Older messages show date
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Pip-Boy color palette (matching PipBoyFrame)
const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: '#0A0A0A',
  urgent: '#FF4444',
  high: '#FFAA00',
} as const;

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
  },

  loadingState: {
    padding: '40px',
    textAlign: 'center',
    color: colors.primaryDim,
    fontSize: '0.8rem',
    letterSpacing: '0.1em',
    animation: 'blink-smooth 1s ease-in-out infinite',
  },

  emptyState: {
    padding: '24px',
    textAlign: 'center',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
  },

  messageItem: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    color: colors.primary,
    transition: 'background-color 0.1s, border-color 0.1s',
  },

  messageItemSelected: {
    background: 'transparent',
    borderColor: colors.primary,
    borderWidth: '2px',
    padding: '7px 11px',
    boxShadow: `0 0 8px ${colors.primaryGlow}`,
  },

  messageItemUnread: {
    borderLeftWidth: '3px',
    borderLeftColor: colors.primary,
  },

  messageHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },

  priorityIndicator: {
    fontSize: '0.7rem',
    minWidth: '24px',
    color: colors.high,
  },

  subject: {
    flex: 1,
    fontSize: '0.9rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    letterSpacing: '0.05em',
  },

  unreadDot: {
    marginRight: '6px',
    color: colors.primary,
    textShadow: `0 0 4px ${colors.primary}`,
  },

  messageMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    fontSize: '0.75rem',
    color: colors.primaryDim,
    marginLeft: '32px',
  },

  metaLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },

  fromToStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },

  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },

  metaLabel: {
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    opacity: 0.7,
    minWidth: '40px',
  },

  metaValue: {
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },

  from: {
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },

  timestamp: {
    opacity: 0.8,
  },
} satisfies Record<string, CSSProperties>;

export default MailList;
