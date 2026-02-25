/**
 * Unit tests for the critical path algorithm.
 * The critical path is the longest chain of non-closed nodes
 * through the dependency graph from roots to leaves.
 */
import { describe, it, expect } from 'vitest';

import { computeCriticalPath } from '../../src/utils/critical-path';
import type { GraphNodeData, GraphDependency } from '../../src/types/beads-graph';

/** Helper to create a node with defaults. */
function makeNode(
  id: string,
  status: string = 'open',
  type: string = 'task'
): GraphNodeData {
  return {
    id,
    title: `Node ${id}`,
    status,
    type,
    priority: 2,
    assignee: null,
  };
}

/** Helper to create a dependency edge. */
function makeEdge(issueId: string, dependsOnId: string): GraphDependency {
  return { issueId, dependsOnId, type: 'depends_on' };
}

describe('computeCriticalPath', () => {
  it('should return empty sets for empty input', () => {
    const result = computeCriticalPath([], []);
    expect(result.nodeIds.size).toBe(0);
    expect(result.edgeIds.size).toBe(0);
  });

  it('should return single node as critical path', () => {
    const nodes = [makeNode('A')];
    const result = computeCriticalPath(nodes, []);
    expect(result.nodeIds.size).toBe(1);
    expect(result.nodeIds.has('A')).toBe(true);
    expect(result.edgeIds.size).toBe(0);
  });

  it('should find linear chain A->B->C as critical path', () => {
    // A depends on B, B depends on C
    // Edge direction: dependsOnId -> issueId
    // So C -> B -> A in dependency flow
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [
      makeEdge('A', 'B'), // A depends on B
      makeEdge('B', 'C'), // B depends on C
    ];
    const result = computeCriticalPath(nodes, edges);

    expect(result.nodeIds.size).toBe(3);
    expect(result.nodeIds.has('A')).toBe(true);
    expect(result.nodeIds.has('B')).toBe(true);
    expect(result.nodeIds.has('C')).toBe(true);
    expect(result.edgeIds.size).toBe(2);
  });

  it('should pick the longer branch in a branching graph', () => {
    // A depends on B (short branch)
    // A depends on C, C depends on D, D depends on E (long branch)
    const nodes = [
      makeNode('A'),
      makeNode('B'),
      makeNode('C'),
      makeNode('D'),
      makeNode('E'),
    ];
    const edges = [
      makeEdge('A', 'B'), // A depends on B
      makeEdge('A', 'C'), // A depends on C
      makeEdge('C', 'D'), // C depends on D
      makeEdge('D', 'E'), // D depends on E
    ];
    const result = computeCriticalPath(nodes, edges);

    // Critical path should be E -> D -> C -> A (length 4)
    expect(result.nodeIds.size).toBe(4);
    expect(result.nodeIds.has('A')).toBe(true);
    expect(result.nodeIds.has('C')).toBe(true);
    expect(result.nodeIds.has('D')).toBe(true);
    expect(result.nodeIds.has('E')).toBe(true);
    // B should NOT be on the critical path
    expect(result.nodeIds.has('B')).toBe(false);
    expect(result.edgeIds.size).toBe(3);
  });

  it('should return empty critical path when all nodes are closed', () => {
    const nodes = [
      makeNode('A', 'closed'),
      makeNode('B', 'closed'),
      makeNode('C', 'closed'),
    ];
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
    ];
    const result = computeCriticalPath(nodes, edges);

    expect(result.nodeIds.size).toBe(0);
    expect(result.edgeIds.size).toBe(0);
  });

  it('should handle diamond shape (A->B, A->C, B->D, C->D)', () => {
    // D depends on B and C; B and C depend on A
    const nodes = [
      makeNode('A'),
      makeNode('B'),
      makeNode('C'),
      makeNode('D'),
    ];
    const edges = [
      makeEdge('B', 'A'), // B depends on A
      makeEdge('C', 'A'), // C depends on A
      makeEdge('D', 'B'), // D depends on B
      makeEdge('D', 'C'), // D depends on C
    ];
    const result = computeCriticalPath(nodes, edges);

    // Either path A->B->D or A->C->D is valid (length 3)
    expect(result.nodeIds.size).toBe(3);
    expect(result.nodeIds.has('A')).toBe(true);
    expect(result.nodeIds.has('D')).toBe(true);
    // Either B or C (or both) should be on the path, but total is 3
    const hasBorC = result.nodeIds.has('B') || result.nodeIds.has('C');
    expect(hasBorC).toBe(true);
    expect(result.edgeIds.size).toBe(2);
  });

  it('should only count non-closed nodes in chain length', () => {
    // Chain: A -> B -> C -> D -> E
    // B and D are closed, so the "active" chain should skip them
    // Non-closed nodes: A, C, E
    // But the path through active nodes considers connectivity:
    // The algorithm filters closed nodes first, then finds paths in the remaining graph
    const nodes = [
      makeNode('A'),
      makeNode('B', 'closed'),
      makeNode('C'),
      makeNode('D', 'closed'),
      makeNode('E'),
    ];
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
      makeEdge('C', 'D'),
      makeEdge('D', 'E'),
    ];
    const result = computeCriticalPath(nodes, edges);

    // With closed nodes filtered, the edges between remaining nodes are broken.
    // A depends on B (closed) -> A becomes a root
    // C depends on D (closed) -> C becomes a root
    // Remaining nodes: A, C, E (all disconnected since their connecting nodes are closed)
    // Each forms its own chain of length 1
    // Critical path is one of them (length 1)
    expect(result.nodeIds.size).toBe(1);
    expect(result.edgeIds.size).toBe(0);
  });

  it('should handle mixed statuses (only closed is excluded)', () => {
    // open, in_progress, blocked, hooked are all "active" statuses
    const nodes = [
      makeNode('A', 'open'),
      makeNode('B', 'in_progress'),
      makeNode('C', 'blocked'),
      makeNode('D', 'hooked'),
    ];
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
      makeEdge('C', 'D'),
    ];
    const result = computeCriticalPath(nodes, edges);

    // All 4 nodes are active, full chain is critical path
    expect(result.nodeIds.size).toBe(4);
    expect(result.nodeIds.has('A')).toBe(true);
    expect(result.nodeIds.has('B')).toBe(true);
    expect(result.nodeIds.has('C')).toBe(true);
    expect(result.nodeIds.has('D')).toBe(true);
    expect(result.edgeIds.size).toBe(3);
  });

  it('should handle disconnected subgraphs and pick the longest', () => {
    // Subgraph 1: A -> B (length 2)
    // Subgraph 2: C -> D -> E (length 3)
    const nodes = [
      makeNode('A'),
      makeNode('B'),
      makeNode('C'),
      makeNode('D'),
      makeNode('E'),
    ];
    const edges = [
      makeEdge('A', 'B'), // A depends on B
      makeEdge('C', 'D'), // C depends on D
      makeEdge('D', 'E'), // D depends on E
    ];
    const result = computeCriticalPath(nodes, edges);

    // Subgraph 2 is longer: E -> D -> C
    expect(result.nodeIds.size).toBe(3);
    expect(result.nodeIds.has('C')).toBe(true);
    expect(result.nodeIds.has('D')).toBe(true);
    expect(result.nodeIds.has('E')).toBe(true);
    expect(result.edgeIds.size).toBe(2);
  });

  it('should return correct edge IDs on the critical path', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [
      makeEdge('A', 'B'), // A depends on B
      makeEdge('B', 'C'), // B depends on C
    ];
    const result = computeCriticalPath(nodes, edges);

    // Edge IDs use the same format as React Flow: "edge-{index}-{dependsOnId}-{issueId}"
    // But since we're working with raw GraphDependency, edge IDs are constructed from the pairs
    for (const edgeId of result.edgeIds) {
      // Each edge ID should reference nodes on the critical path
      expect(typeof edgeId).toBe('string');
      expect(edgeId.length).toBeGreaterThan(0);
    }
    expect(result.edgeIds.size).toBe(2);
  });

  it('should handle nodes with no edges (all isolated)', () => {
    const nodes = [
      makeNode('A'),
      makeNode('B'),
      makeNode('C'),
    ];
    const result = computeCriticalPath(nodes, []);

    // Each node is its own chain of length 1, pick any one
    expect(result.nodeIds.size).toBe(1);
    expect(result.edgeIds.size).toBe(0);
  });

  it('should handle edges referencing non-existent nodes gracefully', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('A', 'NONEXISTENT'), // edge to missing node
    ];
    const result = computeCriticalPath(nodes, edges);

    // Should still find A -> B path, ignoring the bad edge
    expect(result.nodeIds.size).toBe(2);
    expect(result.nodeIds.has('A')).toBe(true);
    expect(result.nodeIds.has('B')).toBe(true);
    expect(result.edgeIds.size).toBe(1);
  });
});
