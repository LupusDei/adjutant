/**
 * ProposalPage (adj-200) — full-page standalone proposal reader.
 *
 * Opened in a new browser window via the hash route `#proposal/<id>`, mirroring
 * EpicGraphPage's `#graph/<epicId>`. Fetches the proposal and renders its
 * self-contained HTML document in the sandboxed ProposalPageViewer, filling the
 * viewport with the green-phosphor chrome around it.
 */

import { useEffect, useState, type CSSProperties } from 'react';

import { api } from '../../services/api';
import type { Proposal } from '../../types';
import { ProposalPageViewer } from './ProposalPageViewer';

export interface ProposalPageProps {
  proposalId: string;
}

export function ProposalPage({ proposalId }: ProposalPageProps) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.proposals
      .get(proposalId)
      .then((data) => {
        if (cancelled) return;
        setProposal(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load the proposal.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [proposalId]);

  // Set the document title for the standalone tab.
  useEffect(() => {
    document.title = proposal?.title
      ? `${proposal.title} — Proposal`
      : `Proposal: ${proposalId}`;
  }, [proposalId, proposal?.title]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.proposalId}>{proposalId}</span>
          {proposal?.title && <span style={styles.proposalTitle}>{proposal.title}</span>}
        </div>
        <div style={styles.headerRight}>
          {proposal && (
            <span
              style={{
                ...styles.badge,
                ...(proposal.isPublic ? styles.badgePublic : styles.badgePrivate),
              }}
            >
              {proposal.isPublic ? 'PUBLIC' : 'PRIVATE'}
            </span>
          )}
        </div>
      </div>

      <div style={styles.body}>
        {loading && <div style={styles.centered}>LOADING PROPOSAL…</div>}
        {error && !loading && (
          <div style={{ ...styles.centered, color: '#FF4444' }}>
            PROPOSAL ERROR: {error}
          </div>
        )}
        {proposal && !loading && !error && (
          <ProposalPageViewer html={proposal.html} title={proposal.title} />
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    width: '100vw',
    height: '100vh',
    backgroundColor: '#0a0a0a',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", monospace',
    color: 'var(--crt-phosphor, #00ff00)',
  } satisfies CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    borderBottom: '1px solid var(--crt-phosphor-dim, #00aa00)',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flexShrink: 0,
  } satisfies CSSProperties,
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    minWidth: 0,
  } satisfies CSSProperties,
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
  } satisfies CSSProperties,
  proposalId: {
    fontSize: '0.9rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    color: 'var(--crt-phosphor-bright, #00ff00)',
    flexShrink: 0,
  } satisfies CSSProperties,
  proposalTitle: {
    fontSize: '0.8rem',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,
  badge: {
    fontSize: '0.65rem',
    padding: '3px 8px',
    border: '1px solid',
    fontWeight: 'bold',
    letterSpacing: '0.08em',
  } satisfies CSSProperties,
  badgePublic: {
    color: 'var(--pipboy-green, #00ff00)',
    borderColor: 'var(--pipboy-green, #00ff00)',
    backgroundColor: 'rgba(0, 255, 0, 0.12)',
    boxShadow: '0 0 6px var(--pipboy-green-glow, #00ff0066)',
  } satisfies CSSProperties,
  badgePrivate: {
    color: 'var(--crt-phosphor-dim, #00aa00)',
    borderColor: 'var(--crt-phosphor-dim, #00aa00)',
    backgroundColor: 'rgba(0, 170, 0, 0.06)',
  } satisfies CSSProperties,
  body: {
    flex: 1,
    minHeight: 0,
    padding: '12px 16px 16px',
    display: 'flex',
    flexDirection: 'column',
  } satisfies CSSProperties,
  centered: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    letterSpacing: '0.1em',
    fontSize: '0.9rem',
    color: 'var(--crt-phosphor-dim, #00aa00)',
  } satisfies CSSProperties,
};
