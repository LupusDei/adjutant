/**
 * Dependency graph visualization for beads.
 * Uses React Flow with dagre layout to render bead dependency relationships.
 * Supports critical path highlighting with toggle control.
 */
import { useCallback, useMemo, type CSSProperties } from 'react';

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { BeadGraphNode } from './BeadGraphNode';
import { useBeadsGraph } from '../../hooks/useBeadsGraph';
import type { BeadNodeData } from '../../hooks/useBeadsGraph';
import type { CriticalPathResult } from '../../utils/critical-path';

/** Register custom node types for React Flow. */
const nodeTypes = { beadNode: BeadGraphNode };

/** Props for DependencyGraphView. */
export interface DependencyGraphViewProps {
  /** Whether this view is currently active (controls polling). */
  isActive?: boolean;
}

/**
 * Build an edge ID matching the critical path format from React Flow edge data.
 * The critical path uses "dependsOnId->issueId" format, which maps to "source->target".
 */
function edgeToCriticalPathId(edge: Edge): string {
  return `${edge.source}->${edge.target}`;
}

/**
 * Apply critical path classNames to edges for CSS-based highlighting.
 */
function applyEdgeHighlighting(
  edges: Edge[],
  criticalPath: CriticalPathResult,
  showCriticalPath: boolean
): Edge[] {
  if (!showCriticalPath) {
    return edges;
  }
  return edges.map((edge) => {
    const cpId = edgeToCriticalPathId(edge);
    const isCritical = criticalPath.edgeIds.has(cpId);
    return {
      ...edge,
      className: isCritical ? 'critical-path' : 'dimmed-path',
    };
  });
}

/**
 * Apply critical path classNames to nodes for CSS-based highlighting.
 */
function applyNodeHighlighting(
  nodes: Node<BeadNodeData>[],
  criticalPath: CriticalPathResult,
  showCriticalPath: boolean
): Node<BeadNodeData>[] {
  if (!showCriticalPath) {
    return nodes;
  }
  return nodes.map((node) => {
    const isCritical = criticalPath.nodeIds.has(node.id);
    return {
      ...node,
      className: isCritical ? 'critical-path-node' : 'dimmed-node',
    };
  });
}

/**
 * DependencyGraphView renders the bead dependency graph using React Flow.
 * Supports pan/zoom, minimap, automatic dagre layout, and critical path highlighting.
 */
export function DependencyGraphView({ isActive = true }: DependencyGraphViewProps) {
  const {
    nodes,
    edges,
    loading,
    error,
    showCriticalPath,
    toggleCriticalPath,
    criticalPath,
    criticalPathLength,
  } = useBeadsGraph({
    pollInterval: 30000,
    enabled: isActive,
  });

  /** Apply critical path highlighting to nodes and edges. */
  const highlightedNodes = useMemo(
    () => applyNodeHighlighting(nodes, criticalPath, showCriticalPath),
    [nodes, criticalPath, showCriticalPath]
  );

  const highlightedEdges = useMemo(
    () => applyEdgeHighlighting(edges, criticalPath, showCriticalPath),
    [edges, criticalPath, showCriticalPath]
  );

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

  /** MiniMap node color callback. */
  const minimapNodeColor = useCallback((node: Node) => {
    // Safe cast: node.data comes from our BeadNodeData type via useBeadsGraph
    const data = node.data as Record<string, unknown>;
    const status = data['status'] as string;
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
  }, []);

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
        nodes={highlightedNodes}
        edges={highlightedEdges}
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
          nodeColor={minimapNodeColor}
          maskColor="rgba(0, 0, 0, 0.7)"
        />
      </ReactFlow>

      {/* Critical Path Toggle */}
      <button
        type="button"
        onClick={toggleCriticalPath}
        style={{
          ...styles.criticalPathToggle,
          ...(showCriticalPath ? styles.criticalPathToggleActive : {}),
        }}
        title={showCriticalPath ? 'Hide critical path' : 'Show critical path'}
      >
        <span style={styles.criticalPathLabel}>
          CRITICAL PATH
        </span>
        {criticalPathLength > 0 && (
          <span style={styles.criticalPathCount}>
            ({criticalPathLength})
          </span>
        )}
      </button>
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
  criticalPathToggle: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: '#0a0a0a',
    border: '1px solid #00aa00',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.7rem',
    color: '#00aa00',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    transition: 'all 0.2s ease',
    boxShadow: '0 0 4px rgba(0, 170, 0, 0.15)',
  } satisfies CSSProperties,
  criticalPathToggleActive: {
    background: '#001a00',
    borderColor: '#00ff00',
    color: '#00ff00',
    boxShadow: '0 0 10px rgba(0, 255, 0, 0.3)',
  } satisfies CSSProperties,
  criticalPathLabel: {
    fontWeight: 'bold',
  } satisfies CSSProperties,
  criticalPathCount: {
    fontSize: '0.65rem',
    opacity: 0.8,
  } satisfies CSSProperties,
};
