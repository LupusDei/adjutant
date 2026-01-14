import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { MailList } from './MailList';
import { MailDetail } from './MailDetail';
import { ComposeMessage } from './ComposeMessage';
import { useMail } from '../../hooks/useMail';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useRigFilteredItems } from '../../contexts/RigContext';
import type { Message, SendMessageRequest } from '../../types';

/** Mobile navigation view mode */
type MobileView = 'list' | 'detail';

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

  // Responsive: detect mobile viewport
  const isMobile = useIsMobile();

  // Mobile navigation state: which panel to show
  const [mobileView, setMobileView] = useState<MobileView>('list');

  // Filter messages by selected rig (based on 'to' address)
  const filteredMessages = useRigFilteredItems<Message>(
    messages,
    (msg) => msg.to // Extract rig from 'to' address (e.g., "gastown_boy/crew/carl")
  );

  // Compose mode state
  const [composing, setComposing] = useState(false);
  const [replyToId, setReplyToId] = useState<string | undefined>(undefined);
  const [replySubject, setReplySubject] = useState<string>('');
  const [replyRecipient, setReplyRecipient] = useState<string | undefined>(undefined);

  // Auto-select first message when inbox loads (desktop only)
  useEffect(() => {
    const firstMessage = messages[0];
    if (!isMobile && firstMessage && !selectedMessage && !loading && !composing) {
      void selectMessage(firstMessage.id);
    }
  }, [messages, selectedMessage, loading, composing, selectMessage, isMobile]);

  // When switching from mobile to desktop, ensure we have a selection
  useEffect(() => {
    const firstMessage = messages[0];
    if (!isMobile && mobileView === 'list' && firstMessage && !selectedMessage) {
      void selectMessage(firstMessage.id);
    }
  }, [isMobile, mobileView, messages, selectedMessage, selectMessage]);

  const handleMessageSelect = (messageId: string) => {
    void selectMessage(messageId);
    // On mobile, navigate to detail view when selecting a message
    if (isMobile) {
      setMobileView('detail');
    }
  };

  // Handle back navigation on mobile (return to list)
  const handleMobileBack = () => {
    setMobileView('list');
    clearSelection();
  };

  const handleStartCompose = () => {
    setReplyToId(undefined);
    setReplySubject('');
    setReplyRecipient(undefined);
    setComposing(true);
    clearSendError();
    // On mobile, show compose in detail panel
    if (isMobile) {
      setMobileView('detail');
    }
  };

  const handleStartReply = () => {
    if (selectedMessage) {
      setReplyToId(selectedMessage.id);
      setReplySubject(`RE: ${selectedMessage.subject}`);
      setReplyRecipient(selectedMessage.from);
      setComposing(true);
      clearSendError();
    }
  };

  const handleCancelCompose = () => {
    setComposing(false);
    setReplyToId(undefined);
    setReplySubject('');
    setReplyRecipient(undefined);
    clearSendError();
    // On mobile, return to list after canceling compose
    if (isMobile) {
      setMobileView('list');
    }
  };

  const handleSend = async (request: SendMessageRequest) => {
    await sendMessage(request);
    // Only close compose on success (error will be shown with draft preserved)
    setComposing(false);
    setReplyToId(undefined);
    setReplySubject('');
    setReplyRecipient(undefined);
    // On mobile, return to list after sending
    if (isMobile) {
      setMobileView('list');
    }
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

      {/* Split view panels - responsive layout */}
      <div style={styles.splitView}>
        {/* Left panel: Message list (hidden on mobile when viewing detail) */}
        {(!isMobile || mobileView === 'list') && (
          <aside style={isMobile ? styles.listPanelMobile : styles.listPanel}>
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
        )}

        {/* Divider (desktop only) */}
        {!isMobile && <div style={styles.divider} />}

        {/* Right panel: Message detail or compose (hidden on mobile when viewing list) */}
        {(!isMobile || mobileView === 'detail') && (
          <main style={isMobile ? styles.detailPanelMobile : styles.detailPanel}>
            {composing ? (
              <ComposeMessage
                onSend={handleSend}
                onCancel={handleCancelCompose}
                sending={sending}
                sendError={sendError}
                onClearError={clearSendError}
                {...(replyToId && { replyTo: replyToId })}
                {...(replyRecipient && { initialRecipient: replyRecipient })}
                initialSubject={replySubject}
              />
            ) : (
              <MailDetail
                message={selectedMessage}
                loading={selectedLoading}
                onClose={isMobile ? handleMobileBack : clearSelection}
                onReply={handleStartReply}
              />
            )}
          </main>
        )}
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
    flex: 1,
    height: '100%',
    minHeight: 0,
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: `1px solid ${colors.primaryDim}`,
    backgroundColor: colors.backgroundDark,
    flexShrink: 0,
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
    minHeight: 0,
    overflow: 'hidden',
  },

  listPanel: {
    width: '300px',
    minWidth: '200px',
    maxWidth: '350px',
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${colors.primaryDim}`,
    minHeight: 0,
  },

  // Mobile: list takes full width
  listPanelMobile: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },

  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    borderBottom: `1px solid ${colors.primaryDim}`,
    backgroundColor: colors.backgroundDark,
    flexShrink: 0,
  },

  panelTitle: {
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    color: colors.primaryDim,
  },

  messageCount: {
    fontSize: '0.65rem',
    color: colors.primaryDim,
    opacity: 0.7,
  },

  listContent: {
    flex: 1,
    overflow: 'auto',
    padding: '6px',
    minHeight: 0,
  },

  divider: {
    width: '1px',
    backgroundColor: colors.primaryDim,
    flexShrink: 0,
  },

  detailPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    padding: '12px',
    minHeight: 0,
  },

  // Mobile: detail takes full width with smaller padding
  detailPanelMobile: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    padding: '8px',
    minHeight: 0,
  },
} satisfies Record<string, CSSProperties>;

export default MailView;
