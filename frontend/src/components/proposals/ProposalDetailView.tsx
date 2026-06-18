/**
 * ProposalDetailView - Slide-out panel showing full proposal details.
 * Pip-Boy terminal aesthetic matching BeadDetailView.
 */

import { type CSSProperties, useCallback, useEffect, useState } from 'react';

import { api, publicProposalUrl } from '../../services/api';
import type { Proposal } from '../../types';
import { MarkdownBody } from '../chat/MarkdownBody';
import { getConfidenceColor, getConfidenceLabel } from './ProposalCard';
import { ProposalPageViewer } from './ProposalPageViewer';

/** Signal display configuration with labels and weights. */
const CONFIDENCE_SIGNALS = [
  { key: 'reviewerConsensus', label: 'CONSENSUS', weight: '30%' },
  { key: 'specClarity', label: 'CLARITY', weight: '20%' },
  { key: 'codebaseAlignment', label: 'ALIGNMENT', weight: '20%' },
  { key: 'riskAssessment', label: 'RISK', weight: '15%' },
  { key: 'historicalSuccess', label: 'HISTORY', weight: '15%' },
] as const;

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
  // Sharing UI state (adj-200): page-vs-detail view, in-flight publish toggle,
  // and a transient "copied" confirmation.
  const [viewAsPage, setViewAsPage] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch proposal (extracted so the error state can offer a Retry).
  const loadProposal = useCallback(() => {
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
        const raw = err instanceof Error ? err.message : 'Failed to load proposal';
        // A non-JSON response (e.g. "Unexpected token '<', \"<!DOCTYPE\"") means
        // the API didn't answer with JSON — almost always the backend briefly
        // restarting (the proxy returns the SPA shell). Show a clear, actionable
        // message instead of a raw parser error.
        const transient = /Unexpected token|<!DOCTYPE|not valid JSON|Failed to fetch|NetworkError/i.test(raw);
        setError(
          transient
            ? 'Could not reach the server (it may be restarting). Retry in a moment.'
            : raw,
        );
        setLoading(false);
      });
  }, [proposalId]);

  // Fetch proposal when ID changes
  useEffect(() => {
    loadProposal();
  }, [loadProposal]);

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

  const handlePublish = useCallback(async () => {
    if (!proposal || sharing) return;
    setSharing(true);
    setShareError(null);
    try {
      const { proposal: updated } = await api.proposals.publish(proposal.id);
      setProposal(updated);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Could not publish.');
    } finally {
      setSharing(false);
    }
  }, [proposal, sharing]);

  const handleUnpublish = useCallback(async () => {
    if (!proposal || sharing) return;
    setSharing(true);
    setShareError(null);
    try {
      const { proposal: updated } = await api.proposals.unpublish(proposal.id);
      setProposal(updated);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Could not unpublish.');
    } finally {
      setSharing(false);
    }
  }, [proposal, sharing]);

  // The public URL is derived from the share token (the GET payload carries the
  // token, not a full URL) using the same origin rule as the backend.
  const shareToken = proposal?.shareToken;
  const publicUrl = shareToken ? publicProposalUrl(shareToken) : null;

  const handleCopyLink = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      setShareError('Could not copy the link.');
    }
  }, [publicUrl]);

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
              <div>{error}</div>
              <button type="button" style={styles.retryButton} onClick={loadProposal}>
                RETRY
              </button>
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

                {/* Visibility badge — public vs private page */}
                <span style={{
                  ...styles.badge,
                  ...(proposal.isPublic ? styles.badgePublic : styles.badgePrivate),
                }}>
                  {proposal.isPublic ? 'PUBLIC' : 'PRIVATE'}
                </span>
              </div>

              {/* Share toolbar — view-as-page, publish/unpublish, copy/open link */}
              <div style={styles.shareBar}>
                <button
                  type="button"
                  style={{
                    ...styles.shareBtn,
                    ...(viewAsPage ? styles.shareBtnActive : {}),
                  }}
                  aria-pressed={viewAsPage}
                  onClick={() => { setViewAsPage((v) => !v); }}
                >
                  {viewAsPage ? 'VIEW DETAILS' : 'VIEW AS PAGE'}
                </button>

                {proposal.isPublic ? (
                  <button
                    type="button"
                    style={styles.shareBtn}
                    disabled={sharing}
                    onClick={() => { void handleUnpublish(); }}
                  >
                    {sharing ? 'WORKING…' : 'UNPUBLISH'}
                  </button>
                ) : (
                  <button
                    type="button"
                    style={styles.shareBtnPrimary}
                    disabled={sharing}
                    onClick={() => { void handlePublish(); }}
                  >
                    {sharing ? 'WORKING…' : 'PUBLISH'}
                  </button>
                )}

                {proposal.isPublic && publicUrl && (
                  <>
                    <button type="button" style={styles.shareBtn} onClick={() => { void handleCopyLink(); }}>
                      {copied ? 'LINK COPIED' : 'COPY LINK'}
                    </button>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.shareLink}
                    >
                      OPEN IN NEW TAB
                    </a>
                  </>
                )}
              </div>

              {shareError && <div style={styles.shareError}>{shareError}</div>}

              {viewAsPage ? (
                <div style={styles.pageViewerWrap}>
                  <ProposalPageViewer html={proposal.html} title={proposal.title} />
                </div>
              ) : (
                <>
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

              {/* Confidence */}
              {proposal.confidenceScore != null && (
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>CONFIDENCE</h4>

                  {/* Composite score */}
                  <div style={styles.compositeScore}>
                    <span style={{
                      ...styles.compositeNumber,
                      color: getConfidenceColor(proposal.confidenceScore),
                      textShadow: `0 0 8px ${getConfidenceColor(proposal.confidenceScore)}66`,
                    }}>
                      {proposal.confidenceScore}
                    </span>
                    <span style={{
                      ...styles.compositeLabel,
                      color: getConfidenceColor(proposal.confidenceScore),
                    }}>
                      {getConfidenceLabel(proposal.confidenceScore)}
                    </span>
                  </div>

                  {/* Signal breakdown */}
                  {proposal.confidenceSignals && (
                    <div style={styles.signalBreakdown}>
                      {CONFIDENCE_SIGNALS.map(({ key, label, weight }) => {
                        const value = proposal.confidenceSignals?.[key] ?? 0;
                        return (
                          <div key={key} style={styles.signalRow}>
                            <div style={styles.signalHeader}>
                              <span style={styles.signalLabel}>{label} ({weight})</span>
                              <span style={styles.signalValue}>{value}</span>
                            </div>
                            <div style={styles.signalBarTrack}>
                              <div
                                style={{
                                  ...styles.signalBarFill,
                                  width: `${Math.min(100, Math.max(0, value))}%`,
                                  backgroundColor: getConfidenceColor(value),
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Review round */}
                  {proposal.reviewRound != null && (
                    <div style={styles.reviewRound}>
                      REVIEW ROUND: {proposal.reviewRound}
                    </div>
                  )}
                </div>
              )}

              {/* Description — proposals are long-form markdown reads. */}
              <div style={styles.section}>
                <h4 style={styles.sectionTitle}>DESCRIPTION</h4>
                <div style={styles.description}>
                  <MarkdownBody>{proposal.description}</MarkdownBody>
                </div>
              </div>
                </>
              )}

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
    // Proposals are long-form reads — use the screen. Wide panel, capped so it
    // never fully covers the list on large displays.
    width: 'min(960px, 92vw)',
    backgroundColor: 'var(--theme-bg-screen)',
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
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  retryButton: {
    padding: '6px 18px',
    background: 'transparent',
    color: 'var(--crt-phosphor)',
    border: '1px solid var(--crt-phosphor-dim)',
    cursor: 'pointer',
    fontFamily: 'inherit',
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
  badgePublic: {
    color: 'var(--pipboy-green, #00ff00)',
    borderColor: 'var(--pipboy-green, #00ff00)',
    backgroundColor: 'rgba(0, 255, 0, 0.12)',
    boxShadow: '0 0 6px var(--pipboy-green-glow, #00ff0066)',
  },
  badgePrivate: {
    color: 'var(--crt-phosphor-dim, #00aa00)',
    borderColor: 'var(--crt-phosphor-dim, #00aa00)',
    backgroundColor: 'rgba(0, 170, 0, 0.06)',
  },
  shareBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '14px',
    paddingBottom: '14px',
    borderBottom: '1px solid rgba(0, 255, 0, 0.1)',
  },
  shareBtn: {
    background: 'transparent',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    color: 'var(--crt-phosphor, #00ff00)',
    padding: '6px 14px',
    fontSize: '0.7rem',
    fontFamily: '"Share Tech Mono", monospace',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  shareBtnActive: {
    backgroundColor: 'rgba(0, 255, 0, 0.12)',
    boxShadow: 'inset 0 0 6px var(--pipboy-green-glow, #00ff0066)',
  },
  shareBtnPrimary: {
    background: 'transparent',
    border: '1px solid var(--pipboy-green, #00ff00)',
    color: 'var(--pipboy-green, #00ff00)',
    padding: '6px 14px',
    fontSize: '0.7rem',
    fontFamily: '"Share Tech Mono", monospace',
    fontWeight: 'bold',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    boxShadow: '0 0 4px var(--pipboy-green-glow, #00ff0066)',
  },
  shareLink: {
    background: 'transparent',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    color: 'var(--crt-phosphor, #00ff00)',
    padding: '6px 14px',
    fontSize: '0.7rem',
    fontFamily: '"Share Tech Mono", monospace',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    textDecoration: 'none',
  },
  shareError: {
    color: '#FF4444',
    fontSize: '0.75rem',
    marginBottom: '12px',
    letterSpacing: '0.05em',
  },
  pageViewerWrap: {
    // The viewer fills the remaining panel height for a comfortable read.
    height: '70vh',
    minHeight: '420px',
    marginBottom: '16px',
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
  compositeScore: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    marginBottom: '14px',
  },
  compositeNumber: {
    fontSize: '2rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.05em',
  },
  compositeLabel: {
    fontSize: '0.85rem',
    fontWeight: 'bold',
    letterSpacing: '0.15em',
  },
  signalBreakdown: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '12px',
  },
  signalRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  signalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  signalLabel: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
  },
  signalValue: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor)',
    fontWeight: 'bold',
  },
  signalBarTrack: {
    height: '6px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderRadius: '1px',
    overflow: 'hidden',
  },
  signalBarFill: {
    height: '100%',
    borderRadius: '1px',
    transition: 'width 0.3s ease',
  },
  reviewRound: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    marginTop: '4px',
  },
  description: {
    fontSize: '0.9rem',
    color: 'var(--crt-phosphor)',
    lineHeight: 1.65,
    // MarkdownBody renders structured blocks — no pre-wrap (it would double the
    // spacing of markdown paragraphs). Let long tokens/URLs wrap.
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
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
