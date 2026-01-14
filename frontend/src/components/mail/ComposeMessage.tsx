import { useState, type CSSProperties, type FormEvent } from 'react';
import type { SendMessageRequest, MessagePriority } from '../../types';
import { RecipientSelector } from './RecipientSelector';

/**
 * Props for the ComposeMessage component.
 */
export interface ComposeMessageProps {
  /** Callback when message is sent successfully */
  onSend: (request: SendMessageRequest) => Promise<void>;
  /** Callback when cancel button is clicked */
  onCancel: () => void;
  /** Whether a send operation is in progress */
  sending?: boolean;
  /** Error from last send attempt */
  sendError?: Error | null;
  /** Callback to clear the send error */
  onClearError?: () => void;
  /** ID of message being replied to */
  replyTo?: string;
  /** Pre-filled subject for replies */
  initialSubject?: string;
  /** Pre-filled recipient for replies */
  initialRecipient?: string;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Pip-Boy styled compose message component.
 * Provides form fields for subject, body, and priority with send/cancel actions.
 */
export function ComposeMessage({
  onSend,
  onCancel,
  sending = false,
  sendError,
  onClearError,
  replyTo,
  initialSubject = '',
  initialRecipient,
  className = '',
}: ComposeMessageProps) {
  const [recipient, setRecipient] = useState(initialRecipient ?? 'mayor/');
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<MessagePriority>(2);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!recipient || !subject.trim() || !body.trim()) {
      return;
    }

    const request: SendMessageRequest = {
      to: recipient,
      subject: subject.trim(),
      body: body.trim(),
      priority,
      type: replyTo ? 'reply' : 'task',
      ...(replyTo && { replyTo }),
    };

    await onSend(request);
  };

  const isValid = recipient.length > 0 && subject.trim().length > 0 && body.trim().length > 0;

  return (
    <form
      style={styles.container}
      className={className}
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label="Compose message"
    >
      {/* Header */}
      <header style={styles.header}>
        <h2 style={styles.title}>
          {replyTo ? '↩ COMPOSE REPLY' : '✉ NEW MESSAGE'}
        </h2>
      </header>

      {/* Recipient selector */}
      <RecipientSelector
        value={recipient}
        onChange={setRecipient}
        disabled={sending}
      />

      {/* Error display with retry option */}
      {sendError && (
        <div style={styles.errorBanner} role="alert">
          <div style={styles.errorContent}>
            <div style={styles.errorMessage}>
              ⚠ SEND FAILED: {sendError.message}
            </div>
            <div style={styles.draftPreserved}>
              ✓ DRAFT PRESERVED
            </div>
          </div>
          <div style={styles.errorActions}>
            {onClearError && (
              <button
                type="button"
                style={styles.dismissButton}
                onClick={onClearError}
              >
                ✕
              </button>
            )}
            <button
              type="submit"
              style={styles.retryButton}
              disabled={sending || !isValid}
            >
              ↻ RETRY
            </button>
          </div>
        </div>
      )}

      {/* Subject field */}
      <div style={styles.fieldGroup}>
        <label style={styles.label} htmlFor="compose-subject">
          SUBJECT:
        </label>
        <input
          id="compose-subject"
          type="text"
          style={styles.input}
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
          }}
          placeholder="Enter subject..."
          disabled={sending}
          maxLength={200}
          required
        />
      </div>

      {/* Priority selector */}
      <div style={styles.fieldGroup}>
        <label style={styles.label} htmlFor="compose-priority">
          PRIORITY:
        </label>
        <select
          id="compose-priority"
          style={styles.select}
          value={priority}
          onChange={(e) => {
            setPriority(Number(e.target.value) as MessagePriority);
          }}
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
        <label style={styles.label} htmlFor="compose-body">
          MESSAGE:
        </label>
        <textarea
          id="compose-body"
          style={styles.textarea}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
          placeholder="Enter your message..."
          disabled={sending}
          rows={8}
          required
        />
      </div>

      {/* Character count */}
      <div style={styles.charCount}>
        {body.length} CHARS
      </div>

      {/* Action buttons */}
      <footer style={styles.footer}>
        <button
          type="button"
          style={styles.cancelButton}
          onClick={onCancel}
          disabled={sending}
        >
          ✕ CANCEL
        </button>
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

// Pip-Boy color palette (matching MailList/MailDetail)
const colors = {
  primary: '#14F07D',
  primaryDim: '#0A7A3E',
  primaryGlow: '#14F07D40',
  background: '#0A0A0A',
  error: '#FF4444',
  errorGlow: '#FF444440',
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
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },

  title: {
    fontSize: '1rem',
    fontWeight: 'normal',
    margin: 0,
    letterSpacing: '0.1em',
    textShadow: `0 0 8px ${colors.primaryGlow}`,
  },

  errorBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: colors.errorGlow,
    border: `1px solid ${colors.error}`,
    borderRadius: '2px',
    color: colors.error,
    fontSize: '0.8rem',
    letterSpacing: '0.05em',
    gap: '12px',
  },

  errorContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
  },

  errorMessage: {
    fontWeight: 'bold',
  },

  draftPreserved: {
    fontSize: '0.7rem',
    color: colors.primary,
    opacity: 0.8,
  },

  errorActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  dismissButton: {
    padding: '4px 8px',
    background: 'transparent',
    border: `1px solid ${colors.error}`,
    borderRadius: '2px',
    color: colors.error,
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    cursor: 'pointer',
    opacity: 0.7,
    transition: 'opacity 0.1s',
  },

  retryButton: {
    padding: '4px 12px',
    background: 'transparent',
    border: `1px solid ${colors.error}`,
    borderRadius: '2px',
    color: colors.error,
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.1s',
  },

  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },

  fieldGroupExpand: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
  },

  label: {
    fontSize: '0.75rem',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
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
    transition: 'border-color 0.1s, box-shadow 0.1s',
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
    minHeight: '120px',
    outline: 'none',
    lineHeight: 1.5,
    transition: 'border-color 0.1s, box-shadow 0.1s',
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
    marginTop: '8px',
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
    transition: 'border-color 0.1s, color 0.1s',
    letterSpacing: '0.05em',
  },

  sendButton: {
    padding: '8px 20px',
    background: colors.primaryGlow,
    border: `1px solid ${colors.primary}`,
    borderRadius: '2px',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.1s, box-shadow 0.1s',
    letterSpacing: '0.05em',
    boxShadow: `0 0 8px ${colors.primaryGlow}`,
  },

  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
} satisfies Record<string, CSSProperties>;

export default ComposeMessage;
