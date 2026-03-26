import React, { type CSSProperties } from 'react';

import type { AutoDevelopStatus } from '../../types';

interface CycleHistoryProps {
  /** Current auto-develop status with cycle stats. */
  status: AutoDevelopStatus;
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
} as const;

const styles = {
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  } as CSSProperties,

  statsRow: {
    display: 'flex',
    gap: '24px',
    alignItems: 'center',
  } as CSSProperties,

  statBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  } as CSSProperties,

  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: colors.primary,
    textShadow: `0 0 8px ${colors.primaryGlow}`,
  } as CSSProperties,

  statLabel: {
    fontSize: '0.6rem',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  } as CSSProperties,

  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '4px',
  } as CSSProperties,

  progressTrack: {
    flex: 1,
    height: '8px',
    background: 'rgba(0, 0, 0, 0.5)',
    border: `1px solid ${colors.primaryDim}`,
    overflow: 'hidden',
  } as CSSProperties,

  progressLabel: {
    fontSize: '0.65rem',
    color: colors.primaryDim,
    minWidth: '70px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  } as CSSProperties,

  progressValue: {
    fontSize: '0.65rem',
    color: colors.primary,
    minWidth: '40px',
    textAlign: 'right',
  } as CSSProperties,

  emptyText: {
    color: colors.primaryDim,
    fontStyle: 'italic',
    fontSize: '0.75rem',
  } as CSSProperties,

  activeCycle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    border: `1px solid rgba(0, 255, 0, 0.2)`,
    background: 'rgba(0, 255, 0, 0.03)',
  } as CSSProperties,

  activeDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: colors.primary,
    boxShadow: `0 0 6px ${colors.primaryGlow}`,
    animation: 'pulse 2s ease-in-out infinite',
  } as CSSProperties,

  activeLabel: {
    fontSize: '0.7rem',
    color: colors.primary,
    letterSpacing: '0.05em',
  } as CSSProperties,
} as const;

/** Cycle history timeline widget showing aggregate auto-develop cycle stats. */
export const CycleHistory: React.FC<CycleHistoryProps> = ({ status }) => {
  const { totalCycles, completedCycles, currentCycleNumber } = status.cycleStats;

  if (totalCycles === 0 && !status.activeCycleId) {
    return (
      <div className="dashboard-widget-container">
        <div className="dashboard-widget-header">
          <h3 className="dashboard-widget-title">CYCLE HISTORY</h3>
        </div>
        <div className="dashboard-widget-content">
          <p style={styles.emptyText}>No cycles recorded yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-widget-container">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-widget-title">CYCLE HISTORY</h3>
        <div className="dashboard-header-stats">
          <span className="dashboard-header-stat">
            CYCLE {currentCycleNumber || totalCycles}
          </span>
        </div>
      </div>
      <div className="dashboard-widget-content">
        <div style={styles.timeline}>
          {/* Active Cycle Indicator */}
          {status.activeCycleId && (
            <div style={styles.activeCycle}>
              <div style={styles.activeDot} />
              <span style={styles.activeLabel}>
                ACTIVE CYCLE: {status.activeCycleId}
              </span>
            </div>
          )}

          {/* Stats */}
          <div style={styles.statsRow}>
            <div style={styles.statBlock}>
              <span style={styles.statValue}>{currentCycleNumber || totalCycles}</span>
              <span style={styles.statLabel}>CURRENT</span>
            </div>
            <div style={styles.statBlock}>
              <span style={styles.statValue}>{completedCycles}</span>
              <span style={styles.statLabel}>COMPLETED</span>
            </div>
            <div style={styles.statBlock}>
              <span style={styles.statValue}>{totalCycles}</span>
              <span style={styles.statLabel}>TOTAL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CycleHistory;
