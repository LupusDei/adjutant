/**
 * Custom React Flow node for bead dependency graph.
 * Renders a Pip-Boy themed bead card with status coloring,
 * type badge, ID, and title.
 * Supports selected state and collapse/expand for epic nodes.
 */
import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

import type { BeadNodeData } from '../../hooks/useBeadsGraph';

/** Extended node data with UI state injected by DependencyGraphView. */
interface BeadGraphNodeUIData extends BeadNodeData {
  /** Whether this node is currently selected. */
  selected?: boolean;
  /** Callback to toggle collapse state. */
  onToggleCollapse?: (nodeId: string) => void;
}

/** Status-to-color mapping for Pip-Boy theme. */
const STATUS_COLORS: Record<string, string> = {
  open: '#666666',
  in_progress: '#ffaa00',
  closed: '#00ff00',
  blocked: '#ff4444',
  hooked: '#ffaa00',
  deferred: '#555555',
};

/** Type badge labels. */
const TYPE_LABELS: Record<string, string> = {
  epic: 'EPIC',
  task: 'TASK',
  bug: 'BUG',
};

/** Get the border/accent color for a given status. */
function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#666666';
}

/** Get the CSS animation class for a status change. */
function getStatusChangeClass(newStatus: string): string {
  switch (newStatus) {
    case 'closed':
      return 'node-status-changed-green';
    case 'in_progress':
    case 'hooked':
      return 'node-status-changed-amber';
    default:
      return 'node-status-changed';
  }
}

/**
 * BeadGraphNode - Custom React Flow node component.
 * Renders a Pip-Boy styled bead card in the dependency graph.
 * Supports selected state with bright glow highlight and
 * collapse/expand for epic nodes with children.
 */
function BeadGraphNodeInner({ data }: NodeProps) {
  // Safe cast: data matches BeadNodeData with optional UI flags injected by DependencyGraphView
  const nodeData = data as BeadGraphNodeUIData;
  const statusColor = getStatusColor(nodeData.status);
  const isEpic = nodeData.beadType === 'epic';
  const isSelected = nodeData.selected === true;
  const isCollapsed = nodeData.collapsed === true;
  const collapsedCount = nodeData.collapsedChildCount ?? 0;
  const hasCollapseButton = isEpic && (isCollapsed || nodeData.onToggleCollapse != null);
  const typeLabel = TYPE_LABELS[nodeData.beadType] ?? nodeData.beadType.toUpperCase();

  // Track previous status to detect changes and trigger animation
  const prevStatusRef = useRef<string>(nodeData.status);
  const [animClass, setAnimClass] = useState<string>('');

  useEffect(() => {
    if (prevStatusRef.current !== nodeData.status) {
      const cls = getStatusChangeClass(nodeData.status);
      setAnimClass(cls);
      prevStatusRef.current = nodeData.status;

      // Clear animation class after animation completes (800ms matches CSS)
      const timer = setTimeout(() => {
        setAnimClass('');
      }, 800);
      return () => { clearTimeout(timer); };
    }
    return undefined;
  }, [nodeData.status]);

  const handleCollapseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      nodeData.onToggleCollapse?.(nodeData.id);
    },
    [nodeData]
  );

  const selectedGlow = isSelected
    ? `0 0 12px #00ff00aa, 0 0 24px #00ff0044, inset 0 0 8px #00ff0022`
    : `0 0 6px ${statusColor}44, inset 0 0 4px ${statusColor}22`;

  const containerStyle: CSSProperties = {
    background: isSelected ? '#0d1a0d' : '#0a0a0a',
    border: `${isSelected ? '2px' : '1px'} solid ${isSelected ? '#00ff00' : statusColor}`,
    borderRadius: '2px',
    padding: isEpic ? '10px 14px' : '8px 12px',
    minWidth: isEpic ? '220px' : '180px',
    maxWidth: isEpic ? '260px' : '220px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    boxShadow: selectedGlow,
    cursor: 'pointer',
    position: 'relative',
    transition: 'box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease',
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
    gap: '6px',
  };

  const idStyle: CSSProperties = {
    fontSize: isEpic ? '0.7rem' : '0.65rem',
    color: statusColor,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
    textShadow: `0 0 4px ${statusColor}66`,
  };

  const badgeStyle: CSSProperties = {
    fontSize: '0.55rem',
    padding: '1px 4px',
    border: `1px solid ${statusColor}88`,
    borderRadius: '1px',
    color: statusColor,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
  };

  const titleStyle: CSSProperties = {
    fontSize: isEpic ? '0.72rem' : '0.65rem',
    color: '#aaffaa',
    lineHeight: '1.3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  };

  const assigneeStyle: CSSProperties = {
    fontSize: '0.55rem',
    color: '#00aa00',
    marginTop: '3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    letterSpacing: '0.03em',
  };

  const handleStyle: CSSProperties = {
    background: statusColor,
    border: 'none',
    width: '6px',
    height: '6px',
  };

  const collapseButtonStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginTop: '5px',
    padding: '2px 6px',
    background: 'transparent',
    border: '1px solid #00aa0066',
    borderRadius: '1px',
    color: '#00aa00',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.55rem',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    transition: 'all 0.15s ease',
    width: 'fit-content',
  };

  const collapsedBadgeStyle: CSSProperties = {
    fontSize: '0.5rem',
    padding: '1px 4px',
    background: '#00aa0022',
    border: '1px solid #00aa0044',
    borderRadius: '1px',
    color: '#00ff00',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={containerStyle} className={animClass || undefined}>
      <Handle type="target" position={Position.Top} style={handleStyle} />

      <div style={headerStyle}>
        <span style={idStyle}>{nodeData.id}</span>
        <span style={badgeStyle}>{typeLabel}</span>
      </div>

      <div style={titleStyle}>{nodeData.title}</div>

      {nodeData.assignee && (
        <div style={assigneeStyle}>{nodeData.assignee}</div>
      )}

      {hasCollapseButton && (
        <button
          style={collapseButtonStyle}
          onClick={handleCollapseClick}
          title={isCollapsed ? 'Expand sub-tree' : 'Collapse sub-tree'}
        >
          {isCollapsed ? '+ EXPAND' : '- COLLAPSE'}
          {isCollapsed && collapsedCount > 0 && (
            <span style={collapsedBadgeStyle}>+{collapsedCount}</span>
          )}
        </button>
      )}

      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}

/** Memoized BeadGraphNode for React Flow performance. */
export const BeadGraphNode = React.memo(BeadGraphNodeInner);
