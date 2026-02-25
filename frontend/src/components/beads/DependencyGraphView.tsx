/**
 * Dependency graph visualization for beads.
 * Uses React Flow with dagre layout to render bead dependency relationships.
 * Supports node selection with detail panel, collapse/expand, and graph controls.
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
import type { NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { BeadGraphNode } from './BeadGraphNode';
import { BeadGraphEdge } from './BeadGraphEdge';
import { GraphDetailPanel } from './GraphDetailPanel';
import { GraphControls } from './GraphControls';
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
 * Inner component that uses useReactFlow (must be inside ReactFlowProvider).
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
    // Find all nodes that are descendants of the selected epic (or the epic itself)
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

  /** Inject UI state into node data for BeadGraphNode rendering. */
  const nodesWithUIState = useMemo(
    () =>
      filteredNodes.map((node: Node<BeadNodeData>) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.id === selectedNodeId,
          onToggleCollapse: toggleCollapse,
        },
      })),
    [filteredNodes, selectedNodeId, toggleCollapse]
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
        nodes={nodesWithUIState}
        edges={filteredEdges}
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
            // Safe access: node.data comes from Record<string, unknown> index signature
            const dataRecord = node.data as Record<string, unknown>;
            const status = String(dataRecord['status'] ?? '');
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
        <GraphControls
          epicIds={epicIds}
          epicFilter={epicFilter}
          onEpicFilterChange={handleEpicFilterChange}
          onCollapseAll={collapseAll}
          onExpandAll={expandAll}
          hasCollapsedNodes={collapsedNodes.size > 0}
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
