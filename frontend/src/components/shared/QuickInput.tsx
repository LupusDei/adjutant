import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../../services/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { VoiceMicButton } from '../voice';

/**
 * Collapsible Quick Input component for sending direct messages to the Mayor.
 * Appears as a FAB in the bottom right, expanding into a message box.
 */
export function QuickInput() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  // Handle voice transcript - append to text with smart spacing
  const handleVoiceTranscript = useCallback((transcript: string) => {
    setText((prev) => {
      if (!prev.trim()) return transcript;
      // Add space if previous text doesn't end with whitespace
      const separator = prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ';
      return prev + separator + transcript;
    });
  }, []);

  // Auto-resize textarea when expanded
  useEffect(() => {
    if (isExpanded) {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto';
        const maxHeight = isMobile ? 250 : 150;
        const minHeight = isMobile ? 120 : 24;
        textarea.style.height = `${Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))}px`;
      }
    }
  }, [text, isExpanded, isMobile]);

  // Focus when expanded
  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isExpanded]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;

    setSending(true);
    setStatus('idle');

    try {
      await api.messages.send({
        to: 'user',
        body: text,
      });
      
      setText('');
      setStatus('success');
      
      // Auto-collapse on success after a short delay
      setTimeout(() => {
        setStatus('idle');
        setIsExpanded(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to send quick message:', err);
      setStatus('error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
    if (e.key === 'Escape' && isExpanded) {
      setIsExpanded(false);
    }
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => { setIsExpanded(true); }}
        style={styles.fab}
        title="Message Mayor"
        aria-label="Quick message to Mayor"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
        </svg>
      </button>
    );
  }

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? styles.containerMobile : {}),
    }}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.label}>QUICK MESSAGE</span>
          {status === 'success' && <span style={styles.success}>MESSAGE SENT</span>}
          {status === 'error' && <span style={styles.error}>ERROR SENDING</span>}
        </div>
        <button 
          style={styles.closeButton} 
          onClick={() => { setIsExpanded(false); }}
          title="Collapse"
        >
          ✕
        </button>
      </div>
      <div style={styles.inputRow}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder={isMobile ? "Type message..." : "Type message to Mayor..."}
          style={styles.textarea}
          rows={isMobile ? 4 : 1}
          disabled={sending}
        />
        <div style={styles.actions}>
          <VoiceMicButton
            onTranscript={handleVoiceTranscript}
            disabled={sending}
            className="quick-input-voice-mic"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!text.trim() || sending}
            style={{
              ...styles.sendButton,
              ...(text.trim() && !sending ? {} : styles.sendButtonDisabled),
            }}
          >
            {sending ? '...' : 'SEND'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Pip-Boy color palette
const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: 'rgba(10, 10, 10, 0.98)', 
  success: 'var(--crt-phosphor)',
  error: '#FF4444',
} as const;

const styles = {
  fab: {
    position: 'absolute',
    bottom: '24px',
    right: '24px',
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    backgroundColor: colors.background,
    border: `2px solid ${colors.primary}`,
    color: colors.primary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: `0 0 15px ${colors.primaryGlow}`,
    zIndex: 1000,
    transition: 'all 0.2s ease',
    padding: 0,
  } as CSSProperties,

  container: {
    position: 'absolute',
    bottom: '24px',
    right: '24px',
    width: '400px',
    maxWidth: 'calc(100vw - 48px)',
    backgroundColor: colors.background,
    border: `2px solid ${colors.primary}`,
    borderRadius: '4px',
    padding: '12px',
    boxShadow: `0 0 20px ${colors.primaryGlow}, inset 0 0 10px ${colors.primaryGlow}`,
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
    zIndex: 1000,
    backdropFilter: 'blur(8px)',
    display: 'flex',
    flexDirection: 'column',
    animation: 'expand 0.2s ease-out',
  } as CSSProperties,

  containerMobile: {
    width: 'calc(100vw - 32px)',
    right: '16px',
    bottom: '16px',
    padding: '16px',
  } as CSSProperties,

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },

  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  label: {
    backgroundColor: colors.primaryDim,
    color: '#000',
    padding: '2px 8px',
    borderRadius: '2px',
  },

  labelFrom: {
    backgroundColor: 'transparent',
    color: colors.primaryDim,
    padding: '2px 8px',
    borderRadius: '2px',
    border: `1px solid ${colors.primaryDim}`,
  },

  closeButton: {
    background: 'transparent',
    border: 'none',
    color: colors.primaryDim,
    cursor: 'pointer',
    fontSize: '1.2rem',
    padding: '4px',
    lineHeight: 1,
  },

  success: {
    color: colors.success,
    textShadow: `0 0 5px ${colors.success}`,
    animation: 'blink-smooth 1s ease-in-out infinite',
  },

  error: {
    color: colors.error,
    textShadow: `0 0 5px ${colors.error}`,
  },

  inputRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  } as CSSProperties,

  textarea: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '1rem',
    lineHeight: '1.5',
    outline: 'none',
    resize: 'none',
    minHeight: '80px',
    padding: '8px',
    overflowY: 'auto',
    boxSizing: 'border-box',
  } as CSSProperties,

  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '8px',
  },

  sendButton: {
    backgroundColor: colors.primary,
    color: '#000',
    border: 'none',
    borderRadius: '2px',
    padding: '8px 24px',
    fontFamily: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '0.9rem',
    letterSpacing: '0.15em',
    transition: 'all 0.2s',
    minWidth: '100px',
  },

  sendButtonDisabled: {
    backgroundColor: colors.primaryDim,
    opacity: 0.5,
    cursor: 'not-allowed',
  },
} satisfies Record<string, CSSProperties>;

