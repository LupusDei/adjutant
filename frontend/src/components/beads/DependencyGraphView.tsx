/**
 * Dependency graph visualization for beads.
 * Uses React Flow with dagre layout to render bead dependency relationships.
 * Supports node selection with detail panel slide-out.
 */
import { useState, useCallback, useMemo, type CSSProperties } from 'react';

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import type { NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { BeadGraphNode } from './BeadGraphNode';
import { BeadGraphEdge } from './BeadGraphEdge';
import { GraphDetailPanel } from './GraphDetailPanel';
import { useBeadsGraph, type BeadNodeData } from '../../hooks/useBeadsGraph';
import type { Node } from '@xyflow/react';

/** Register custom node types for React Flow. */
const nodeTypes = { beadNode: BeadGraphNode };

/** Register custom edge types for React Flow. */
const edgeTypes = { beadEdge: BeadGraphEdge };

/** Props for DependencyGraphView. */
export interface DependencyGraphViewProps {
  /** Whether this view is currently active (controls polling). */
  isActive?: boolean;
}

/**
 * DependencyGraphView renders the bead dependency graph using React Flow.
 * Supports pan/zoom, minimap, automatic dagre layout, and node selection.
 */
export function DependencyGraphView({ isActive = true }: DependencyGraphViewProps) {
  const { nodes, edges, loading, error } = useBeadsGraph({
    pollInterval: 30000,
    enabled: isActive,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  /** Handle node click - select the node and show detail panel. */
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  /** Handle pane click - deselect any selected node. */
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  /** Close the detail panel. */
  const handleDetailClose = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  /** Handle assign action from the detail panel. */
  const handleAssign = useCallback((_beadId: string) => {
    // Assignment would be handled by parent or API call
    // For now, just close the panel
    setSelectedNodeId(null);
  }, []);

  /** Inject selected state into node data so BeadGraphNode can render a highlight. */
  const nodesWithSelection = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.id === selectedNodeId,
        },
      })),
    [nodes, selectedNodeId]
  );

  /** Get the selected bead data for the detail panel. */
  const selectedBead = useMemo((): BeadNodeData | null => {
    if (!selectedNodeId) return null;
    const node = nodes.find((n: Node<BeadNodeData>) => n.id === selectedNodeId);
    return node ? node.data : null;
  }, [nodes, selectedNodeId]);

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
        nodes={nodesWithSelection}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
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

      <GraphDetailPanel
        bead={selectedBead}
        onClose={handleDetailClose}
        onAssign={handleAssign}
      />
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
