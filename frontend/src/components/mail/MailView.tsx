import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { MailList } from './MailList';
import { MailDetail } from './MailDetail';
import { ComposeMessage } from './ComposeMessage';
import { useMail } from '../../hooks/useMail';
import { useRigFilteredItems } from '../../contexts/RigContext';
import type { Message, SendMessageRequest } from '../../types';

/**
 * Props for the MailView container component.
 */
export interface MailViewProps {
  /** Optional CSS class name */
  className?: string;
}

/**
 * MailView container with split-view layout.
 *
 * Left panel displays the message list, right panel shows selected message details.
 * Uses the useMail hook for state management including selection, loading, and errors.
 */
export function MailView({ className = '' }: MailViewProps) {
  const {
    messages,
    loading,
    error,
    selectedMessage,
    selectedLoading,
    selectMessage,
    clearSelection,
    unreadCount,
    refresh,
    sendMessage,
    sending,
    sendError,
    clearSendError,
  } = useMail();

  // Filter messages by selected rig (based on 'to' address)
  const filteredMessages = useRigFilteredItems<Message>(
    messages,
    (msg) => msg.to // Extract rig from 'to' address (e.g., "gastown_boy/crew/carl")
  );

  // Compose mode state
  const [composing, setComposing] = useState(false);
  const [replyToId, setReplyToId] = useState<string | undefined>(undefined);
  const [replySubject, setReplySubject] = useState<string>('');

  // Auto-select first message when inbox loads
  useEffect(() => {
    if (messages.length > 0 && !selectedMessage && !loading && !composing) {
      void selectMessage(messages[0].id);
    }
  }, [messages, selectedMessage, loading, composing, selectMessage]);

  const handleMessageSelect = (messageId: string) => {
    void selectMessage(messageId);
  };

  const handleStartCompose = () => {
    setReplyToId(undefined);
    setReplySubject('');
    setComposing(true);
    clearSendError();
  };

  const handleStartReply = () => {
    if (selectedMessage) {
      setReplyToId(selectedMessage.id);
      setReplySubject(`RE: ${selectedMessage.subject}`);
      setComposing(true);
      clearSendError();
    }
  };

  const handleCancelCompose = () => {
    setComposing(false);
    setReplyToId(undefined);
    setReplySubject('');
    clearSendError();
  };

  const handleSend = async (request: SendMessageRequest) => {
    await sendMessage(request);
    // Only close compose on success (error will be shown with draft preserved)
    setComposing(false);
    setReplyToId(undefined);
    setReplySubject('');
  };

  return (
    <div style={styles.container} className={className}>
      {/* Header bar */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          {unreadCount > 0 && (
            <span style={styles.unreadBadge}>{unreadCount} UNREAD</span>
          )}
        </div>
        <div style={styles.headerRight}>
          <button
            type="button"
            style={styles.composeButton}
            onClick={handleStartCompose}
            disabled={composing}
            aria-label="Compose new message"
          >
            ✉ NEW
          </button>
          <button
            type="button"
            style={styles.refreshButton}
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh messages"
          >
            {loading ? 'SYNCING...' : '↻ REFRESH'}
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div style={styles.errorBanner} role="alert">
          ⚠ CONNECTION ERROR: {error.message}
        </div>
      )}

      {/* Split view panels */}
      <div style={styles.splitView}>
        {/* Left panel: Message list */}
        <aside style={styles.listPanel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>INBOX</span>
            <span style={styles.messageCount}>{filteredMessages.length} MSG</span>
          </div>
          <div style={styles.listContent}>
            <MailList
              messages={filteredMessages}
              selectedId={selectedMessage?.id ?? null}
              onSelect={handleMessageSelect}
              loading={loading && messages.length === 0}
            />
          </div>
        </aside>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Right panel: Message detail or compose */}
        <main style={styles.detailPanel}>
          {composing ? (
            <ComposeMessage
              onSend={handleSend}
              onCancel={handleCancelCompose}
              sending={sending}
              sendError={sendError}
              onClearError={clearSendError}
              {...(replyToId && { replyTo: replyToId })}
              initialSubject={replySubject}
            />
          ) : (
            <MailDetail
              message={selectedMessage}
              loading={selectedLoading}
              onClose={clearSelection}
              onReply={handleStartReply}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// Pip-Boy color palette (consistent with other mail components)
const colors = {
  primary: '#14F07D',
  primaryDim: '#0A7A3E',
  primaryGlow: '#14F07D40',
  background: '#0A0A0A',
  backgroundDark: '#050505',
  error: '#FF4444',
} as const;

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
    backgroundColor: colors.background,
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${colors.primaryDim}`,
    backgroundColor: colors.backgroundDark,
  },

  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },

  unreadBadge: {
    padding: '2px 8px',
    fontSize: '0.75rem',
    border: `1px solid ${colors.primary}`,
    borderRadius: '2px',
    backgroundColor: colors.primaryGlow,
    letterSpacing: '0.05em',
  },

  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  composeButton: {
    padding: '6px 12px',
    border: `1px solid ${colors.primary}`,
    borderRadius: '2px',
    background: colors.primaryGlow,
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    transition: 'background-color 0.1s, box-shadow 0.1s',
    boxShadow: `0 0 6px ${colors.primaryGlow}`,
  },

  refreshButton: {
    padding: '6px 12px',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    background: 'transparent',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    transition: 'border-color 0.1s, background-color 0.1s',
  },

  errorBanner: {
    padding: '8px 16px',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderBottom: `1px solid ${colors.error}`,
    color: colors.error,
    fontSize: '0.85rem',
    letterSpacing: '0.05em',
  },

  splitView: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },

  listPanel: {
    width: '340px',
    minWidth: '280px',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${colors.primaryDim}`,
  },

  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: `1px solid ${colors.primaryDim}`,
    backgroundColor: colors.backgroundDark,
  },

  panelTitle: {
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    color: colors.primaryDim,
  },

  messageCount: {
    fontSize: '0.7rem',
    color: colors.primaryDim,
    opacity: 0.7,
  },

  listContent: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },

  divider: {
    width: '1px',
    backgroundColor: colors.primaryDim,
  },

  detailPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    padding: '16px',
  },
} satisfies Record<string, CSSProperties>;

export default MailView;
