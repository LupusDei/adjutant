/**
 * EpicGraphView - Full-screen overlay rendering a scoped bead dependency graph
 * for a single epic. Uses React Flow with dagre layout, CRT/Pip-Boy aesthetic,
 * and supports critical path highlighting.
 *
 * Appears as a full-screen modal on top of all other content with a CRT boot-up
 * transition. Escape key or close button dismisses the overlay.
 */
import React, { useCallback, useEffect, useMemo, type CSSProperties } from 'react';

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
} from '@xyflow/react';
import type { Node, Edge, NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { BeadGraphNode } from '../beads/BeadGraphNode';
import { BeadGraphEdge } from '../beads/BeadGraphEdge';
import { useEpicGraph } from '../../hooks/useEpicGraph';
import type { BeadNodeData } from '../../hooks/useBeadsGraph';
import type { CriticalPathResult } from '../../utils/critical-path';

/** Register custom node types for React Flow. */
const nodeTypes = { beadNode: BeadGraphNode };

/** Register custom edge types for React Flow. */
const edgeTypes = { beadEdge: BeadGraphEdge };

/** Props for EpicGraphView. */
export interface EpicGraphViewProps {
  /** The epic ID to scope the graph to. */
  epicId: string;
  /** The epic title for display in the header. */
  epicTitle: string;
  /** Callback to close the overlay. */
  onClose: () => void;
}

/**
 * Build an edge ID matching the critical path format from React Flow edge data.
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
  if (!showCriticalPath) return edges;
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
  if (!showCriticalPath) return nodes;
  return nodes.map((node) => {
    const isCritical = criticalPath.nodeIds.has(node.id);
    return {
      ...node,
      className: isCritical ? 'critical-path-node' : 'dimmed-node',
    };
  });
}

/**
 * Inner component that uses useReactFlow (must be inside ReactFlowProvider).
 */
function EpicGraphInner({ epicId, epicTitle, onClose }: EpicGraphViewProps) {
  const {
    nodes,
    edges,
    loading,
    error,
    showCriticalPath,
    toggleCriticalPath,
    criticalPath,
    criticalPathLength,
    refresh,
  } = useEpicGraph(epicId);

  const { fitView } = useReactFlow();

  /** Close on Escape key. */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  /** Auto-fit the graph to viewport after data loads. */
  useEffect(() => {
    if (nodes.length > 0 && !loading) {
      // Delay fit slightly to allow React Flow to render nodes
      const timer = setTimeout(() => {
        void fitView({ padding: 0.2, duration: 400 });
      }, 100);
      return () => { clearTimeout(timer); };
    }
    return undefined;
  }, [nodes.length, loading, fitView]);

  /** Handle fit view button. */
  const handleFitView = useCallback(() => {
    void fitView({ padding: 0.2, duration: 300 });
  }, [fitView]);

  /** Handle refresh button. */
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  /** Handle node click -- currently no-op in scoped view. */
  const onNodeClick: NodeMouseHandler = useCallback(() => {
    // Could open a detail panel in the future
  }, []);

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
    // Safe cast: node.data comes from our BeadNodeData type
    const data = node.data;
    const status = data['status'] as string;
    switch (status) {
      case 'closed':
        return '#00ff00';
      case 'in_progress':
      case 'hooked':
        return '#ffaa00';
      default:
        return '#666666';
    }
  }, []);

  return (
    <div style={styles.overlay}>
      {/* Scanline overlay */}
      <div style={styles.scanlines} />

      {/* Header bar */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerPrompt}>&gt;</span>
          <span style={styles.headerEpicId}>{epicId.toUpperCase()}</span>
          <span style={styles.headerSeparator}>//</span>
          <span style={styles.headerTitle}>{epicTitle}</span>
        </div>
        <div style={styles.headerControls}>
          <button
            style={styles.headerButton}
            onClick={handleRefresh}
            title="Refresh graph"
            aria-label="Refresh graph"
          >
            {'\u21BB'}
          </button>
          <button
            style={styles.headerButton}
            onClick={handleFitView}
            title="Fit to viewport"
            aria-label="Fit to viewport"
          >
            FIT
          </button>
          <button
            style={styles.closeButton}
            onClick={onClose}
            title="Close graph"
            aria-label="Close graph"
          >
            X
          </button>
        </div>
      </div>

      {/* Graph area */}
      <div style={styles.graphContainer}>
        {loading && nodes.length === 0 && (
          <div style={styles.loadingState}>
            <div style={styles.loadingPulse} />
            COMPUTING EPIC GRAPH...
          </div>
        )}

        {error && nodes.length === 0 && (
          <div style={styles.errorState}>
            GRAPH SCAN FAILED: {error.message}
          </div>
        )}

        {nodes.length > 0 && (
          <ReactFlow
            nodes={highlightedNodes}
            edges={highlightedEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodeClick={onNodeClick}
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
        )}

        {/* No data after loading */}
        {!loading && !error && nodes.length === 0 && (
          <div style={styles.emptyState}>
            NO DEPENDENCY DATA FOR THIS EPIC
          </div>
        )}
      </div>

      {/* Critical Path Toggle */}
      {nodes.length > 0 && (
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
      )}

      {/* Node count indicator */}
      {nodes.length > 0 && (
        <div style={styles.nodeCount}>
          {nodes.length} NODES / {edges.length} EDGES
        </div>
      )}
    </div>
  );
}

/**
 * EpicGraphView renders a scoped epic dependency graph as a full-screen overlay.
 * Wraps the inner component with ReactFlowProvider for useReactFlow access.
 */
function EpicGraphViewInner(props: EpicGraphViewProps) {
  return (
    <ReactFlowProvider>
      <EpicGraphInner {...props} />
    </ReactFlowProvider>
  );
}

/** Memoized EpicGraphView for performance. */
export const EpicGraphView = React.memo(EpicGraphViewInner);

// =============================================================================
// Styles
// =============================================================================

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'var(--theme-bg-screen, #0a0a0a)',
    zIndex: 2000,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'var(--theme-font, "Share Tech Mono", "Courier New", monospace)',
    animation: 'epicGraphFadeIn 0.2s ease-out',
  } satisfies CSSProperties,

  scanlines: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background:
      'repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 3px)',
    pointerEvents: 'none',
    zIndex: 2001,
  } satisfies CSSProperties,

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    borderBottom: '2px solid var(--crt-phosphor-dim, #00aa00)',
    backgroundColor: 'rgba(0, 255, 0, 0.03)',
    flexShrink: 0,
    zIndex: 2002,
    position: 'relative',
  } satisfies CSSProperties,

  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    overflow: 'hidden',
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  headerPrompt: {
    color: 'var(--crt-phosphor, #00ff00)',
    fontSize: '1rem',
    fontWeight: 'bold',
    flexShrink: 0,
    textShadow: '0 0 6px rgba(0, 255, 0, 0.5)',
  } satisfies CSSProperties,

  headerEpicId: {
    color: 'var(--crt-phosphor, #00ff00)',
    fontSize: '0.85rem',
    letterSpacing: '0.1em',
    fontWeight: 'bold',
    flexShrink: 0,
    textShadow: '0 0 8px rgba(0, 255, 0, 0.4)',
  } satisfies CSSProperties,

  headerSeparator: {
    color: 'var(--crt-phosphor-dim, #00aa00)',
    fontSize: '0.75rem',
    opacity: 0.5,
    flexShrink: 0,
  } satisfies CSSProperties,

  headerTitle: {
    color: 'var(--crt-phosphor-dim, #00aa00)',
    fontSize: '0.8rem',
    letterSpacing: '0.05em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  } satisfies CSSProperties,

  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  } satisfies CSSProperties,

  headerButton: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    color: 'var(--crt-phosphor, #00ff00)',
    fontSize: '0.75rem',
    padding: '4px 10px',
    cursor: 'pointer',
    letterSpacing: '0.08em',
    transition: 'all 0.15s ease',
    fontFamily: '"Share Tech Mono", monospace',
  } satisfies CSSProperties,

  closeButton: {
    background: 'none',
    border: '1px solid #ff4444',
    color: '#ff4444',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    width: '32px',
    height: '32px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
    fontFamily: '"Share Tech Mono", monospace',
  } satisfies CSSProperties,

  graphContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  } satisfies CSSProperties,

  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    letterSpacing: '0.1em',
    gap: '16px',
    fontSize: '0.9rem',
  } satisfies CSSProperties,

  loadingPulse: {
    width: '40px',
    height: '40px',
    border: '2px solid var(--crt-phosphor-dim, #00aa00)',
    borderTopColor: 'var(--crt-phosphor, #00ff00)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  } satisfies CSSProperties,

  errorState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#FF4444',
    letterSpacing: '0.1em',
    fontSize: '0.9rem',
  } satisfies CSSProperties,

  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    letterSpacing: '0.1em',
    fontSize: '0.85rem',
    opacity: 0.7,
  } satisfies CSSProperties,

  controls: {
    backgroundColor: 'var(--theme-bg-screen, #0a0a0a)',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    borderRadius: '2px',
  } satisfies CSSProperties,

  minimap: {
    backgroundColor: 'var(--theme-bg-screen, #0a0a0a)',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    borderRadius: '2px',
  } satisfies CSSProperties,

  criticalPathToggle: {
    position: 'absolute',
    bottom: '10px',
    right: '10px',
    zIndex: 2003,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: 'var(--theme-bg-screen, #0a0a0a)',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    transition: 'all 0.2s ease',
    boxShadow: '0 0 4px rgba(0, 170, 0, 0.15)',
  } satisfies CSSProperties,

  criticalPathToggleActive: {
    background: 'var(--theme-bg-elevated, #1a1a1a)',
    borderColor: 'var(--crt-phosphor, #00ff00)',
    color: 'var(--crt-phosphor, #00ff00)',
    boxShadow: '0 0 10px rgba(0, 255, 0, 0.3)',
  } satisfies CSSProperties,

  criticalPathLabel: {
    fontWeight: 'bold',
  } satisfies CSSProperties,

  criticalPathCount: {
    fontSize: '0.65rem',
    opacity: 0.8,
  } satisfies CSSProperties,

  nodeCount: {
    position: 'absolute',
    bottom: '10px',
    left: '10px',
    zIndex: 2003,
    padding: '4px 10px',
    background: 'var(--theme-bg-screen, #0a0a0a)',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    borderRadius: '2px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    letterSpacing: '0.08em',
    opacity: 0.7,
  } satisfies CSSProperties,
} as const;
