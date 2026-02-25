/**
 * Zod schemas and types for the beads graph API.
 *
 * Used by GET /api/beads/graph to validate and type the response.
 */

import { z } from "zod";

// ============================================================================
// Graph Dependency Schema
// ============================================================================

/**
 * A dependency edge between two beads in the graph.
 * issueId depends on dependsOnId.
 */
export const GraphDependencySchema = z.object({
  issueId: z.string(),
  dependsOnId: z.string(),
  type: z.string(),
});

// ============================================================================
// Graph Node Schema
// ============================================================================

/**
 * A node in the beads dependency graph.
 * Contains the essential bead info needed for visualization.
 */
export const GraphNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  type: z.string(),
  priority: z.number(),
  assignee: z.string().nullable(),
  source: z.string().optional(),
});

// ============================================================================
// Beads Graph Response Schema
// ============================================================================

/**
 * Full response shape for GET /api/beads/graph.
 * Contains nodes (beads) and edges (dependencies) for graph rendering.
 */
export const BeadsGraphResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphDependencySchema),
});

// ============================================================================
// Inferred Types
// ============================================================================

export type GraphDependency = z.infer<typeof GraphDependencySchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type BeadsGraphResponse = z.infer<typeof BeadsGraphResponseSchema>;
