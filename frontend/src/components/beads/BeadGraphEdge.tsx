/**
 * Custom React Flow edge component for bead dependency graph.
 * Features hover highlight with glow effect and tooltip showing
 * the dependency relationship.
 */
import React, { useState, useCallback } from 'react';

import {
  BaseEdge,
  getSmoothStepPath,
  EdgeLabelRenderer,
} from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

/**
 * BeadGraphEdge - Custom edge with hover highlight and tooltip.
 *
 * Default: green (#00aa00) at 60% opacity, 1.5px width.
 * Hover: bright green (#00ff00), 2.5px width, glow effect.
 * Shows tooltip on hover with "source depends on target" relationship.
 */
function BeadGraphEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  source,
  target,
  markerEnd,
  style,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const handleMouseEnter = useCallback(() => { setHovered(true); }, []);
  const handleMouseLeave = useCallback(() => { setHovered(false); }, []);

  const edgeStyle = {
    ...style,
    stroke: hovered ? '#00ff00' : '#00aa00',
    strokeWidth: hovered ? 2.5 : 1.5,
    opacity: hovered ? 1 : 0.6,
    filter: hovered ? 'drop-shadow(0 0 4px #00ff0088)' : 'none',
    transition: 'stroke 0.15s ease, stroke-width 0.15s ease, opacity 0.15s ease, filter 0.15s ease',
  };

  return (
    <>
      {/* Invisible wider path for easier hover interaction */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: 'pointer' }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd != null ? { markerEnd } : {})}
        style={edgeStyle}
      />
      {hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
              pointerEvents: 'none',
              backgroundColor: '#0a0a0a',
              border: '1px solid #00aa0088',
              borderRadius: '2px',
              padding: '3px 8px',
              fontSize: '0.6rem',
              fontFamily: '"Share Tech Mono", monospace',
              color: '#00ff00',
              letterSpacing: '0.05em',
              whiteSpace: 'nowrap',
              boxShadow: '0 0 8px rgba(0, 170, 0, 0.2)',
              zIndex: 1000,
            }}
          >
            {target} DEPENDS ON {source}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Memoized BeadGraphEdge for React Flow performance. */
export const BeadGraphEdge = React.memo(BeadGraphEdgeInner);
