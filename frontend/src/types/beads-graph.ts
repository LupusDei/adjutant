/**
 * Types for the Bead Dependency Visualization Graph.
 * Used by the DependencyGraphView and related components.
 */

/** Node in the dependency graph (from API). */
export interface GraphNodeData {
  id: string;
  title: string;
  status: string; // "open" | "in_progress" | "closed" | "blocked" | "hooked"
  type: string; // "epic" | "task" | "bug"
  priority: number;
  assignee: string | null;
  source?: string;
}

/** Dependency edge (from API). */
export interface GraphDependency {
  issueId: string;
  dependsOnId: string;
  type: string;
}

/** API response from GET /api/beads/graph. */
export interface BeadsGraphResponse {
  nodes: GraphNodeData[];
  edges: GraphDependency[];
}
