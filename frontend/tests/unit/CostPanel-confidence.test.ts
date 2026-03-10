/**
 * Tests for CostPanel confidence indicator logic.
 * Covers aggregateReconciliationStatus which determines
 * overall cost confidence from per-session reconciliation statuses.
 */
import { describe, it, expect } from 'vitest';

import { aggregateReconciliationStatus } from '../../src/components/dashboard/CostPanel';
import type { CostSummary, CostEntry } from '../../src/services/api-costs';

/** Helper to create a minimal CostSummary with the given session entries. */
function makeSummary(entries: Partial<CostEntry>[]): CostSummary {
  const sessions: Record<string, CostEntry> = {};
  for (const entry of entries) {
    const id = entry.sessionId ?? `session-${Math.random().toString(36).slice(2, 8)}`;
    sessions[id] = {
      sessionId: id,
      projectPath: '/test',
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: entry.cost ?? 1.0,
      lastUpdated: new Date().toISOString(),
      agentId: entry.agentId,
      reconciliationStatus: entry.reconciliationStatus,
      jsonlCost: entry.jsonlCost,
    };
  }
  return {
    totalCost: Object.values(sessions).reduce((sum, s) => sum + s.cost, 0),
    totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    sessions,
    projects: {},
  };
}

describe('aggregateReconciliationStatus', () => {
  it('should return "estimated" when there are no sessions', () => {
    const summary = makeSummary([]);
    expect(aggregateReconciliationStatus(summary)).toBe('estimated');
  });

  it('should return "verified" when all sessions are verified', () => {
    const summary = makeSummary([
      { reconciliationStatus: 'verified' },
      { reconciliationStatus: 'verified' },
      { reconciliationStatus: 'verified' },
    ]);
    expect(aggregateReconciliationStatus(summary)).toBe('verified');
  });

  it('should return "estimated" when any session has no reconciliation status', () => {
    const summary = makeSummary([
      { reconciliationStatus: 'verified' },
      { /* no reconciliationStatus — defaults to estimated */ },
    ]);
    expect(aggregateReconciliationStatus(summary)).toBe('estimated');
  });

  it('should return "estimated" when all sessions are estimated', () => {
    const summary = makeSummary([
      { reconciliationStatus: 'estimated' },
      { reconciliationStatus: 'estimated' },
    ]);
    expect(aggregateReconciliationStatus(summary)).toBe('estimated');
  });

  it('should return "discrepancy" when any session has a discrepancy', () => {
    const summary = makeSummary([
      { reconciliationStatus: 'verified' },
      { reconciliationStatus: 'discrepancy', jsonlCost: 5.0, cost: 4.5 },
      { reconciliationStatus: 'estimated' },
    ]);
    expect(aggregateReconciliationStatus(summary)).toBe('discrepancy');
  });

  it('should return "discrepancy" even if all other sessions are verified', () => {
    const summary = makeSummary([
      { reconciliationStatus: 'verified' },
      { reconciliationStatus: 'verified' },
      { reconciliationStatus: 'discrepancy' },
    ]);
    expect(aggregateReconciliationStatus(summary)).toBe('discrepancy');
  });

  it('should return "estimated" when sessions have a mix of estimated and undefined', () => {
    const summary = makeSummary([
      { reconciliationStatus: 'estimated' },
      { /* undefined status */ },
    ]);
    expect(aggregateReconciliationStatus(summary)).toBe('estimated');
  });

  it('should return "verified" for a single verified session', () => {
    const summary = makeSummary([{ reconciliationStatus: 'verified' }]);
    expect(aggregateReconciliationStatus(summary)).toBe('verified');
  });
});
