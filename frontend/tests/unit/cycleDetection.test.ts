/**
 * Unit tests for the cycle detection algorithm.
 * Detects circular dependencies in the bead dependency graph.
 */
import { describe, it, expect } from 'vitest';

import { detectCycles, type CycleDetectionResult } from '../../src/utils/cycle-detection';
import type { GraphDependency } from '../../src/types/beads-graph';

/** Helper to create a dependency edge. */
function makeEdge(issueId: string, dependsOnId: string): GraphDependency {
  return { issueId, dependsOnId, type: 'depends_on' };
}

describe('detectCycles', () => {
  it('should return empty result for no edges', () => {
    const result: CycleDetectionResult = detectCycles([]);
    expect(result.hasCycles).toBe(false);
    expect(result.cycles.length).toBe(0);
    expect(result.nodesInCycles.size).toBe(0);
    expect(result.edgesInCycles.size).toBe(0);
  });

  it('should return empty result for a DAG (no cycles)', () => {
    const edges = [
      makeEdge('A', 'B'), // A depends on B
      makeEdge('B', 'C'), // B depends on C
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(false);
    expect(result.cycles.length).toBe(0);
    expect(result.nodesInCycles.size).toBe(0);
    expect(result.edgesInCycles.size).toBe(0);
  });

  it('should detect a simple 2-node cycle', () => {
    // A depends on B, B depends on A
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('B', 'A'),
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.cycles.length).toBeGreaterThanOrEqual(1);
    expect(result.nodesInCycles.has('A')).toBe(true);
    expect(result.nodesInCycles.has('B')).toBe(true);
  });

  it('should detect a 3-node cycle', () => {
    // A -> B -> C -> A (circular)
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
      makeEdge('C', 'A'),
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.nodesInCycles.has('A')).toBe(true);
    expect(result.nodesInCycles.has('B')).toBe(true);
    expect(result.nodesInCycles.has('C')).toBe(true);
  });

  it('should detect a self-loop', () => {
    // A depends on itself
    const edges = [
      makeEdge('A', 'A'),
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.nodesInCycles.has('A')).toBe(true);
  });

  it('should detect cycle in larger graph with non-cyclic parts', () => {
    // Non-cyclic: D -> E
    // Cyclic: A -> B -> C -> A
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
      makeEdge('C', 'A'),
      makeEdge('D', 'E'),
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    // D and E should NOT be in cycles
    expect(result.nodesInCycles.has('D')).toBe(false);
    expect(result.nodesInCycles.has('E')).toBe(false);
    // A, B, C should be in cycles
    expect(result.nodesInCycles.has('A')).toBe(true);
    expect(result.nodesInCycles.has('B')).toBe(true);
    expect(result.nodesInCycles.has('C')).toBe(true);
  });

  it('should populate edgesInCycles for edges forming cycles', () => {
    // A -> B -> A (cycle)
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('B', 'A'),
      makeEdge('C', 'A'), // C depends on A, not part of cycle
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.edgesInCycles.size).toBeGreaterThanOrEqual(2);
    // The cycle edges should be present
    expect(result.edgesInCycles.has('B->A')).toBe(true);
    expect(result.edgesInCycles.has('A->B')).toBe(true);
  });

  it('should handle diamond shape without false positives', () => {
    // D depends on B and C; B and C depend on A
    // This is NOT a cycle
    const edges = [
      makeEdge('B', 'A'), // B depends on A
      makeEdge('C', 'A'), // C depends on A
      makeEdge('D', 'B'), // D depends on B
      makeEdge('D', 'C'), // D depends on C
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(false);
    expect(result.nodesInCycles.size).toBe(0);
  });

  it('should handle multiple independent cycles', () => {
    // Cycle 1: A -> B -> A
    // Cycle 2: C -> D -> C
    const edges = [
      makeEdge('A', 'B'),
      makeEdge('B', 'A'),
      makeEdge('C', 'D'),
      makeEdge('D', 'C'),
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.cycles.length).toBeGreaterThanOrEqual(2);
    expect(result.nodesInCycles.has('A')).toBe(true);
    expect(result.nodesInCycles.has('B')).toBe(true);
    expect(result.nodesInCycles.has('C')).toBe(true);
    expect(result.nodesInCycles.has('D')).toBe(true);
  });
});
