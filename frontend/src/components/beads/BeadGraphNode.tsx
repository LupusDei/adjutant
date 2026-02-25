/**
 * Custom React Flow node for bead dependency graph.
 * Renders a Pip-Boy themed bead card with status coloring,
 * type badge, ID, and title.
 */
import React, { type CSSProperties } from 'react';

import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

import type { BeadNodeData } from '../../hooks/useBeadsGraph';

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

/**
 * BeadGraphNode - Custom React Flow node component.
 * Renders a Pip-Boy styled bead card in the dependency graph.
 */
function BeadGraphNodeInner({ data }: NodeProps) {
  const nodeData = data as BeadNodeData;
  const statusColor = getStatusColor(nodeData.status);
  const isEpic = nodeData.beadType === 'epic';
  const typeLabel = TYPE_LABELS[nodeData.beadType] ?? nodeData.beadType.toUpperCase();

  const containerStyle: CSSProperties = {
    background: '#0a0a0a',
    border: `1px solid ${statusColor}`,
    borderRadius: '2px',
    padding: isEpic ? '10px 14px' : '8px 12px',
    minWidth: isEpic ? '220px' : '180px',
    maxWidth: isEpic ? '260px' : '220px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    boxShadow: `0 0 6px ${statusColor}44, inset 0 0 4px ${statusColor}22`,
    cursor: 'default',
    position: 'relative',
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

  return (
    <div style={containerStyle}>
      <Handle type="target" position={Position.Top} style={handleStyle} />

      <div style={headerStyle}>
        <span style={idStyle}>{nodeData.id}</span>
        <span style={badgeStyle}>{typeLabel}</span>
      </div>

      <div style={titleStyle}>{nodeData.title}</div>

      {nodeData.assignee && (
        <div style={assigneeStyle}>{nodeData.assignee}</div>
      )}

      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}

/** Memoized BeadGraphNode for React Flow performance. */
export const BeadGraphNode = React.memo(BeadGraphNodeInner);
