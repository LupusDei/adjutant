/**
 * Dependency graph visualization for beads.
 * Uses React Flow with dagre layout to render bead dependency relationships.
 */
import { useMemo, type CSSProperties } from 'react';

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { BeadGraphNode } from './BeadGraphNode';
import { useBeadsGraph } from '../../hooks/useBeadsGraph';

/** Register custom node types for React Flow. */
const nodeTypes = { beadNode: BeadGraphNode };

/** Props for DependencyGraphView. */
export interface DependencyGraphViewProps {
  /** Whether this view is currently active (controls polling). */
  isActive?: boolean;
}

/**
 * DependencyGraphView renders the bead dependency graph using React Flow.
 * Supports pan/zoom, minimap, and automatic dagre layout.
 */
export function DependencyGraphView({ isActive = true }: DependencyGraphViewProps) {
  const { nodes, edges, loading, error } = useBeadsGraph({
    pollInterval: 30000,
    enabled: isActive,
  });

  /** Default edge style for Pip-Boy theme. */
  const defaultEdgeOptions = useMemo(
    () => ({
      style: {
        stroke: '#00aa00',
        strokeWidth: 1.5,
      },
      animated: false,
    }),
    []
  );

  if (loading && nodes.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingState}>
          <div style={styles.loadingPulse} />
          COMPUTING DEPENDENCY GRAPH...
        </div>
      </div>
    );
  }

  if (error && nodes.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.errorState}>
          GRAPH SCAN FAILED: {error.message}
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          NO DEPENDENCY DATA AVAILABLE
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#1a1a1a"
        />
        <Controls
          showInteractive={false}
          style={styles.controls}
        />
        <MiniMap
          style={styles.minimap}
          nodeColor={(node) => {
            const status = (node.data as Record<string, unknown>).status as string;
            switch (status) {
              case 'closed':
                return '#00ff00';
              case 'in_progress':
              case 'hooked':
                return '#ffaa00';
              case 'blocked':
                return '#ff4444';
              default:
                return '#666666';
            }
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0a0a0a',
    position: 'relative',
  } satisfies CSSProperties,
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    gap: '16px',
    fontFamily: '"Share Tech Mono", monospace',
  } satisfies CSSProperties,
  loadingPulse: {
    width: '40px',
    height: '40px',
    border: '2px solid var(--crt-phosphor-dim)',
    borderTopColor: 'var(--crt-phosphor)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  } satisfies CSSProperties,
  errorState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#FF4444',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  } satisfies CSSProperties,
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  } satisfies CSSProperties,
  controls: {
    backgroundColor: '#0a0a0a',
    border: '1px solid #00aa00',
    borderRadius: '2px',
  } satisfies CSSProperties,
  minimap: {
    backgroundColor: '#0a0a0a',
    border: '1px solid #00aa0066',
    borderRadius: '2px',
  } satisfies CSSProperties,
};
