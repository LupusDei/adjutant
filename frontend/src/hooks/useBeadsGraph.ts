/**
 * Hook for fetching and layouting bead dependency graph data.
 * Uses dagre for automatic graph layout and transforms API data
 * into React Flow nodes and edges.
 * Supports critical path computation and highlighting.
 */
import { useCallback, useMemo, useState } from 'react';

import Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

import { api } from '../services/api';
import { usePolling } from './usePolling';
import type { GraphNodeData, GraphDependency } from '../types/beads-graph';
import { computeCriticalPath } from '../utils/critical-path';
import type { CriticalPathResult } from '../utils/critical-path';

/** Data carried by each React Flow node. */
export interface BeadNodeData extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
  beadType: string;
  priority: number;
  assignee: string | null;
  source?: string;
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
  /** Whether critical path highlighting is active. */
  showCriticalPath: boolean;
  /** Toggle critical path highlighting. */
  toggleCriticalPath: () => void;
  /** Critical path computation result (node/edge IDs). */
  criticalPath: CriticalPathResult;
  /** Number of nodes on the critical path. */
  criticalPathLength: number;
}

/** Default node dimensions for layout computation. */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;
const EPIC_NODE_WIDTH = 240;
const EPIC_NODE_HEIGHT = 72;

/**
 * Transform API nodes into React Flow nodes with dagre-computed positions.
 */
function getLayoutedElements(
  apiNodes: GraphNodeData[],
  apiEdges: GraphDependency[]
): { nodes: Node<BeadNodeData>[]; edges: Edge[] } {
  if (apiNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 });

  // Add nodes to dagre
  for (const node of apiNodes) {
    const isEpic = node.type === 'epic';
    g.setNode(node.id, {
      width: isEpic ? EPIC_NODE_WIDTH : NODE_WIDTH,
      height: isEpic ? EPIC_NODE_HEIGHT : NODE_HEIGHT,
    });
  }

  // Add edges to dagre
  // API edge: issueId depends on dependsOnId
  // In the graph: dependsOnId -> issueId (dependency flows upward)
  for (const edge of apiEdges) {
    // Only add edge if both nodes exist in the graph
    if (g.hasNode(edge.dependsOnId) && g.hasNode(edge.issueId)) {
      g.setEdge(edge.dependsOnId, edge.issueId);
    }
  }

  Dagre.layout(g);

  // Transform to React Flow nodes
  const rfNodes: Node<BeadNodeData>[] = apiNodes.map((node) => {
    const pos = g.node(node.id);
    const isEpic = node.type === 'epic';
    const w = isEpic ? EPIC_NODE_WIDTH : NODE_WIDTH;
    const h = isEpic ? EPIC_NODE_HEIGHT : NODE_HEIGHT;

    return {
      id: node.id,
      type: 'beadNode',
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
      data: {
        id: node.id,
        title: node.title,
        status: node.status,
        beadType: node.type,
        priority: node.priority,
        assignee: node.assignee,
        source: node.source,
      },
    };
  });

  // Transform to React Flow edges
  const rfEdges: Edge[] = apiEdges
    .filter(
      (edge) =>
        apiNodes.some((n) => n.id === edge.dependsOnId) &&
        apiNodes.some((n) => n.id === edge.issueId)
    )
    .map((edge, index) => ({
      id: `edge-${index}-${edge.dependsOnId}-${edge.issueId}`,
      source: edge.dependsOnId,
      target: edge.issueId,
      type: 'default',
    }));

  return { nodes: rfNodes, edges: rfEdges };
}

/** Empty critical path result for initialization. */
const EMPTY_CRITICAL_PATH: CriticalPathResult = {
  nodeIds: new Set<string>(),
  edgeIds: new Set<string>(),
};

/**
 * React hook for fetching bead dependency graph data with dagre layout.
 * Includes critical path computation and toggle state.
 *
 * @param options - Configuration options for polling behavior
 * @returns Graph nodes, edges, loading/error state, critical path data, and controls
 */
export function useBeadsGraph(
  options: UseBeadsGraphOptions = {}
): UseBeadsGraphResult {
  const { pollInterval = 30000, enabled = true } = options;

  const [showCriticalPath, setShowCriticalPath] = useState(false);

  const { data, loading, error, refresh } = usePolling(
    () => api.beads.graph(),
    { interval: pollInterval, enabled }
  );

  const { nodes, edges } = useMemo(() => {
    if (!data) {
      return { nodes: [] as Node<BeadNodeData>[], edges: [] as Edge[] };
    }
    return getLayoutedElements(data.nodes, data.edges);
  }, [data]);

  // Compute critical path when data changes
  const criticalPath = useMemo(() => {
    if (!data || data.nodes.length === 0) {
      return EMPTY_CRITICAL_PATH;
    }
    return computeCriticalPath(data.nodes, data.edges);
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
    showCriticalPath,
    toggleCriticalPath,
    criticalPath,
    criticalPathLength: criticalPath.nodeIds.size,
  };
}
