/**
 * Hook for fetching and layouting a scoped epic dependency graph.
 * Uses dagre for automatic graph layout and transforms API data
 * into React Flow nodes and edges for a single epic's subtree.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

import { api } from '../services/api';
import type { BeadNodeData } from './useBeadsGraph';
import type { GraphNodeData, GraphDependency, BeadsGraphResponse } from '../types/beads-graph';
import { computeCriticalPath } from '../utils/critical-path';
import type { CriticalPathResult } from '../utils/critical-path';

/** Return type for the useEpicGraph hook. */
export interface UseEpicGraphResult {
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

/** Empty critical path result for initialization. */
const EMPTY_CRITICAL_PATH: CriticalPathResult = {
  nodeIds: new Set<string>(),
  edgeIds: new Set<string>(),
};

/**
 * Build a BeadNodeData object from an API node.
 */
function buildNodeData(node: GraphNodeData): BeadNodeData {
  const nodeData: BeadNodeData = {
    id: node.id,
    title: node.title,
    status: node.status,
    beadType: node.type,
    priority: node.priority,
    assignee: node.assignee,
  };

  if (node.source != null) {
    nodeData.source = node.source;
  }

  return nodeData;
}

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

  const nodeIds = new Set(apiNodes.map((n) => n.id));
  const visibleEdges = apiEdges.filter(
    (edge) => nodeIds.has(edge.dependsOnId) && nodeIds.has(edge.issueId)
  );

  // Identify connected vs orphan nodes
  const connectedIds = new Set<string>();
  for (const edge of visibleEdges) {
    connectedIds.add(edge.dependsOnId);
    connectedIds.add(edge.issueId);
  }
  const connectedNodes = apiNodes.filter((n) => connectedIds.has(n.id));
  const orphanNodes = apiNodes.filter((n) => !connectedIds.has(n.id));

  const rfNodes: Node<BeadNodeData>[] = [];
  let maxDagreY = 0;

  if (connectedNodes.length > 0) {
    const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 });

    for (const node of connectedNodes) {
      const isEpic = node.type === 'epic';
      g.setNode(node.id, {
        width: isEpic ? EPIC_NODE_WIDTH : NODE_WIDTH,
        height: isEpic ? EPIC_NODE_HEIGHT : NODE_HEIGHT,
      });
    }

    for (const edge of visibleEdges) {
      g.setEdge(edge.dependsOnId, edge.issueId);
    }

    Dagre.layout(g);

    for (const node of connectedNodes) {
      const pos = g.node(node.id);
      const isEpic = node.type === 'epic';
      const w = isEpic ? EPIC_NODE_WIDTH : NODE_WIDTH;
      const h = isEpic ? EPIC_NODE_HEIGHT : NODE_HEIGHT;
      const nodeData = buildNodeData(node);

      const nodeY = pos.y + h / 2;
      if (nodeY > maxDagreY) {
        maxDagreY = nodeY;
      }

      rfNodes.push({
        id: node.id,
        type: 'beadNode' as const,
        position: {
          x: pos.x - w / 2,
          y: pos.y - h / 2,
        },
        data: nodeData,
      });
    }
  }

  // Position orphan nodes below the main graph
  if (orphanNodes.length > 0) {
    const orphanStartY = maxDagreY + 80;
    for (let i = 0; i < orphanNodes.length; i++) {
      const node = orphanNodes[i];
      if (!node) continue;
      const isEpic = node.type === 'epic';
      const w = isEpic ? EPIC_NODE_WIDTH : NODE_WIDTH;
      const h = isEpic ? EPIC_NODE_HEIGHT : NODE_HEIGHT;
      const col = i % 4;
      const row = Math.floor(i / 4);

      rfNodes.push({
        id: node.id,
        type: 'beadNode' as const,
        position: {
          x: col * (w + 40),
          y: orphanStartY + row * (h + 30),
        },
        data: buildNodeData(node),
      });
    }
  }

  const rfEdges: Edge[] = visibleEdges.map((edge, index) => ({
    id: `edge-${index}-${edge.dependsOnId}-${edge.issueId}`,
    source: edge.dependsOnId,
    target: edge.issueId,
    type: 'beadEdge',
  }));

  return { nodes: rfNodes, edges: rfEdges };
}

/**
 * React hook for fetching a scoped epic dependency graph with dagre layout.
 * Fetches from GET /api/beads/graph?epicId=X and provides React Flow nodes/edges.
 *
 * @param epicId - The epic ID to scope the graph to, or null to skip fetching
 * @returns Graph nodes, edges, loading/error state, critical path data, and refresh function
 */
export function useEpicGraph(epicId: string | null): UseEpicGraphResult {
  const [data, setData] = useState<BeadsGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [showCriticalPath, setShowCriticalPath] = useState(false);

  const fetchGraph = useCallback(async () => {
    if (!epicId) return;
    setLoading(true);
    try {
      const result = await api.beads.graphForEpic(epicId);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [epicId]);

  useEffect(() => {
    if (!epicId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    void fetchGraph();
  }, [epicId, fetchGraph]);

  const { nodes, edges } = useMemo(() => {
    if (!data) {
      return { nodes: [] as Node<BeadNodeData>[], edges: [] as Edge[] };
    }
    return getLayoutedElements(data.nodes, data.edges);
  }, [data]);

  const criticalPath = useMemo(() => {
    if (!data || data.nodes.length === 0) {
      return EMPTY_CRITICAL_PATH;
    }
    return computeCriticalPath(data.nodes, data.edges);
  }, [data]);

  const toggleCriticalPath = useCallback(() => {
    setShowCriticalPath((prev) => !prev);
  }, []);

  const refresh = useCallback(async () => {
    await fetchGraph();
  }, [fetchGraph]);

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
