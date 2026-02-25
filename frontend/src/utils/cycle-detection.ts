/**
 * Cycle detection algorithm for bead dependency graphs.
 *
 * Uses DFS-based cycle detection (Tarjan's approach with back-edge detection)
 * to find all circular dependencies in the graph.
 * Returns the set of nodes and edges involved in cycles.
 */
import type { GraphDependency } from '../types/beads-graph';

/** A single cycle represented as an ordered list of node IDs. */
export type Cycle = string[];

/** Result of the cycle detection computation. */
export interface CycleDetectionResult {
  /** Whether any cycles were found. */
  hasCycles: boolean;
  /** List of detected cycles (each is an ordered list of node IDs). */
  cycles: Cycle[];
  /** Set of node IDs that participate in at least one cycle. */
  nodesInCycles: Set<string>;
  /** Set of edge IDs that form cycles (format: "dependsOnId->issueId"). */
  edgesInCycles: Set<string>;
}

/** DFS node states for cycle detection. */
const enum NodeState {
  /** Not yet visited. */
  Unvisited = 0,
  /** Currently in the DFS recursion stack. */
  InStack = 1,
  /** Fully processed. */
  Done = 2,
}

/**
 * Detect circular dependencies in the dependency graph using DFS.
 *
 * Builds an adjacency list from edges (dependsOnId -> issueId direction,
 * matching the graph's "depends on" semantics), then performs DFS to find
 * back-edges that indicate cycles.
 *
 * @param edges - All dependency edges from the graph
 * @returns Detection result with cycles, affected nodes, and affected edges
 */
export function detectCycles(edges: GraphDependency[]): CycleDetectionResult {
  const emptyResult: CycleDetectionResult = {
    hasCycles: false,
    cycles: [],
    nodesInCycles: new Set<string>(),
    edgesInCycles: new Set<string>(),
  };

  if (edges.length === 0) {
    return emptyResult;
  }

  // Build adjacency list and collect all unique node IDs
  const adjacency = new Map<string, string[]>();
  const allNodes = new Set<string>();

  for (const edge of edges) {
    allNodes.add(edge.dependsOnId);
    allNodes.add(edge.issueId);

    if (!adjacency.has(edge.dependsOnId)) {
      adjacency.set(edge.dependsOnId, []);
    }
    const neighbors = adjacency.get(edge.dependsOnId);
    if (neighbors) {
      neighbors.push(edge.issueId);
    }
  }

  // DFS state tracking
  const state = new Map<string, NodeState>();
  const path: string[] = [];
  const cycles: Cycle[] = [];
  const nodesInCycles = new Set<string>();
  const edgesInCycles = new Set<string>();

  // Initialize all nodes as unvisited
  for (const nodeId of allNodes) {
    state.set(nodeId, NodeState.Unvisited);
  }

  /**
   * DFS visit function.
   * When a back-edge is found (neighbor is InStack), extract the cycle.
   */
  function dfs(nodeId: string): void {
    state.set(nodeId, NodeState.InStack);
    path.push(nodeId);

    const neighbors = adjacency.get(nodeId);
    if (neighbors) {
      for (const neighbor of neighbors) {
        const neighborState = state.get(neighbor);

        if (neighborState === NodeState.InStack) {
          // Found a back-edge: extract the cycle from the path
          const cycleStartIdx = path.indexOf(neighbor);
          if (cycleStartIdx !== -1) {
            const cycle = path.slice(cycleStartIdx);
            cycles.push([...cycle]);

            // Mark all nodes in this cycle
            for (const id of cycle) {
              nodesInCycles.add(id);
            }

            // Mark all edges in this cycle
            for (let i = 0; i < cycle.length; i++) {
              const from = cycle[i];
              const to = cycle[(i + 1) % cycle.length];
              if (from !== undefined && to !== undefined) {
                edgesInCycles.add(`${from}->${to}`);
              }
            }
          }
        } else if (neighborState === NodeState.Unvisited) {
          dfs(neighbor);
        }
        // NodeState.Done: skip, already fully processed
      }
    }

    path.pop();
    state.set(nodeId, NodeState.Done);
  }

  // Run DFS from every unvisited node
  for (const nodeId of allNodes) {
    if (state.get(nodeId) === NodeState.Unvisited) {
      dfs(nodeId);
    }
  }

  return {
    hasCycles: cycles.length > 0,
    cycles,
    nodesInCycles,
    edgesInCycles,
  };
}
