/**
 * Dependency graph visualization for beads.
 * Uses React Flow with dagre layout to render bead dependency relationships.
 * Supports node selection, collapse/expand, critical path highlighting,
 * and graph controls.
 */
import { useState, useCallback, useMemo, type CSSProperties } from 'react';

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import type { Node, Edge, NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { BeadGraphNode } from './BeadGraphNode';
import { BeadGraphEdge } from './BeadGraphEdge';
import { GraphEmptyState } from './GraphEmptyState';
import { GraphDetailPanel } from './GraphDetailPanel';
import { GraphControls } from './GraphControls';
import { useBeadsGraph, type BeadNodeData } from '../../hooks/useBeadsGraph';
import type { CriticalPathResult } from '../../utils/critical-path';

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
 * Inner component that uses useReactFlow (must be inside ReactFlowProvider).
 * Combines node selection, collapse/expand, critical path, and graph controls.
 */
function DependencyGraphInner({ isActive = true }: DependencyGraphViewProps) {
  const {
    nodes,
    edges,
    loading,
    error,
    toggleCollapse,
    collapseAll,
    expandAll,
    collapsedNodes,
    epicIds,
    showCriticalPath,
    toggleCriticalPath,
    criticalPath,
    criticalPathLength,
    cycleDetection,
  } = useBeadsGraph({
    pollInterval: 30000,
    enabled: isActive,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [epicFilter, setEpicFilter] = useState<string | null>(null);

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

  /** Handle epic filter change from GraphControls. */
  const handleEpicFilterChange = useCallback((id: string | null) => {
    setEpicFilter(id);
  }, []);

  /** Filter nodes by epic sub-tree if epic filter is active. */
  const filteredNodes = useMemo(() => {
    if (!epicFilter) return nodes;
    const epicNode = nodes.find((n: Node<BeadNodeData>) => n.id === epicFilter);
    if (!epicNode) return nodes;

    // Collect all edges' source->target relationships
    const childMap = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!childMap.has(edge.source)) {
        childMap.set(edge.source, new Set());
      }
      childMap.get(edge.source)?.add(edge.target);
    }

    // BFS to find all descendants
    const visible = new Set<string>([epicFilter]);
    const queue = [epicFilter];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childMap.get(current);
      if (children) {
        for (const child of children) {
          if (!visible.has(child)) {
            visible.add(child);
            queue.push(child);
          }
        }
      }
    }

    return nodes.filter((n: Node<BeadNodeData>) => visible.has(n.id));
  }, [nodes, edges, epicFilter]);

  /** Filter edges to only show those between visible nodes. */
  const filteredEdges = useMemo(() => {
    if (!epicFilter) return edges;
    const visibleIds = new Set(filteredNodes.map((n: Node<BeadNodeData>) => n.id));
    return edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  }, [edges, epicFilter, filteredNodes]);

  /** Apply critical path highlighting to filtered nodes and edges. */
  const highlightedNodes = useMemo(
    () => applyNodeHighlighting(filteredNodes, criticalPath, showCriticalPath),
    [filteredNodes, criticalPath, showCriticalPath]
  );

  const highlightedEdges = useMemo(
    () => applyEdgeHighlighting(filteredEdges, criticalPath, showCriticalPath),
    [filteredEdges, criticalPath, showCriticalPath]
  );

  /** Inject UI state into node data for BeadGraphNode rendering. */
  const nodesWithUIState = useMemo(
    () =>
      highlightedNodes.map((node: Node<BeadNodeData>) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.id === selectedNodeId,
          onToggleCollapse: toggleCollapse,
        },
      })),
    [highlightedNodes, selectedNodeId, toggleCollapse]
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
        <GraphEmptyState />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <ReactFlow
        nodes={nodesWithUIState}
        edges={highlightedEdges}
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
          nodeColor={minimapNodeColor}
          maskColor="rgba(0, 0, 0, 0.7)"
        />
        <GraphControls
          epicIds={epicIds}
          epicFilter={epicFilter}
          onEpicFilterChange={handleEpicFilterChange}
          onCollapseAll={collapseAll}
          onExpandAll={expandAll}
          hasCollapsedNodes={collapsedNodes.size > 0}
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

      {/* Circular Dependency Warning */}
      {cycleDetection.hasCycles && (
        <div
          style={styles.cycleWarning}
          title={`Circular dependencies detected involving: ${[...cycleDetection.nodesInCycles].join(', ')}`}
        >
          <span style={styles.cycleWarningIcon}>!</span>
          <span style={styles.cycleWarningText}>
            CIRCULAR DEPS ({cycleDetection.nodesInCycles.size})
          </span>
        </div>
      )}

      <GraphDetailPanel
        bead={selectedBead}
        onClose={handleDetailClose}
        onAssign={handleAssign}
      />
    </div>
  );
}

/**
 * DependencyGraphView renders the bead dependency graph using React Flow.
 * Wraps the inner component with ReactFlowProvider for useReactFlow access.
 */
export function DependencyGraphView(props: DependencyGraphViewProps) {
  return (
    <ReactFlowProvider>
      <DependencyGraphInner {...props} />
    </ReactFlowProvider>
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
    bottom: '10px',
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
  cycleWarning: {
    position: 'absolute',
    bottom: '10px',
    left: '10px',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: '#1a0a0a',
    border: '1px solid #ff4444',
    borderRadius: '2px',
    cursor: 'default',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.7rem',
    color: '#ff4444',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    boxShadow: '0 0 8px rgba(255, 68, 68, 0.2)',
    animation: 'pulse-error 2s ease-in-out infinite',
  } satisfies CSSProperties,
  cycleWarningIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    border: '1px solid #ff4444',
    borderRadius: '50%',
    fontSize: '0.6rem',
    fontWeight: 'bold',
    lineHeight: 1,
  } satisfies CSSProperties,
  cycleWarningText: {
    fontWeight: 'bold',
  } satisfies CSSProperties,
};
