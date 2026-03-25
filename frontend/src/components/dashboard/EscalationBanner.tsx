import React, { useState, useCallback, type CSSProperties } from 'react';

import { api } from '../../services/api';

interface EscalationBannerProps {
  /** Project ID to submit vision context for. */
  projectId: string;
  /** Called after vision context is submitted. */
  onSubmitted?: () => void;
}

const colors = {
  amber: '#FFAA00',
  amberDim: '#AA7700',
  amberGlow: '#FFAA0066',
  primaryDim: 'var(--crt-phosphor-dim)',
  background: 'var(--theme-bg-screen)',
} as const;

const styles = {
  banner: {
    border: `1px solid ${colors.amber}`,
    background: 'rgba(255, 170, 0, 0.05)',
    padding: '16px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    boxShadow: `0 0 12px ${colors.amberGlow}, inset 0 0 12px ${colors.amberGlow}`,
  } as CSSProperties,

  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '10px',
  } as CSSProperties,

  warningIcon: {
    fontSize: '1rem',
    color: colors.amber,
    textShadow: `0 0 8px ${colors.amberGlow}`,
    letterSpacing: '0.1em',
  } as CSSProperties,

  title: {
    fontSize: '0.9rem',
    fontWeight: 'bold',
    color: colors.amber,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    textShadow: `0 0 8px ${colors.amberGlow}`,
    margin: 0,
  } as CSSProperties,

  description: {
    fontSize: '0.75rem',
    color: colors.amberDim,
    lineHeight: 1.5,
    marginBottom: '12px',
  } as CSSProperties,

  textarea: {
    width: '100%',
    minHeight: '80px',
    background: 'rgba(0, 0, 0, 0.4)',
    border: `1px solid ${colors.amberDim}`,
    color: colors.amber,
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    padding: '8px',
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box',
  } as CSSProperties,

  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '10px',
  } as CSSProperties,

  submitButton: {
    background: 'transparent',
    border: `1px solid ${colors.amber}`,
    color: colors.amber,
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    padding: '6px 16px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    transition: 'all 0.2s',
  } as CSSProperties,

  submitButtonHover: {
    background: `${colors.amber}22`,
    boxShadow: `0 0 8px ${colors.amberGlow}`,
  },

  dismissButton: {
    background: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    color: colors.primaryDim,
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    padding: '6px 12px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  } as CSSProperties,

  successMessage: {
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor)',
    textShadow: '0 0 8px var(--crt-phosphor-glow)',
    textAlign: 'center',
    padding: '8px',
  } as CSSProperties,
} as const;

/** Prominent banner shown when auto-develop is paused and needs user vision input. */
export const EscalationBanner: React.FC<EscalationBannerProps> = ({
  projectId,
  onSubmitted,
}) => {
  const [visionText, setVisionText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!visionText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.projects.updateAutoDevelop(projectId, true, visionText.trim());
      setSubmitted(true);
      onSubmitted?.();
    } catch {
      // Keep the banner open so user can retry
    } finally {
      setSubmitting(false);
    }
  }, [projectId, visionText, submitting, onSubmitted]);

  if (dismissed) return null;

  if (submitted) {
    return (
      <div style={styles.banner}>
        <p style={styles.successMessage}>VISION CONTEXT UPDATED. AUTO-DEVELOP RESUMING.</p>
      </div>
    );
  }

  return (
    <div style={styles.banner}>
      <div style={styles.header}>
        <span style={styles.warningIcon}>[!]</span>
        <h3 style={styles.title}>ESCALATION: VISION UPDATE REQUIRED</h3>
      </div>
      <p style={styles.description}>
        Auto-develop has paused because confidence scores dropped below the gate threshold.
        The system needs updated vision context to continue generating aligned proposals.
        Provide direction below to resume the auto-develop loop.
      </p>
      <textarea
        style={styles.textarea}
        value={visionText}
        onChange={(e) => { setVisionText(e.target.value); }}
        placeholder="Describe your current priorities, direction changes, or constraints..."
        disabled={submitting}
      />
      <div style={styles.actions}>
        <button
          type="button"
          style={styles.dismissButton}
          onClick={() => { setDismissed(true); }}
        >
          DISMISS
        </button>
        <button
          type="button"
          style={{
            ...styles.submitButton,
            ...(hovered ? styles.submitButtonHover : {}),
            ...(submitting ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
          }}
          onClick={() => { void handleSubmit(); }}
          onMouseEnter={() => { setHovered(true); }}
          onMouseLeave={() => { setHovered(false); }}
          disabled={submitting || !visionText.trim()}
        >
          {submitting ? 'SUBMITTING...' : 'SUBMIT VISION'}
        </button>
      </div>
    </div>
  );
};

export default EscalationBanner;
