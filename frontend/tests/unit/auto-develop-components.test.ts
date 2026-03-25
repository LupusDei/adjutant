import { describe, it, expect } from 'vitest';

import { AUTO_DEVELOP_PHASES } from '../../src/types';
import type { AutoDevelopStatus } from '../../src/types';

/** Helper to create a mock AutoDevelopStatus. */
function mockStatus(overrides: Partial<AutoDevelopStatus> = {}): AutoDevelopStatus {
  return {
    enabled: false,
    paused: false,
    pausedAt: null,
    currentPhase: null,
    activeCycleId: null,
    visionContext: null,
    proposals: { inReview: 0, accepted: 0, escalated: 0, dismissed: 0 },
    epicsInExecution: 0,
    cycleStats: { totalCycles: 0, completedCycles: 0 },
    ...overrides,
  };
}

describe('AutoDevelopStatus type', () => {
  it('should have correct AUTO_DEVELOP_PHASES constant', () => {
    expect(AUTO_DEVELOP_PHASES).toEqual([
      'ANALYZE', 'IDEATE', 'REVIEW', 'GATE', 'PLAN', 'EXECUTE', 'VALIDATE',
    ]);
    expect(AUTO_DEVELOP_PHASES.length).toBe(7);
  });

  it('should create a valid disabled status', () => {
    const status = mockStatus();
    expect(status.enabled).toBe(false);
    expect(status.paused).toBe(false);
    expect(status.currentPhase).toBeNull();
    expect(status.proposals.inReview).toBe(0);
  });

  it('should create an active status with current phase', () => {
    const status = mockStatus({
      enabled: true,
      currentPhase: 'REVIEW',
      activeCycleId: 'cycle-1',
      proposals: { inReview: 3, accepted: 1, escalated: 0, dismissed: 2 },
      cycleStats: { totalCycles: 5, completedCycles: 3 },
    });
    expect(status.enabled).toBe(true);
    expect(status.currentPhase).toBe('REVIEW');
    expect(status.proposals.inReview).toBe(3);
    expect(status.cycleStats.completedCycles).toBe(3);
  });

  it('should represent a paused escalation state', () => {
    const status = mockStatus({
      enabled: true,
      paused: true,
      pausedAt: '2026-03-24T10:00:00Z',
      currentPhase: 'GATE',
    });
    expect(status.paused).toBe(true);
    expect(status.pausedAt).toBe('2026-03-24T10:00:00Z');
  });
});

describe('Phase index logic', () => {
  /** Replicated from AutoDevelopPanel to unit test independently. */
  function getPhaseIndex(phase: string | null): number {
    if (!phase) return -1;
    const upper = phase.toUpperCase();
    // Safe cast: indexOf returns -1 if not found
    return (AUTO_DEVELOP_PHASES as readonly string[]).indexOf(upper);
  }

  it('should return -1 for null phase', () => {
    expect(getPhaseIndex(null)).toBe(-1);
  });

  it('should return correct index for each phase', () => {
    expect(getPhaseIndex('ANALYZE')).toBe(0);
    expect(getPhaseIndex('IDEATE')).toBe(1);
    expect(getPhaseIndex('REVIEW')).toBe(2);
    expect(getPhaseIndex('GATE')).toBe(3);
    expect(getPhaseIndex('PLAN')).toBe(4);
    expect(getPhaseIndex('EXECUTE')).toBe(5);
    expect(getPhaseIndex('VALIDATE')).toBe(6);
  });

  it('should handle lowercase phase names', () => {
    expect(getPhaseIndex('analyze')).toBe(0);
    expect(getPhaseIndex('execute')).toBe(5);
  });

  it('should return -1 for unknown phase', () => {
    expect(getPhaseIndex('UNKNOWN')).toBe(-1);
  });
});

describe('Cycle completion calculation', () => {
  it('should return 0% when no cycles exist', () => {
    const status = mockStatus({ cycleStats: { totalCycles: 0, completedCycles: 0 } });
    const rate = status.cycleStats.totalCycles > 0
      ? status.cycleStats.completedCycles / status.cycleStats.totalCycles
      : 0;
    expect(rate).toBe(0);
  });

  it('should compute correct completion rate', () => {
    const status = mockStatus({ cycleStats: { totalCycles: 10, completedCycles: 7 } });
    const rate = status.cycleStats.completedCycles / status.cycleStats.totalCycles;
    expect(Math.round(rate * 100)).toBe(70);
  });

  it('should return 100% when all cycles complete', () => {
    const status = mockStatus({ cycleStats: { totalCycles: 5, completedCycles: 5 } });
    const rate = status.cycleStats.completedCycles / status.cycleStats.totalCycles;
    expect(Math.round(rate * 100)).toBe(100);
  });
});

describe('Escalation banner visibility logic', () => {
  it('should show escalation when enabled and paused', () => {
    const status = mockStatus({ enabled: true, paused: true });
    const showEscalation = status.paused && status.enabled;
    expect(showEscalation).toBe(true);
  });

  it('should not show escalation when disabled', () => {
    const status = mockStatus({ enabled: false, paused: true });
    const showEscalation = status.paused && status.enabled;
    expect(showEscalation).toBe(false);
  });

  it('should not show escalation when not paused', () => {
    const status = mockStatus({ enabled: true, paused: false });
    const showEscalation = status.paused && status.enabled;
    expect(showEscalation).toBe(false);
  });
});

describe('Proposal stats calculation', () => {
  it('should compute acceptance rate', () => {
    const proposals = { inReview: 2, accepted: 5, escalated: 1, dismissed: 2 };
    const total = proposals.inReview + proposals.accepted + proposals.escalated + proposals.dismissed;
    const acceptanceRate = total > 0 ? proposals.accepted / total : 0;
    expect(total).toBe(10);
    expect(acceptanceRate).toBe(0.5);
  });

  it('should compute escalation rate', () => {
    const proposals = { inReview: 0, accepted: 3, escalated: 2, dismissed: 5 };
    const total = proposals.inReview + proposals.accepted + proposals.escalated + proposals.dismissed;
    const escalationRate = total > 0 ? proposals.escalated / total : 0;
    expect(escalationRate).toBe(0.2);
  });

  it('should handle zero proposals', () => {
    const proposals = { inReview: 0, accepted: 0, escalated: 0, dismissed: 0 };
    const total = proposals.inReview + proposals.accepted + proposals.escalated + proposals.dismissed;
    const acceptanceRate = total > 0 ? proposals.accepted / total : 0;
    expect(total).toBe(0);
    expect(acceptanceRate).toBe(0);
  });
});
