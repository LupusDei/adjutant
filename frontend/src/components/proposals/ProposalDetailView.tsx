/**
 * ProposalDetailView - Slide-out panel showing full proposal details.
 * Pip-Boy terminal aesthetic matching BeadDetailView.
 */

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { Proposal } from '../../types';

export interface ProposalDetailViewProps {
  proposalId: string | null;
  onClose: () => void;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onComplete: (id: string) => void;
  onSendToAgent: (proposal: Proposal) => void;
  onDiscuss: (proposal: Proposal) => void;
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

export function ProposalDetailView({
  proposalId,
  onClose,
  onAccept,
  onDismiss,
  onComplete,
  onSendToAgent,
  onDiscuss,
}: ProposalDetailViewProps) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch proposal when ID changes
  useEffect(() => {
    if (!proposalId) {
      setProposal(null);
      return;
    }

    setLoading(true);
    setError(null);

    api.proposals.get(proposalId)
      .then((data) => {
        setProposal(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load proposal';
        setError(message);
        setLoading(false);
      });
  }, [proposalId]);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  const handleAccept = useCallback(() => {
    if (proposal) onAccept(proposal.id);
  }, [proposal, onAccept]);

  const handleDismiss = useCallback(() => {
    if (proposal) onDismiss(proposal.id);
  }, [proposal, onDismiss]);

  const handleComplete = useCallback(() => {
    if (proposal) onComplete(proposal.id);
  }, [proposal, onComplete]);

  const handleSendToAgent = useCallback(() => {
    if (proposal) onSendToAgent(proposal);
  }, [proposal, onSendToAgent]);

  const handleDiscuss = useCallback(() => {
    if (proposal) onDiscuss(proposal);
  }, [proposal, onDiscuss]);

  if (!proposalId) return null;

  const isPending = proposal?.status === 'pending';
  const isAccepted = proposal?.status === 'accepted';

  return (
    <>
      {/* Backdrop */}
      <div style={styles.backdrop} onClick={onClose} />

      {/* Panel */}
      <div style={styles.panel}>
        {/* Header */}
        <div style={styles.header}>
          <button style={styles.closeButton} onClick={onClose} aria-label="Close">
            ×
          </button>
          <h2 style={styles.headerTitle}>PROPOSAL DETAIL</h2>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {loading && (
            <div style={styles.loadingState}>
              <div style={styles.loadingPulse} />
              LOADING...
            </div>
          )}

          {error && (
            <div style={styles.errorState}>
              ERROR: {error}
            </div>
          )}

          {proposal && !loading && (
            <>
              {/* Title */}
              <h3 style={styles.title}>{proposal.title}</h3>

              {/* Type + Status badges */}
              <div style={styles.badges}>
                <span style={{
                  ...styles.badge,
                  ...(proposal.type === 'product' ? styles.badgeProduct : styles.badgeEngineering),
                }}>
                  {proposal.type === 'product' ? 'PRODUCT' : 'ENGINEERING'}
                </span>
                <span style={{
                  ...styles.badge,
                  ...(proposal.status === 'pending' ? styles.statusPending
                    : proposal.status === 'accepted' ? styles.statusAccepted
                    : proposal.status === 'completed' ? styles.statusCompleted
                    : styles.statusDismissed),
                }}>
                  {proposal.status.toUpperCase()}
                </span>
              </div>

              {/* Metadata */}
              <div style={styles.section}>
                <h4 style={styles.sectionTitle}>METADATA</h4>
                <div style={styles.infoGrid}>
                  <span style={styles.infoLabel}>Author:</span>
                  <span style={styles.infoValue}>{proposal.author}</span>

                  <span style={styles.infoLabel}>Project:</span>
                  <span style={styles.infoValue}>{proposal.project.toUpperCase()}</span>

                  <span style={styles.infoLabel}>Created:</span>
                  <span style={styles.infoValue}>{formatTimestamp(proposal.createdAt)}</span>

                  <span style={styles.infoLabel}>Updated:</span>
                  <span style={styles.infoValue}>{formatTimestamp(proposal.updatedAt)}</span>
                </div>
              </div>

              {/* Description */}
              <div style={styles.section}>
                <h4 style={styles.sectionTitle}>DESCRIPTION</h4>
                <div style={styles.description}>
                  {proposal.description}
                </div>
              </div>

              {/* Actions */}
              <div style={styles.actions}>
                {isPending && (
                  <>
                    <button style={styles.acceptBtn} onClick={handleAccept}>
                      ACCEPT
                    </button>
                    <button style={styles.discussBtn} onClick={handleDiscuss}>
                      DISCUSS
                    </button>
                    <button style={styles.dismissBtn} onClick={handleDismiss}>
                      DISMISS
                    </button>
                  </>
                )}
                {isAccepted && (
                  <>
                    <button style={styles.completeBtn} onClick={handleComplete}>
                      COMPLETE
                    </button>
                    <button style={styles.sendBtn} onClick={handleSendToAgent}>
                      SEND TO AGENT
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 999,
  },
  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: '400px',
    maxWidth: '90vw',
    backgroundColor: '#0A0A0A',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRight: 'none',
    boxShadow: '-4px 0 20px rgba(0, 255, 0, 0.1)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", monospace',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '2px solid var(--crt-phosphor-dim)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  closeButton: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontSize: '1.5rem',
    width: '32px',
    height: '32px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  headerTitle: {
    margin: 0,
    fontSize: '1rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.15em',
  },
  content: {
    flex: 1,
    padding: '16px',
    overflowY: 'auto',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    gap: '16px',
  },
  loadingPulse: {
    width: '40px',
    height: '40px',
    border: '2px solid var(--crt-phosphor-dim)',
    borderTopColor: 'var(--crt-phosphor)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorState: {
    padding: '24px',
    color: '#FF4444',
    textAlign: 'center',
    letterSpacing: '0.1em',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '1.1rem',
    color: 'var(--crt-phosphor)',
    fontWeight: 'normal',
    lineHeight: 1.4,
    textTransform: 'uppercase',
  },
  badges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '16px',
  },
  badge: {
    fontSize: '0.7rem',
    padding: '4px 8px',
    border: '1px solid',
    fontWeight: 'bold',
    letterSpacing: '0.05em',
  },
  badgeProduct: {
    color: 'var(--pipboy-green, #00ff00)',
    borderColor: 'var(--pipboy-green, #00ff00)',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
  },
  badgeEngineering: {
    color: '#ffaa00',
    borderColor: '#ffaa00',
    backgroundColor: 'rgba(255, 170, 0, 0.1)',
  },
  statusPending: {
    color: 'var(--crt-phosphor-dim)',
    borderColor: 'var(--crt-phosphor-dim)',
    backgroundColor: 'rgba(0, 255, 0, 0.05)',
  },
  statusAccepted: {
    color: 'var(--pipboy-green, #00ff00)',
    borderColor: 'var(--pipboy-green, #00ff00)',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
  },
  statusCompleted: {
    color: '#00ccff',
    borderColor: '#00ccff',
    backgroundColor: 'rgba(0, 204, 255, 0.1)',
  },
  statusDismissed: {
    color: '#666',
    borderColor: '#666',
    backgroundColor: 'rgba(102, 102, 102, 0.1)',
  },
  section: {
    marginBottom: '16px',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(0, 255, 0, 0.1)',
  },
  sectionTitle: {
    margin: '0 0 8px 0',
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.15em',
    fontWeight: 'normal',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '6px 12px',
    fontSize: '0.8rem',
  },
  infoLabel: {
    color: 'var(--crt-phosphor-dim)',
  },
  infoValue: {
    color: 'var(--crt-phosphor)',
    wordBreak: 'break-all',
  },
  description: {
    fontSize: '0.85rem',
    color: 'var(--crt-phosphor)',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    paddingTop: '8px',
  },
  acceptBtn: {
    background: 'transparent',
    border: '1px solid var(--pipboy-green, #00ff00)',
    color: 'var(--pipboy-green, #00ff00)',
    padding: '6px 16px',
    fontSize: '0.75rem',
    fontFamily: '"Share Tech Mono", monospace',
    fontWeight: 'bold',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  discussBtn: {
    background: 'transparent',
    border: '1px solid #ffaa00',
    color: '#ffaa00',
    padding: '6px 16px',
    fontSize: '0.75rem',
    fontFamily: '"Share Tech Mono", monospace',
    fontWeight: 'bold',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  dismissBtn: {
    background: 'transparent',
    border: '1px solid #666',
    color: '#666',
    padding: '6px 16px',
    fontSize: '0.75rem',
    fontFamily: '"Share Tech Mono", monospace',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  completeBtn: {
    background: 'transparent',
    border: '1px solid #00ccff',
    color: '#00ccff',
    padding: '6px 16px',
    fontSize: '0.75rem',
    fontFamily: '"Share Tech Mono", monospace',
    fontWeight: 'bold',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  sendBtn: {
    background: 'transparent',
    border: '1px solid var(--pipboy-green, #00ff00)',
    color: 'var(--pipboy-green, #00ff00)',
    padding: '6px 16px',
    fontSize: '0.75rem',
    fontFamily: '"Share Tech Mono", monospace',
    fontWeight: 'bold',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    boxShadow: '0 0 4px var(--pipboy-green-glow, #00ff0066)',
  },
} satisfies Record<string, CSSProperties>;
