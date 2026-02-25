/**
 * Critical path algorithm for bead dependency graphs.
 *
 * Computes the longest chain of non-closed nodes from roots to leaves.
 * The critical path represents the most constrained sequence of work items
 * that determines the minimum project duration.
 */
import type { GraphNodeData, GraphDependency } from '../types/beads-graph';

/** Result of the critical path computation. */
export interface CriticalPathResult {
  /** IDs of nodes on the critical path. */
  nodeIds: Set<string>;
  /** IDs of edges on the critical path (format: "{dependsOnId}->{issueId}"). */
  edgeIds: Set<string>;
}

/**
 * Compute the critical path: the longest chain of non-closed nodes
 * through the dependency graph.
 *
 * Algorithm:
 * 1. Filter to non-closed nodes only
 * 2. Build adjacency list from edges (dependsOnId -> issueId direction)
 * 3. Filter edges to only those connecting active (non-closed) nodes
 * 4. Find root nodes (no incoming edges among active nodes)
 * 5. DFS from each root, tracking the longest path
 * 6. Return Set of node IDs and edge IDs on the critical path
 *
 * @param nodes - All graph nodes (will be filtered to non-closed)
 * @param edges - All dependency edges
 * @returns Sets of node IDs and edge IDs on the critical path
 */
export function computeCriticalPath(
  nodes: GraphNodeData[],
  edges: GraphDependency[]
): CriticalPathResult {
  const emptyResult: CriticalPathResult = {
    nodeIds: new Set<string>(),
    edgeIds: new Set<string>(),
  };

  if (nodes.length === 0) {
    return emptyResult;
  }

  // Step 1: Filter to non-closed nodes
  const activeNodes = nodes.filter((n) => n.status !== 'closed');
  if (activeNodes.length === 0) {
    return emptyResult;
  }

  const activeNodeIds = new Set(activeNodes.map((n) => n.id));

  // Step 2: Build adjacency list
  // Edge semantics: issueId depends on dependsOnId
  // Graph direction for traversal: dependsOnId -> issueId
  // (from dependency to dependent)
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize all active nodes
  for (const nodeId of activeNodeIds) {
    adjacency.set(nodeId, []);
    inDegree.set(nodeId, 0);
  }

  // Step 3: Filter edges to only those connecting active nodes
  const activeEdges = edges.filter(
    (e) => activeNodeIds.has(e.dependsOnId) && activeNodeIds.has(e.issueId)
  );

  for (const edge of activeEdges) {
    const neighbors = adjacency.get(edge.dependsOnId);
    if (neighbors) {
      neighbors.push(edge.issueId);
    }
    const currentDegree = inDegree.get(edge.issueId);
    if (currentDegree !== undefined) {
      inDegree.set(edge.issueId, currentDegree + 1);
    }
  }

  // Step 4: Find root nodes (nodes with no incoming edges)
  const roots: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      roots.push(nodeId);
    }
  }

  // Step 5: DFS from each root to find the longest path
  let longestPath: string[] = [];

  function dfs(nodeId: string, currentPath: string[]): void {
    currentPath.push(nodeId);

    if (currentPath.length > longestPath.length) {
      longestPath = [...currentPath];
    }

    const neighbors = adjacency.get(nodeId);
    if (neighbors) {
      for (const neighbor of neighbors) {
        // Avoid cycles (shouldn't happen in a DAG, but be safe)
        if (!currentPath.includes(neighbor)) {
          dfs(neighbor, currentPath);
        }
      }
    }

    currentPath.pop();
  }

  for (const root of roots) {
    dfs(root, []);
  }

  // Step 6: Build result sets
  const resultNodeIds = new Set(longestPath);
  const resultEdgeIds = new Set<string>();

  // Find edges that connect consecutive nodes on the critical path
  for (let i = 0; i < longestPath.length - 1; i++) {
    const from = longestPath[i];
    const to = longestPath[i + 1];
    // Find the matching edge
    if (from !== undefined && to !== undefined) {
      for (const edge of activeEdges) {
        if (edge.dependsOnId === from && edge.issueId === to) {
          resultEdgeIds.add(`${edge.dependsOnId}->${edge.issueId}`);
          break;
        }
      }
    }
  }

  return {
    nodeIds: resultNodeIds,
    edgeIds: resultEdgeIds,
  };
}
