/**
 * BeadDetailView - Slide-out panel showing comprehensive bead information.
 * Pip-Boy terminal aesthetic matching the rest of the UI.
 */

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useMode } from '../../contexts/ModeContext';
import type { BeadDetail, BeadDependency } from '../../types';

export interface BeadDetailViewProps {
  beadId: string | null;
  onClose: () => void;
  onBeadNavigate?: (beadId: string) => void;
}

/**
 * Gets priority display info.
 */
function getPriorityInfo(priority: number): { label: string; color: string } {
  switch (priority) {
    case 0:
      return { label: 'P0 - CRITICAL', color: '#FF4444' };
    case 1:
      return { label: 'P1 - HIGH', color: '#FFB000' };
    case 2:
      return { label: 'P2 - NORMAL', color: 'var(--crt-phosphor)' };
    case 3:
      return { label: 'P3 - LOW', color: 'var(--crt-phosphor-dim)' };
    case 4:
      return { label: 'P4 - LOWEST', color: '#666666' };
    default:
      return { label: `P${priority}`, color: 'var(--crt-phosphor-dim)' };
  }
}

/**
 * Gets status display info.
 * In Swarm mode, hooked is displayed as IN PROGRESS.
 */
function getStatusInfo(status: string, isSwarm = false): { label: string; color: string } {
  const normalized = isSwarm && status.toLowerCase() === 'hooked' ? 'in_progress' : status.toLowerCase();
  switch (normalized) {
    case 'open':
      return { label: 'OPEN', color: '#00FF00' };
    case 'hooked':
      return { label: 'HOOKED', color: '#00FFFF' };
    case 'in_progress':
      return { label: 'IN PROGRESS', color: '#00FF88' };
    case 'blocked':
      return { label: 'BLOCKED', color: '#FF6B35' };
    case 'closed':
      return { label: 'CLOSED', color: '#666666' };
    default:
      return { label: status.toUpperCase(), color: 'var(--crt-phosphor-dim)' };
  }
}

/**
 * Formats a timestamp for display.
 */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return '—';
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

/**
 * Copies text to clipboard.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders dependency relationship section.
 */
function DependencySection({
  title,
  dependencies,
  type,
  onBeadClick,
}: {
  title: string;
  dependencies: BeadDependency[];
  type: 'blocks' | 'blocked_by';
  onBeadClick: (id: string) => void;
}) {
  const filtered = dependencies.filter(d => d.type === type);
  if (filtered.length === 0) return null;

  return (
    <div style={styles.section}>
      <h4 style={styles.sectionTitle}>{title}</h4>
      <div style={styles.depList}>
        {filtered.map((dep) => {
          const targetId = type === 'blocks' ? dep.dependsOnId : dep.issueId;
          return (
            <button
              key={`${dep.issueId}-${dep.dependsOnId}`}
              style={styles.depItem}
              onClick={() => { onBeadClick(targetId); }}
            >
              {targetId}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Derives parent epic IDs from a bead's ID hierarchy and dependencies.
 * A bead like "adj-001.1.2" has parent "adj-001.1" and root epic "adj-001".
 * Also checks "blocks" dependencies for parent-like IDs.
 */
function getParentEpicIds(beadId: string, dependencies: BeadDependency[]): string[] {
  const parents = new Set<string>();

  // ID hierarchy: remove last ".N" segment(s) to find parents
  const parts = beadId.split('.');
  if (parts.length > 1) {
    // Walk up the hierarchy: adj-001.1.2 -> adj-001.1 -> adj-001
    for (let i = parts.length - 1; i >= 1; i--) {
      parents.add(parts.slice(0, i).join('.'));
    }
  }

  // Dependencies: "blocks" means this bead blocks another (i.e., is a child of it).
  // Only add targets that are strict prefixes of this bead's ID (true parent relationship).
  const blocksDeps = dependencies.filter(d => d.type === 'blocks');
  for (const dep of blocksDeps) {
    const targetId = dep.issueId;
    if (beadId.startsWith(targetId + '.')) {
      parents.add(targetId);
    }
  }

  // Sort by depth: shallowest parent first (fewest dots)
  return Array.from(parents).sort((a, b) => a.split('.').length - b.split('.').length);
}

export function BeadDetailView({ beadId, onClose, onBeadNavigate }: BeadDetailViewProps) {
  const { isSwarm } = useMode();
  const [bead, setBead] = useState<BeadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch bead details when ID changes
  useEffect(() => {
    if (!beadId) {
      setBead(null);
      return;
    }

    setLoading(true);
    setError(null);

    api.beads.get(beadId)
      .then((data) => {
        setBead(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load bead';
        setError(message);
        setLoading(false);
      });
  }, [beadId]);

  const handleCopyId = useCallback(() => {
    if (!bead) return;
    void copyToClipboard(bead.id).then((didCopy) => {
      if (didCopy) {
        setCopied(true);
        setTimeout(() => { setCopied(false); }, 2000);
      }
    });
  }, [bead]);

  const handleBeadClick = useCallback((id: string) => {
    if (onBeadNavigate) {
      onBeadNavigate(id);
    }
  }, [onBeadNavigate]);

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

  // Don't render if no bead selected
  if (!beadId) return null;

  const priorityInfo = bead ? getPriorityInfo(bead.priority) : null;
  const statusInfo = bead ? getStatusInfo(bead.status, isSwarm) : null;

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
          <h2 style={styles.headerTitle}>BEAD DETAIL</h2>
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

          {bead && !loading && (
            <>
              {/* ID with copy button */}
              <div style={styles.idRow}>
                <span style={styles.beadId}>{bead.id}</span>
                <button
                  style={styles.copyButton}
                  onClick={handleCopyId}
                  title="Copy ID"
                >
                  {copied ? '✓' : '⎘'}
                </button>
              </div>

              {/* Title */}
              <h3 style={styles.title}>{bead.title}</h3>

              {/* Status and Priority badges */}
              <div style={styles.badges}>
                {statusInfo && (
                  <span style={{ ...styles.badge, backgroundColor: statusInfo.color + '20', borderColor: statusInfo.color, color: statusInfo.color }}>
                    {statusInfo.label}
                  </span>
                )}
                {priorityInfo && (
                  <span style={{ ...styles.badge, backgroundColor: priorityInfo.color + '20', borderColor: priorityInfo.color, color: priorityInfo.color }}>
                    {priorityInfo.label}
                  </span>
                )}
                <span style={styles.typeBadge}>
                  {bead.type.toUpperCase()}
                </span>
              </div>

              {/* Labels */}
              {bead.labels.length > 0 && (
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>LABELS</h4>
                  <div style={styles.labels}>
                    {bead.labels.map((label) => (
                      <span key={label} style={styles.label}>{label}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              {bead.description && (
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>DESCRIPTION</h4>
                  <div style={styles.description}>
                    {bead.description}
                  </div>
                </div>
              )}

              {/* Assignment Info */}
              <div style={styles.section}>
                <h4 style={styles.sectionTitle}>ASSIGNMENT</h4>
                <div style={styles.infoGrid}>
                  <span style={styles.infoLabel}>Assignee:</span>
                  <span style={styles.infoValue}>{bead.assignee ?? '—'}</span>

                  <span style={styles.infoLabel}>Rig:</span>
                  <span style={styles.infoValue}>{bead.rig ?? 'Town'}</span>

                  <span style={styles.infoLabel}>Source:</span>
                  <span style={styles.infoValue}>{bead.source}</span>
                </div>
              </div>

              {/* Agent Status (for in_progress work) */}
              {bead.agentState && (
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>AGENT STATUS</h4>
                  <div style={styles.agentStatus}>
                    <span style={{
                      ...styles.agentState,
                      color: bead.agentState === 'working' ? '#00FF00'
                           : bead.agentState === 'stuck' ? '#FF4444'
                           : bead.agentState === 'stale' ? '#FFB000'
                           : 'var(--crt-phosphor-dim)'
                    }}>
                      {bead.agentState.toUpperCase()}
                    </span>
                  </div>
                </div>
              )}

              {/* Parent Epic */}
              {(() => {
                const parentIds = getParentEpicIds(bead.id, bead.dependencies);
                if (parentIds.length === 0) return null;
                return (
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>PARENT EPIC</h4>
                    <div style={styles.depList}>
                      {parentIds.map((parentId) => (
                        <button
                          key={parentId}
                          style={styles.depItem}
                          onClick={() => { handleBeadClick(parentId); }}
                        >
                          {parentId}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Dependencies */}
              <DependencySection
                title="BLOCKS"
                dependencies={bead.dependencies}
                type="blocks"
                onBeadClick={handleBeadClick}
              />
              <DependencySection
                title="BLOCKED BY"
                dependencies={bead.dependencies}
                type="blocked_by"
                onBeadClick={handleBeadClick}
              />

              {/* Related Beads */}
              {(bead.hookBead ?? bead.roleBead) && (
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>RELATED</h4>
                  <div style={styles.infoGrid}>
                    {bead.hookBead && (
                      <>
                        <span style={styles.infoLabel}>Hook Bead:</span>
                        <button
                          style={styles.linkedBead}
                          onClick={() => { handleBeadClick(bead.hookBead ?? ''); }}
                        >
                          {bead.hookBead}
                        </button>
                      </>
                    )}
                    {bead.roleBead && (
                      <>
                        <span style={styles.infoLabel}>Role Bead:</span>
                        <button
                          style={styles.linkedBead}
                          onClick={() => { handleBeadClick(bead.roleBead ?? ''); }}
                        >
                          {bead.roleBead}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div style={styles.section}>
                <h4 style={styles.sectionTitle}>TIMESTAMPS</h4>
                <div style={styles.infoGrid}>
                  <span style={styles.infoLabel}>Created:</span>
                  <span style={styles.infoValue}>{formatTimestamp(bead.createdAt)}</span>

                  <span style={styles.infoLabel}>Updated:</span>
                  <span style={styles.infoValue}>{formatTimestamp(bead.updatedAt)}</span>

                  {bead.closedAt && (
                    <>
                      <span style={styles.infoLabel}>Closed:</span>
                      <span style={styles.infoValue}>{formatTimestamp(bead.closedAt)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Flags */}
              {bead.pinned && (
                <div style={styles.pinnedBadge}>
                  📌 PINNED
                </div>
              )}
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
  idRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  beadId: {
    fontSize: '0.9rem',
    color: 'var(--crt-phosphor-bright)',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  copyButton: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontSize: '0.9rem',
    padding: '2px 6px',
    cursor: 'pointer',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '1.1rem',
    color: 'var(--crt-phosphor)',
    fontWeight: 'normal',
    lineHeight: 1.4,
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
  typeBadge: {
    fontSize: '0.7rem',
    padding: '4px 8px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.05em',
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
  labels: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  label: {
    fontSize: '0.7rem',
    padding: '2px 6px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
  },
  description: {
    fontSize: '0.85rem',
    color: 'var(--crt-phosphor)',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
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
  agentStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  agentState: {
    fontSize: '0.85rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  depList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  depItem: {
    fontSize: '0.75rem',
    padding: '4px 8px',
    backgroundColor: 'rgba(0, 255, 255, 0.1)',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor-bright)',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", monospace',
  },
  linkedBead: {
    fontSize: '0.8rem',
    background: 'none',
    border: 'none',
    color: 'var(--crt-phosphor-bright)',
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: 0,
    fontFamily: '"Share Tech Mono", monospace',
  },
  pinnedBadge: {
    marginTop: '16px',
    padding: '8px',
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    border: '1px solid #FFD700',
    color: '#FFD700',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textAlign: 'center',
  },
} satisfies Record<string, CSSProperties>;
