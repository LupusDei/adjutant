/**
 * CrewNotificationBadge Component
 * Displays a badge showing unread crew message count with preview of latest message.
 */

import type { CSSProperties } from 'react';
import { useCrewNotifications } from '../../hooks/useCrewNotifications';

export interface CrewNotificationBadgeProps {
  /** Optional CSS class name */
  className?: string;
  /** Click handler to open crew messages */
  onClick?: () => void;
  /** Whether the badge is compact (icon only) or expanded (with text) */
  compact?: boolean;
}

/**
 * Badge showing unread crew message count.
 * Clicking opens the crew messages view.
 */
export function CrewNotificationBadge({
  className = '',
  onClick,
  compact = false,
}: CrewNotificationBadgeProps) {
  const { unreadCount, latestMessage, loading, error } = useCrewNotifications();

  // Don't show badge if no unread messages
  if (!loading && unreadCount === 0) {
    return null;
  }

  const senderName = latestMessage
    ? latestMessage.from.split('/').pop() ?? 'crew'
    : null;

  return (
    <button
      type="button"
      style={{
        ...styles.badge,
        ...(unreadCount > 0 ? styles.badgeActive : {}),
      }}
      className={className}
      onClick={onClick}
      title={
        loading
          ? 'Loading crew messages...'
          : error
            ? `Error: ${error.message}`
            : latestMessage
              ? `${unreadCount} unread from crew - Latest: "${latestMessage.subject}" from ${senderName}`
              : 'No unread crew messages'
      }
      aria-label={`${unreadCount} unread crew messages`}
    >
      <span style={styles.icon}>
        {loading ? '◌' : error ? '⚠' : '💬'}
      </span>

      {!compact && unreadCount > 0 && (
        <>
          <span style={styles.count}>{unreadCount}</span>
          {latestMessage && (
            <span style={styles.preview}>
              {senderName}: {latestMessage.subject.slice(0, 20)}
              {latestMessage.subject.length > 20 ? '...' : ''}
            </span>
          )}
        </>
      )}

      {compact && unreadCount > 0 && (
        <span style={styles.countBubble}>{unreadCount > 9 ? '9+' : unreadCount}</span>
      )}

      {unreadCount > 0 && <span style={styles.pulse} />}
    </button>
  );
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryBright: 'var(--crt-phosphor-bright)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: '#0A0A0A',
} as const;

const styles = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    background: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    color: colors.primaryDim,
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    cursor: 'pointer',
    position: 'relative',
    transition: 'all 0.2s ease',
    letterSpacing: '0.05em',
  },

  badgeActive: {
    borderColor: colors.primary,
    color: colors.primary,
    boxShadow: `0 0 8px ${colors.primaryGlow}`,
  },

  icon: {
    fontSize: '0.9rem',
  },

  count: {
    fontWeight: 'bold',
    minWidth: '16px',
    textAlign: 'center',
  },

  countBubble: {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    background: colors.primaryBright,
    color: colors.background,
    borderRadius: '8px',
    fontSize: '0.6rem',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  preview: {
    fontSize: '0.65rem',
    opacity: 0.8,
    maxWidth: '120px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  pulse: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '100%',
    height: '100%',
    border: `1px solid ${colors.primary}`,
    borderRadius: '2px',
    animation: 'crew-badge-pulse 2s ease-out infinite',
    pointerEvents: 'none',
  },
} satisfies Record<string, CSSProperties>;

// Add keyframes for pulse animation
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes crew-badge-pulse {
      0% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(1.5);
      }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default CrewNotificationBadge;
