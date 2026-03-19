/**
 * EpicSubtreeGraph - Compact dependency graph for an epic's subtree.
 * Embedded in BeadDetailView when viewing an epic.
 * Uses the same React Flow + dagre infrastructure as DependencyGraphView
 * but in a minimal form (no minimap, no critical path, no epic filter).
 */
import { useState, useCallback, useMemo, type CSSProperties } from 'react';

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BackgroundVariant,
} from '@xyflow/react';
import type { Node, NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { BeadGraphNode } from './BeadGraphNode';
import { BeadGraphEdge } from './BeadGraphEdge';
import { useBeadsGraph, type BeadNodeData } from '../../hooks/useBeadsGraph';

/** Register custom node/edge types. */
const nodeTypes = { beadNode: BeadGraphNode };
const edgeTypes = { beadEdge: BeadGraphEdge };

interface EpicSubtreeGraphProps {
  epicId: string;
  onBeadNavigate?: (beadId: string) => void;
}

function EpicSubtreeGraphInner({ epicId, onBeadNavigate }: EpicSubtreeGraphProps) {
  const {
    nodes,
    edges,
    loading,
    error,
    toggleCollapse,
  } = useBeadsGraph({
    epicId,
    pollInterval: 60000,
    enabled: true,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    if (onBeadNavigate) {
      onBeadNavigate(node.id);
    }
  }, [onBeadNavigate]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const nodesWithUIState = useMemo(
    () =>
      nodes.map((node: Node<BeadNodeData>) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.id === selectedNodeId,
          onToggleCollapse: toggleCollapse,
        },
      })),
    [nodes, selectedNodeId, toggleCollapse]
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      style: { stroke: '#00aa00', strokeWidth: 1.5 },
      animated: false,
    }),
    []
  );

  if (loading && nodes.length === 0) {
    return (
      <div style={styles.loadingState}>
        LOADING GRAPH...
      </div>
    );
  }

  if (error && nodes.length === 0) {
    return (
      <div style={styles.errorState}>
        GRAPH ERROR: {error.message}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div style={styles.emptyState}>
        NO DEPENDENCIES
      </div>
    );
  }

  return (
    <div style={styles.graphContainer}>
      <ReactFlow
        nodes={nodesWithUIState}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.1}
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
      </ReactFlow>
      <div style={styles.hint}>
        DOUBLE-CLICK NODE TO NAVIGATE
      </div>
    </div>
  );
}

export function EpicSubtreeGraph(props: EpicSubtreeGraphProps) {
  return (
    <ReactFlowProvider>
      <EpicSubtreeGraphInner {...props} />
    </ReactFlowProvider>
  );
}

const styles = {
  graphContainer: {
    width: '100%',
    height: '400px',
    position: 'relative',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'var(--theme-bg-screen)',
  } satisfies CSSProperties,
  loadingState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    fontSize: '0.8rem',
    fontFamily: '"Share Tech Mono", monospace',
  } satisfies CSSProperties,
  errorState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    color: '#FF4444',
    fontSize: '0.75rem',
    fontFamily: '"Share Tech Mono", monospace',
  } satisfies CSSProperties,
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '120px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    fontSize: '0.8rem',
    fontFamily: '"Share Tech Mono", monospace',
  } satisfies CSSProperties,
  controls: {
    backgroundColor: 'var(--theme-bg-screen)',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
  } satisfies CSSProperties,
  hint: {
    position: 'absolute',
    bottom: '6px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '0.6rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    fontFamily: '"Share Tech Mono", monospace',
    opacity: 0.6,
    pointerEvents: 'none',
  } satisfies CSSProperties,
};
