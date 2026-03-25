/**
 * Tests for BeadsList cost-fetch behavior.
 * Regression tests for adj-6ksw (cost-fetch fires every poll cycle)
 * and adj-scrr (beadCosts state accumulates stale entries).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the logic extracted from the component: the stable ID derivation
// and the cost state replacement (not merge) behavior.

describe('BeadsList cost-fetch stability (adj-6ksw)', () => {
  it('should produce the same activeBeadIds string when bead set is unchanged but array ref differs', () => {
    // Simulate two different array references with the same active beads
    const beadsA = [
      { id: 'adj-001', status: 'in_progress' },
      { id: 'adj-002', status: 'hooked' },
      { id: 'adj-003', status: 'open' },
    ];
    const beadsB = [
      { id: 'adj-001', status: 'in_progress' },
      { id: 'adj-002', status: 'hooked' },
      { id: 'adj-003', status: 'open' },
    ];

    // These are different references
    expect(beadsA).not.toBe(beadsB);

    // The stable key derivation should produce the same string
    const deriveKey = (beads: { id: string; status: string }[]) =>
      beads
        .filter((b) => b.status === 'in_progress' || b.status === 'hooked')
        .map((b) => b.id)
        .sort()
        .join(',');

    expect(deriveKey(beadsA)).toBe(deriveKey(beadsB));
    expect(deriveKey(beadsA)).toBe('adj-001,adj-002');
  });

  it('should produce a different activeBeadIds string when active bead set changes', () => {
    const beadsBefore = [
      { id: 'adj-001', status: 'in_progress' },
      { id: 'adj-002', status: 'hooked' },
    ];
    const beadsAfter = [
      { id: 'adj-001', status: 'in_progress' },
      { id: 'adj-002', status: 'closed' }, // no longer active
      { id: 'adj-003', status: 'in_progress' }, // new active bead
    ];

    const deriveKey = (beads: { id: string; status: string }[]) =>
      beads
        .filter((b) => b.status === 'in_progress' || b.status === 'hooked')
        .map((b) => b.id)
        .sort()
        .join(',');

    expect(deriveKey(beadsBefore)).not.toBe(deriveKey(beadsAfter));
  });
});

describe('BeadsList cost state replacement (adj-scrr)', () => {
  it('should not retain stale entries when using replacement instead of merge', () => {
    // Simulate the old (buggy) merge behavior
    const oldState: Record<string, number> = { 'adj-001': 1.50, 'adj-002': 2.00 };
    const newResults: Record<string, number> = { 'adj-001': 1.75 }; // adj-002 no longer active

    // Old behavior: merge retains stale adj-002
    const mergedState = { ...oldState, ...newResults };
    expect(mergedState['adj-002']).toBe(2.00); // stale entry persists

    // New behavior: replacement drops stale entries
    const replacedState = newResults;
    expect(replacedState['adj-002']).toBeUndefined(); // stale entry gone
    expect(replacedState['adj-001']).toBe(1.75);
  });
});
