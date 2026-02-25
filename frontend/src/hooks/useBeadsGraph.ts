/**
 * Hook for fetching and layouting bead dependency graph data.
 * Uses dagre for automatic graph layout and transforms API data
 * into React Flow nodes and edges.
 * Supports collapse/expand of sub-trees for epic nodes
 * and critical path computation and highlighting.
 */
import { useCallback, useMemo, useState } from 'react';

import Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

import { api } from '../services/api';
import { usePolling } from './usePolling';
import type { GraphNodeData, GraphDependency } from '../types/beads-graph';
import { computeCriticalPath } from '../utils/critical-path';
import type { CriticalPathResult } from '../utils/critical-path';
import { detectCycles } from '../utils/cycle-detection';
import type { CycleDetectionResult } from '../utils/cycle-detection';

/** Data carried by each React Flow node. */
export interface BeadNodeData extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
  beadType: string;
  priority: number;
  assignee: string | null;
  source?: string;
  /** Whether this node is collapsed (has hidden children). */
  collapsed?: boolean;
  /** Number of hidden descendant nodes when collapsed. */
  collapsedChildCount?: number;
}

/** Options for the useBeadsGraph hook. */
export interface UseBeadsGraphOptions {
  /** Polling interval in milliseconds. Default: 30000. */
  pollInterval?: number;
  /** Whether polling is enabled. Default: true. */
  enabled?: boolean;
}

/** Return type for the useBeadsGraph hook. */
export interface UseBeadsGraphResult {
  /** React Flow nodes with dagre-computed positions. */
  nodes: Node<BeadNodeData>[];
  /** React Flow edges. */
  edges: Edge[];
  /** Whether data is currently loading. */
  loading: boolean;
  /** Error from last fetch, or null. */
  error: Error | null;
  /** Manually trigger a refresh. */
  refresh: () => Promise<void>;
  /** Toggle collapse state for a node. */
  toggleCollapse: (nodeId: string) => void;
  /** Collapse all collapsible nodes. */
  collapseAll: () => void;
  /** Expand all collapsed nodes. */
  expandAll: () => void;
  /** Set of currently collapsed node IDs. */
  collapsedNodes: ReadonlySet<string>;
  /** All unique epic IDs for filtering. */
  epicIds: string[];
  /** Whether critical path highlighting is active. */
  showCriticalPath: boolean;
  /** Toggle critical path highlighting. */
  toggleCriticalPath: () => void;
  /** Critical path computation result (node/edge IDs). */
  criticalPath: CriticalPathResult;
  /** Number of nodes on the critical path. */
  criticalPathLength: number;
  /** Cycle detection result. */
  cycleDetection: CycleDetectionResult;
}

/** Default node dimensions for layout computation. */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;
const EPIC_NODE_WIDTH = 240;
const EPIC_NODE_HEIGHT = 72;

/**
 * Find all descendant node IDs of a given node in the dependency graph.
 * An edge goes from dependsOnId -> issueId, so descendants are nodes
 * that are targets (issueId) of edges from the given node, recursively.
 */
function getDescendantIds(
  nodeId: string,
  apiEdges: GraphDependency[],
  visited: Set<string> = new Set()
): Set<string> {
  if (visited.has(nodeId)) return visited;
  visited.add(nodeId);

  for (const edge of apiEdges) {
    if (edge.dependsOnId === nodeId && !visited.has(edge.issueId)) {
      getDescendantIds(edge.issueId, apiEdges, visited);
    }
  }

  // Remove the root node itself from descendants
  visited.delete(nodeId);
  return visited;
}

/**
 * Get the set of all node IDs that should be hidden due to collapsed ancestors.
 */
function getHiddenNodeIds(
  collapsedNodes: ReadonlySet<string>,
  apiEdges: GraphDependency[]
): Set<string> {
  const hidden = new Set<string>();
  for (const collapsedId of collapsedNodes) {
    const descendants = getDescendantIds(collapsedId, apiEdges);
    for (const id of descendants) {
      hidden.add(id);
    }
  }
  return hidden;
}

/**
 * Transform API nodes into React Flow nodes with dagre-computed positions.
 * Filters out hidden nodes (collapsed sub-trees) and re-layouts.
 */
function getLayoutedElements(
  apiNodes: GraphNodeData[],
  apiEdges: GraphDependency[],
  collapsedNodes: ReadonlySet<string>
): { nodes: Node<BeadNodeData>[]; edges: Edge[] } {
  if (apiNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Compute hidden nodes from collapsed sub-trees
  const hiddenIds = getHiddenNodeIds(collapsedNodes, apiEdges);

  // Filter visible nodes
  const visibleApiNodes = apiNodes.filter((n) => !hiddenIds.has(n.id));

  if (visibleApiNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 });

  // Add visible nodes to dagre
  for (const node of visibleApiNodes) {
    const isEpic = node.type === 'epic';
    g.setNode(node.id, {
      width: isEpic ? EPIC_NODE_WIDTH : NODE_WIDTH,
      height: isEpic ? EPIC_NODE_HEIGHT : NODE_HEIGHT,
    });
  }

  // Add edges only between visible nodes
  const visibleIds = new Set(visibleApiNodes.map((n) => n.id));
  for (const edge of apiEdges) {
    if (visibleIds.has(edge.dependsOnId) && visibleIds.has(edge.issueId)) {
      g.setEdge(edge.dependsOnId, edge.issueId);
    }
  }

  Dagre.layout(g);

  // Transform to React Flow nodes
  const rfNodes: Node<BeadNodeData>[] = visibleApiNodes.map((node) => {
    const pos = g.node(node.id);
    const isEpic = node.type === 'epic';
    const w = isEpic ? EPIC_NODE_WIDTH : NODE_WIDTH;
    const h = isEpic ? EPIC_NODE_HEIGHT : NODE_HEIGHT;
    const isCollapsed = collapsedNodes.has(node.id);

    // Count hidden descendants for this collapsed node
    let collapsedChildCount = 0;
    if (isCollapsed) {
      const descendants = getDescendantIds(node.id, apiEdges);
      collapsedChildCount = descendants.size;
    }

    const nodeData: BeadNodeData = {
      id: node.id,
      title: node.title,
      status: node.status,
      beadType: node.type,
      priority: node.priority,
      assignee: node.assignee,
      collapsed: isCollapsed,
      collapsedChildCount,
    };

    // Only include source if defined (exactOptionalPropertyTypes compliance)
    if (node.source != null) {
      nodeData.source = node.source;
    }

    return {
      id: node.id,
      type: 'beadNode' as const,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
      data: nodeData,
    };
  });

  // Transform to React Flow edges (only between visible nodes)
  const rfEdges: Edge[] = apiEdges
    .filter(
      (edge) =>
        visibleIds.has(edge.dependsOnId) &&
        visibleIds.has(edge.issueId)
    )
    .map((edge, index) => ({
      id: `edge-${index}-${edge.dependsOnId}-${edge.issueId}`,
      source: edge.dependsOnId,
      target: edge.issueId,
      type: 'beadEdge',
    }));

  return { nodes: rfNodes, edges: rfEdges };
}

/** Empty critical path result for initialization. */
const EMPTY_CRITICAL_PATH: CriticalPathResult = {
  nodeIds: new Set<string>(),
  edgeIds: new Set<string>(),
};

/** Empty cycle detection result for initialization. */
const EMPTY_CYCLE_DETECTION: CycleDetectionResult = {
  hasCycles: false,
  cycles: [],
  nodesInCycles: new Set<string>(),
  edgesInCycles: new Set<string>(),
};

/**
 * React hook for fetching bead dependency graph data with dagre layout.
 * Supports collapse/expand of sub-trees and critical path computation.
 *
 * @param options - Configuration options for polling behavior
 * @returns Graph nodes, edges, loading/error state, collapse controls, critical path data, and refresh function
 */
export function useBeadsGraph(
  options: UseBeadsGraphOptions = {}
): UseBeadsGraphResult {
  const { pollInterval = 30000, enabled = true } = options;

  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [showCriticalPath, setShowCriticalPath] = useState(false);

  const { data, loading, error, refresh } = usePolling(
    () => api.beads.graph(),
    { interval: pollInterval, enabled }
  );

  /** Toggle collapse state for a node. */
  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  /** Collapse all epic nodes that have children. */
  const collapseAll = useCallback(() => {
    if (!data) return;
    const epicsWithChildren = new Set<string>();
    for (const node of data.nodes) {
      if (node.type === 'epic') {
        // Check if this epic has any children
        const hasChildren = data.edges.some((e) => e.dependsOnId === node.id);
        if (hasChildren) {
          epicsWithChildren.add(node.id);
        }
      }
    }
    setCollapsedNodes(epicsWithChildren);
  }, [data]);

  /** Expand all collapsed nodes. */
  const expandAll = useCallback(() => {
    setCollapsedNodes(new Set());
  }, []);

  /** Extract all epic IDs for filtering. */
  const epicIds = useMemo(() => {
    if (!data) return [];
    return data.nodes
      .filter((n) => n.type === 'epic')
      .map((n) => n.id)
      .sort();
  }, [data]);

  const { nodes, edges } = useMemo(() => {
    if (!data) {
      return { nodes: [] as Node<BeadNodeData>[], edges: [] as Edge[] };
    }
    return getLayoutedElements(data.nodes, data.edges, collapsedNodes);
  }, [data, collapsedNodes]);

  // Compute critical path when data changes
  const criticalPath = useMemo(() => {
    if (!data || data.nodes.length === 0) {
      return EMPTY_CRITICAL_PATH;
    }
    return computeCriticalPath(data.nodes, data.edges);
  }, [data]);

  // Detect circular dependencies when data changes
  const cycleDetection = useMemo(() => {
    if (!data || data.edges.length === 0) {
      return EMPTY_CYCLE_DETECTION;
    }
    return detectCycles(data.edges);
  }, [data]);

  const toggleCriticalPath = useCallback(() => {
    setShowCriticalPath((prev) => !prev);
  }, []);

  return {
    nodes,
    edges,
    loading,
    error,
    refresh,
    toggleCollapse,
    collapseAll,
    expandAll,
    collapsedNodes,
    epicIds,
    showCriticalPath,
    toggleCriticalPath,
    criticalPath,
    criticalPathLength: criticalPath.nodeIds.size,
    cycleDetection,
  };
}
