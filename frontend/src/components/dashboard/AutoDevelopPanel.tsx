import React, { useMemo, type CSSProperties } from 'react';

import { AUTO_DEVELOP_PHASES, type AutoDevelopStatus, type AutoDevelopPhase } from '../../types';
import './AutoDevelopPanel.css';

interface AutoDevelopPanelProps {
  /** Current auto-develop status. */
  status: AutoDevelopStatus;
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  amber: '#FFAA00',
} as const;

/** Get the index of the current phase, or -1 if none. */
function getPhaseIndex(phase: string | null): number {
  if (!phase) return -1;
  const upper = phase.toUpperCase() as AutoDevelopPhase;
  return AUTO_DEVELOP_PHASES.indexOf(upper);
}

/** Auto-develop dashboard panel showing loop state, phase pipeline, and proposal stats. */
export const AutoDevelopPanel: React.FC<AutoDevelopPanelProps> = ({ status }) => {
  const currentPhaseIndex = useMemo(() => getPhaseIndex(status.currentPhase), [status.currentPhase]);

  const proposalTotal = status.proposals.inReview + status.proposals.accepted +
    status.proposals.escalated + status.proposals.dismissed;

  return (
    <div className="dashboard-widget-container dashboard-widget-full-width">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-widget-title">AUTO-DEVELOP</h3>
        <div className="dashboard-header-stats">
          {status.paused && (
            <span className="dashboard-header-stat" style={{ color: colors.amber }}>
              PAUSED
            </span>
          )}
          {status.activeCycleId && (
            <span className="dashboard-header-stat dashboard-header-stat-highlight">
              CYCLE ACTIVE
            </span>
          )}
        </div>
      </div>
      <div className="dashboard-widget-content">
        {/* Phase Pipeline */}
        <div className="auto-develop-pipeline">
          <h4 className="auto-develop-section-title">PHASE PIPELINE</h4>
          <div className="auto-develop-phases">
            {AUTO_DEVELOP_PHASES.map((phase, idx) => {
              const isActive = idx === currentPhaseIndex;
              const isCompleted = currentPhaseIndex > -1 && idx < currentPhaseIndex;
              return (
                <React.Fragment key={phase}>
                  {idx > 0 && (
                    <div
                      className="auto-develop-phase-connector"
                      style={{
                        backgroundColor: isCompleted || isActive
                          ? colors.primary
                          : colors.primaryDim,
                        opacity: isCompleted || isActive ? 1 : 0.3,
                      }}
                    />
                  )}
                  <div
                    className={`auto-develop-phase-dot ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                    title={phase}
                  >
                    <div
                      className="auto-develop-phase-indicator"
                      style={phaseIndicatorStyle(isActive, isCompleted)}
                    />
                    <span
                      className="auto-develop-phase-label"
                      style={{
                        color: isActive ? colors.primary : colors.primaryDim,
                        textShadow: isActive ? `0 0 8px ${colors.primaryGlow}` : 'none',
                      }}
                    >
                      {phase}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Proposal Stats */}
        <div className="auto-develop-stats">
          <h4 className="auto-develop-section-title">PROPOSALS</h4>
          <div className="auto-develop-stats-grid">
            <ProposalStat label="IN REVIEW" count={status.proposals.inReview} highlight />
            <ProposalStat label="ACCEPTED" count={status.proposals.accepted} />
            <ProposalStat label="ESCALATED" count={status.proposals.escalated} warning />
            <ProposalStat label="DISMISSED" count={status.proposals.dismissed} dim />
          </div>
          {proposalTotal > 0 && (
            <div className="auto-develop-confidence-bars">
              <ConfidenceBar label="Acceptance" value={proposalTotal > 0 ? status.proposals.accepted / proposalTotal : 0} />
              <ConfidenceBar label="Escalation" value={proposalTotal > 0 ? status.proposals.escalated / proposalTotal : 0} warning />
            </div>
          )}
        </div>

        {/* Execution Summary */}
        {status.epicsInExecution > 0 && (
          <div className="auto-develop-execution">
            <span className="auto-develop-execution-label">EPICS IN EXECUTION:</span>
            <span className="auto-develop-execution-count">{status.epicsInExecution}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/** Compute inline style for a phase indicator dot. */
function phaseIndicatorStyle(isActive: boolean, isCompleted: boolean): CSSProperties {
  if (isActive) {
    return {
      backgroundColor: colors.primary,
      boxShadow: `0 0 8px ${colors.primaryGlow}, 0 0 16px ${colors.primaryGlow}`,
    };
  }
  if (isCompleted) {
    return {
      backgroundColor: colors.primary,
      opacity: 0.6,
    };
  }
  return {
    backgroundColor: colors.primaryDim,
    opacity: 0.3,
  };
}

/** Single proposal stat display. */
function ProposalStat({ label, count, highlight, warning, dim }: {
  label: string;
  count: number;
  highlight?: boolean;
  warning?: boolean;
  dim?: boolean;
}) {
  const valueColor = warning
    ? colors.amber
    : dim
      ? colors.primaryDim
      : highlight && count > 0
        ? colors.primary
        : colors.primaryDim;

  return (
    <div className="auto-develop-stat">
      <span
        className="auto-develop-stat-value"
        style={{
          color: valueColor,
          textShadow: highlight && count > 0 ? `0 0 8px ${colors.primaryGlow}` : 'none',
        }}
      >
        {count}
      </span>
      <span className="auto-develop-stat-label">{label}</span>
    </div>
  );
}

/** Horizontal confidence bar. */
function ConfidenceBar({ label, value, warning }: { label: string; value: number; warning?: boolean }) {
  const color = warning ? colors.amber : colors.primary;
  const percent = Math.round(value * 100);

  return (
    <div className="auto-develop-confidence-bar">
      <span className="auto-develop-confidence-label">{label}</span>
      <div className="auto-develop-confidence-track">
        <div
          className="auto-develop-confidence-fill"
          style={{
            width: `${percent}%`,
            backgroundColor: color,
            boxShadow: `0 0 4px ${color}`,
          }}
        />
      </div>
      <span className="auto-develop-confidence-value" style={{ color }}>{percent}%</span>
    </div>
  );
}

export default AutoDevelopPanel;
