/**
 * CrewMessageComposer Component
 * Provides a form to compose and send messages to crew members.
 * Displays a list of available crew members for selection.
 */

import { useState, useCallback, type CSSProperties, type FormEvent } from 'react';
import type { CrewMember, MessagePriority } from '../../types';
import { useCrewMessaging, buildCrewAddress } from '../../hooks/useCrewMessaging';
import { VoiceMicButton } from '../voice';

export interface CrewMessageComposerProps {
  /** Callback when message is sent successfully */
  onSent?: (toCrewMember: CrewMember) => void;
  /** Callback when cancel button is clicked */
  onCancel?: () => void;
  /** Pre-selected crew member */
  initialRecipient?: CrewMember;
  /** ID of message being replied to */
  replyTo?: string;
  /** Pre-filled subject for replies */
  initialSubject?: string;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Get icon for agent type.
 */
function getAgentIcon(type: CrewMember['type']): string {
  switch (type) {
    case 'mayor':
      return '👑';
    case 'deacon':
      return '⚙';
    case 'witness':
      return '👁';
    case 'refinery':
      return '🔧';
    case 'crew':
      return '👷';
    case 'polecat':
      return '🐱';
    default:
      return '•';
  }
}

/**
 * Get status color for crew member.
 */
function getStatusColor(status: CrewMember['status']): string {
  switch (status) {
    case 'working':
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

/**
 * Compose and send messages to crew members.
 */
export function CrewMessageComposer({
  onSent,
  onCancel,
  initialRecipient,
  replyTo,
  initialSubject = '',
  className = '',
}: CrewMessageComposerProps) {
  const {
    crewMembers,
    loading: loadingCrew,
    sendToCrewMember,
    sending,
    sendError,
    clearSendError,
    onlineCrew,
  } = useCrewMessaging();

  const [selectedMember, setSelectedMember] = useState<CrewMember | null>(
    initialRecipient ?? null
  );
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<MessagePriority>(2);
  const [showOffline, setShowOffline] = useState(false);

  // Handle voice transcript
  const handleVoiceTranscript = useCallback((text: string) => {
    setBody((prev) => {
      if (!prev.trim()) return text;
      const separator = prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ';
      return prev + separator + text;
    });
  }, []);

  // Handle form submission
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!selectedMember || !subject.trim() || !body.trim()) {
      return;
    }

    try {
      const messageRequest: Parameters<typeof sendToCrewMember>[0] = {
        to: selectedMember,
        subject: subject.trim(),
        body: body.trim(),
        priority,
        type: replyTo ? 'reply' : 'task',
      };

      // Only add replyTo if it's defined
      if (replyTo) {
        messageRequest.replyTo = replyTo;
      }

      await sendToCrewMember(messageRequest);

      // Clear form on success
      setSubject('');
      setBody('');
      setPriority(2);

      if (onSent) {
        onSent(selectedMember);
      }
    } catch {
      // Error is handled by the hook
    }
  };

  const displayedMembers = showOffline ? crewMembers : onlineCrew;
  const isValid =
    selectedMember !== null &&
    subject.trim().length > 0 &&
    body.trim().length > 0;

  return (
    <form
      style={styles.container}
      className={className}
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label="Compose crew message"
    >
      {/* Header */}
      <header style={styles.header}>
        <h2 style={styles.title} className="crt-glow">
          {replyTo ? '↩ REPLY TO CREW' : '💬 MESSAGE CREW'}
        </h2>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={showOffline}
            onChange={(e) => { setShowOffline(e.target.checked); }}
            style={styles.toggleInput}
          />
          <span style={styles.toggleText}>SHOW OFFLINE</span>
        </label>
      </header>

      {/* Error display */}
      {sendError && (
        <div style={styles.errorBanner} role="alert">
          <span>⚠ SEND FAILED: {sendError.message}</span>
          <button
            type="button"
            style={styles.dismissButton}
            onClick={clearSendError}
          >
            ✕
          </button>
        </div>
      )}

      {/* Crew member selector */}
      <div style={styles.fieldGroup}>
        <label style={styles.label}>SELECT RECIPIENT:</label>
        {loadingCrew ? (
          <div style={styles.loadingState}>◌ LOADING CREW...</div>
        ) : displayedMembers.length === 0 ? (
          <div style={styles.emptyState}>NO CREW MEMBERS AVAILABLE</div>
        ) : (
          <div style={styles.crewGrid} role="listbox" aria-label="Crew members">
            {displayedMembers.map((member) => (
              <button
                key={member.id}
                type="button"
                role="option"
                aria-selected={selectedMember?.id === member.id}
                style={{
                  ...styles.crewCard,
                  ...(selectedMember?.id === member.id
                    ? styles.crewCardSelected
                    : {}),
                  ...(member.status === 'offline' ? styles.crewCardOffline : {}),
                }}
                onClick={() => { setSelectedMember(member); }}
                disabled={sending}
              >
                <span style={styles.crewIcon}>{getAgentIcon(member.type)}</span>
                <span style={styles.crewName}>{member.name.toUpperCase()}</span>
                <span
                  style={{
                    ...styles.statusDot,
                    backgroundColor: getStatusColor(member.status),
                  }}
                />
                <span style={styles.crewRig}>{member.rig ?? 'town'}</span>
                {member.unreadMail > 0 && (
                  <span style={styles.mailBadge}>📬{member.unreadMail}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected recipient display */}
      {selectedMember && (
        <div style={styles.selectedRecipient}>
          <span style={styles.selectedLabel}>TO:</span>
          <span style={styles.selectedIcon}>
            {getAgentIcon(selectedMember.type)}
          </span>
          <span style={styles.selectedName}>{selectedMember.name}</span>
          <span style={styles.selectedAddress}>
            ({buildCrewAddress(selectedMember)})
          </span>
        </div>
      )}

      {/* Subject field */}
      <div style={styles.fieldGroup}>
        <label style={styles.label} htmlFor="crew-subject">
          SUBJECT:
        </label>
        <input
          id="crew-subject"
          type="text"
          style={styles.input}
          value={subject}
          onChange={(e) => { setSubject(e.target.value); }}
          placeholder="Enter subject..."
          disabled={sending}
          maxLength={200}
          required
        />
      </div>

      {/* Priority selector */}
      <div style={styles.fieldGroup}>
        <label style={styles.label} htmlFor="crew-priority">
          PRIORITY:
        </label>
        <select
          id="crew-priority"
          style={styles.select}
          value={priority}
          onChange={(e) => { setPriority(Number(e.target.value) as MessagePriority); }}
          disabled={sending}
        >
          <option value={0}>!!! URGENT</option>
          <option value={1}>!! HIGH</option>
          <option value={2}>NORMAL</option>
          <option value={3}>▽ LOW</option>
          <option value={4}>▽▽ LOWEST</option>
        </select>
      </div>

      {/* Body field */}
      <div style={styles.fieldGroupExpand}>
        <div style={styles.labelRow}>
          <label style={styles.label} htmlFor="crew-body">
            MESSAGE:
          </label>
          <VoiceMicButton
            onTranscript={handleVoiceTranscript}
            disabled={sending}
            className="crew-compose-voice-mic"
          />
        </div>
        <textarea
          id="crew-body"
          style={styles.textarea}
          value={body}
          onChange={(e) => { setBody(e.target.value); }}
          placeholder="Enter your message..."
          disabled={sending}
          rows={6}
          required
        />
      </div>

      {/* Character count */}
      <div style={styles.charCount}>{body.length} CHARS</div>

      {/* Action buttons */}
      <footer style={styles.footer}>
        {onCancel && (
          <button
            type="button"
            style={styles.cancelButton}
            onClick={onCancel}
            disabled={sending}
          >
            ✕ CANCEL
          </button>
        )}
        <button
          type="submit"
          style={{
            ...styles.sendButton,
            ...(sending || !isValid ? styles.buttonDisabled : {}),
          }}
          disabled={sending || !isValid}
        >
          {sending ? '◌ SENDING...' : '► SEND'}
        </button>
      </footer>
    </form>
  );
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryBright: 'var(--crt-phosphor-bright)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: '#0A0A0A',
  backgroundDark: '#050505',
  error: '#FF4444',
  working: 'var(--crt-phosphor-bright)',
  idle: 'var(--crt-phosphor)',
  blocked: '#FFB000',
  stuck: '#FF4444',
  offline: '#666666',
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
    gap: '12px',
    maxHeight: '80vh',
    overflow: 'auto',
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
    borderBottom: `1px solid ${colors.primaryDim}`,
    paddingBottom: '10px',
  },

  title: {
    fontSize: '1rem',
    fontWeight: 'normal',
    margin: 0,
    letterSpacing: '0.1em',
  },

  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.7rem',
    color: colors.primaryDim,
    cursor: 'pointer',
  },

  toggleInput: {
    cursor: 'pointer',
  },

  toggleText: {
    letterSpacing: '0.05em',
  },

  errorBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: 'rgba(255, 68, 68, 0.1)',
    border: `1px solid ${colors.error}`,
    borderRadius: '2px',
    color: colors.error,
    fontSize: '0.8rem',
  },

  dismissButton: {
    padding: '2px 6px',
    background: 'transparent',
    border: 'none',
    color: colors.error,
    cursor: 'pointer',
    fontSize: '0.9rem',
  },

  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },

  fieldGroupExpand: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: 1,
  },

  label: {
    fontSize: '0.75rem',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
  },

  labelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  loadingState: {
    padding: '20px',
    textAlign: 'center',
    color: colors.primaryDim,
    fontSize: '0.8rem',
    letterSpacing: '0.1em',
  },

  emptyState: {
    padding: '20px',
    textAlign: 'center',
    color: colors.primaryDim,
    fontSize: '0.8rem',
    fontStyle: 'italic',
  },

  crewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '8px',
    maxHeight: '200px',
    overflow: 'auto',
    padding: '4px',
  },

  crewCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '10px 8px',
    background: colors.backgroundDark,
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    cursor: 'pointer',
    transition: 'all 0.1s ease',
    fontFamily: 'inherit',
    color: colors.primary,
    fontSize: '0.75rem',
  },

  crewCardSelected: {
    borderColor: colors.primaryBright,
    boxShadow: `0 0 8px ${colors.primaryGlow}`,
    background: `rgba(${colors.primary}, 0.1)`,
  },

  crewCardOffline: {
    opacity: 0.5,
  },

  crewIcon: {
    fontSize: '1.2rem',
  },

  crewName: {
    fontWeight: 'bold',
    letterSpacing: '0.05em',
    textAlign: 'center',
    fontSize: '0.7rem',
  },

  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
  },

  crewRig: {
    fontSize: '0.6rem',
    color: colors.primaryDim,
    textTransform: 'uppercase',
  },

  mailBadge: {
    fontSize: '0.65rem',
    color: colors.primaryBright,
  },

  selectedRecipient: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: colors.backgroundDark,
    border: `1px solid ${colors.primary}`,
    borderRadius: '2px',
    fontSize: '0.85rem',
  },

  selectedLabel: {
    color: colors.primaryDim,
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
  },

  selectedIcon: {
    fontSize: '1rem',
  },

  selectedName: {
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },

  selectedAddress: {
    fontSize: '0.7rem',
    color: colors.primaryDim,
    marginLeft: 'auto',
  },

  input: {
    padding: '8px 12px',
    background: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    outline: 'none',
  },

  select: {
    padding: '8px 12px',
    background: colors.background,
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    cursor: 'pointer',
    outline: 'none',
  },

  textarea: {
    padding: '8px 12px',
    background: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    resize: 'vertical',
    minHeight: '100px',
    outline: 'none',
    lineHeight: 1.5,
  },

  charCount: {
    fontSize: '0.7rem',
    color: colors.primaryDim,
    textAlign: 'right',
    letterSpacing: '0.1em',
  },

  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    paddingTop: '12px',
    borderTop: `1px solid ${colors.primaryDim}`,
  },

  cancelButton: {
    padding: '8px 16px',
    background: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    color: colors.primaryDim,
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  },

  sendButton: {
    padding: '7px 19px',
    background: 'transparent',
    border: `2px solid ${colors.primary}`,
    borderRadius: '2px',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    boxShadow: `0 0 10px ${colors.primaryGlow}`,
  },

  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
} satisfies Record<string, CSSProperties>;

export default CrewMessageComposer;
