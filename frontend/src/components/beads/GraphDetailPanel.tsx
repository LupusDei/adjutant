/**
 * GraphDetailPanel - Slide-out detail panel for bead graph nodes.
 * Shows bead info (id, title, status, priority, type, assignee)
 * with Pip-Boy retro terminal styling and slide animation.
 */
import React, { useEffect, useCallback, type CSSProperties } from 'react';

import type { BeadNodeData } from '../../hooks/useBeadsGraph';

/** Props for GraphDetailPanel. */
export interface GraphDetailPanelProps {
  /** The bead data to display, or null to hide the panel. */
  bead: BeadNodeData | null;
  /** Called when the panel should close. */
  onClose: () => void;
  /** Called with bead ID when the Assign button is clicked. */
  onAssign: (beadId: string) => void;
}

/** Status-to-color mapping for badges. */
const STATUS_COLORS: Record<string, string> = {
  open: '#666666',
  in_progress: '#ffaa00',
  closed: '#00ff00',
  hooked: '#ffaa00',
  deferred: '#555555',
};

/** Get badge color for a given status. */
function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#666666';
}

/**
 * GraphDetailPanel renders a slide-out panel from the right side
 * with bead details when a node is selected in the graph.
 */
function GraphDetailPanelInner({ bead, onClose, onAssign }: GraphDetailPanelProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (bead) {
      window.addEventListener('keydown', handleKeyDown);
      return () => { window.removeEventListener('keydown', handleKeyDown); };
    }
    return undefined;
  }, [bead, handleKeyDown]);

  if (!bead) {
    return null;
  }

  const statusColor = getStatusColor(bead.status);

  return (
    <>
      {/* Backdrop overlay */}
      <div
        data-testid="graph-detail-overlay"
        style={styles.overlay}
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div style={styles.panel}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>BEAD DETAIL</span>
          <button
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close detail panel"
          >
            X
          </button>
        </div>

        {/* Bead ID */}
        <div style={styles.section}>
          <div style={styles.label}>ID</div>
          <div style={{ ...styles.value, color: statusColor, textShadow: `0 0 4px ${statusColor}66` }}>
            {bead.id}
          </div>
        </div>

        {/* Title */}
        <div style={styles.section}>
          <div style={styles.label}>TITLE</div>
          <div style={styles.value}>{bead.title}</div>
        </div>

        {/* Status badge */}
        <div style={styles.section}>
          <div style={styles.label}>STATUS</div>
          <span
            style={{
              ...styles.badge,
              color: statusColor,
              borderColor: `${statusColor}88`,
              textShadow: `0 0 4px ${statusColor}44`,
            }}
          >
            {bead.status.toUpperCase()}
          </span>
        </div>

        {/* Type */}
        <div style={styles.section}>
          <div style={styles.label}>TYPE</div>
          <span style={styles.badge}>{bead.beadType.toUpperCase()}</span>
        </div>

        {/* Priority */}
        <div style={styles.section}>
          <div style={styles.label}>PRIORITY</div>
          <div style={styles.value}>P{bead.priority}</div>
        </div>

        {/* Assignee */}
        <div style={styles.section}>
          <div style={styles.label}>ASSIGNEE</div>
          <div style={{
            ...styles.value,
            ...(bead.assignee ? {} : styles.dimText),
          }}>
            {bead.assignee ?? 'NO ASSIGNEE'}
          </div>
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <button
            style={styles.actionButton}
            onClick={() => { onAssign(bead.id); }}
          >
            ASSIGN
          </button>
        </div>
      </div>
    </>
  );
}

/** Memoized GraphDetailPanel. */
export const GraphDetailPanel = React.memo(GraphDetailPanelInner);

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 40,
  } satisfies CSSProperties,

  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: '340px',
    maxWidth: '90vw',
    backgroundColor: '#0a0a0a',
    borderLeft: '1px solid #00aa00',
    boxShadow: '-4px 0 20px rgba(0, 170, 0, 0.15), inset 2px 0 8px rgba(0, 170, 0, 0.05)',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    animation: 'graphPanelSlideIn 0.2s ease-out',
    overflow: 'hidden',
  } satisfies CSSProperties,

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid #00aa0066',
    backgroundColor: '#0d0d0d',
  } satisfies CSSProperties,

  headerTitle: {
    fontSize: '0.85rem',
    color: '#00ff00',
    letterSpacing: '0.15em',
    textShadow: '0 0 6px rgba(0, 255, 0, 0.4)',
    fontWeight: 'bold',
  } satisfies CSSProperties,

  closeButton: {
    background: 'transparent',
    border: '1px solid #00aa0066',
    color: '#00aa00',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    padding: '2px 8px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
    lineHeight: 1.4,
    transition: 'all 0.15s ease',
  } satisfies CSSProperties,

  section: {
    padding: '10px 16px',
    borderBottom: '1px solid #00550033',
  } satisfies CSSProperties,

  label: {
    fontSize: '0.6rem',
    color: '#00aa00',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    marginBottom: '3px',
  } satisfies CSSProperties,

  value: {
    fontSize: '0.8rem',
    color: '#aaffaa',
    lineHeight: 1.4,
  } satisfies CSSProperties,

  badge: {
    display: 'inline-block',
    fontSize: '0.65rem',
    padding: '2px 8px',
    border: '1px solid #00aa0066',
    borderRadius: '1px',
    color: '#00aa00',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    lineHeight: 1.3,
  } satisfies CSSProperties,

  dimText: {
    color: '#555555',
    fontStyle: 'italic',
  } satisfies CSSProperties,

  actions: {
    padding: '16px',
    marginTop: 'auto',
    borderTop: '1px solid #00aa0066',
    display: 'flex',
    gap: '8px',
  } satisfies CSSProperties,

  actionButton: {
    flex: 1,
    background: 'transparent',
    border: '1px solid #00aa00',
    color: '#00ff00',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '8px 16px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    transition: 'all 0.15s ease',
  } satisfies CSSProperties,
} as const;
