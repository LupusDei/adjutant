/**
 * CostPanel - Cost dashboard panel for the Overview page.
 * Shows total spend, per-agent breakdown, burn rate, and budget status.
 * Retro terminal (Pip-Boy) aesthetic.
 */
import { useMemo, useState, useCallback, type CSSProperties } from 'react';

import { useCostDashboard } from '../../hooks/useCostDashboard';
import { costApi } from '../../services/api-costs';
import type { CostSummary, BurnRate, BudgetRecord } from '../../services/api-costs';

// ============================================================================
// Formatters
// ============================================================================

/** Format a dollar amount with 2 decimal places. */
function formatCost(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Format a timestamp as a short time string. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase().replace(/\s/g, '');
}

/** Get the trend indicator character. */
function trendIndicator(trend: BurnRate['trend']): string {
  switch (trend) {
    case 'increasing': return '\u2191';
    case 'decreasing': return '\u2193';
    case 'stable': return '\u2192';
  }
}

/** Get the trend color. */
function trendColor(trend: BurnRate['trend']): string {
  switch (trend) {
    case 'increasing': return '#FF4444';
    case 'decreasing': return 'var(--crt-phosphor)';
    case 'stable': return 'var(--crt-phosphor-dim)';
  }
}

/** Get the budget bar color based on percentage used and budget thresholds. */
function budgetBarColor(percentUsed: number, warningPercent: number, criticalPercent: number): string {
  if (percentUsed > 100) return '#FF4444';
  if (percentUsed >= criticalPercent) return '#FF4444';
  if (percentUsed >= warningPercent) return '#FFB000';
  return 'var(--crt-phosphor)';
}

/** Get the budget status label based on percentage used and budget thresholds. */
function budgetStatusLabel(percentUsed: number, warningPercent: number, criticalPercent: number): string {
  if (percentUsed > 100) return 'EXCEEDED';
  if (percentUsed >= criticalPercent) return 'CRITICAL';
  if (percentUsed >= warningPercent) return 'WARNING';
  return 'OK';
}

/** Derive per-session cost entries sorted by cost descending. */
function getSessionBreakdown(summary: CostSummary): Array<{ sessionId: string; cost: number; projectPath: string }> {
  return Object.values(summary.sessions)
    .map((s) => ({ sessionId: s.sessionId, cost: s.cost, projectPath: s.projectPath }))
    .sort((a, b) => b.cost - a.cost);
}

// ============================================================================
// Sub-components
// ============================================================================

/** Big headline stat showing total spend. */
function TotalSpend({ summary }: { summary: CostSummary }) {
  const sessionCount = Object.keys(summary.sessions).length;
  return (
    <div style={styles.totalSpend}>
      <div style={styles.totalAmount}>{formatCost(summary.totalCost)}</div>
      <div style={styles.totalSubtext}>
        {sessionCount} session{sessionCount !== 1 ? 's' : ''} total
      </div>
    </div>
  );
}

/** Burn rate display with trend indicator. */
function BurnRateDisplay({ burnRate }: { burnRate: BurnRate }) {
  return (
    <div style={styles.burnRateContainer}>
      <span style={styles.burnRateLabel}>BURN RATE</span>
      <span style={styles.burnRateValue}>{formatCost(burnRate.rate1h)}/hr</span>
      <span style={{ ...styles.burnRateTrend, color: trendColor(burnRate.trend) }}>
        {trendIndicator(burnRate.trend)} {burnRate.trend.toUpperCase()}
      </span>
    </div>
  );
}

/** Per-agent/session cost breakdown table. */
function SessionBreakdown({ summary }: { summary: CostSummary }) {
  const sessions = useMemo(() => getSessionBreakdown(summary), [summary]);

  if (sessions.length === 0) {
    return <div style={styles.emptyText}>No session data</div>;
  }

  return (
    <div style={styles.breakdownSection}>
      <div style={styles.sectionHeader}>PER-SESSION COSTS</div>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>SESSION</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>COST</th>
          </tr>
        </thead>
        <tbody>
          {sessions.slice(0, 10).map((session) => (
            <tr key={session.sessionId} style={styles.tr}>
              <td style={styles.td}>
                <span style={styles.sessionId}>{session.sessionId.slice(0, 12)}</span>
              </td>
              <td style={{ ...styles.td, textAlign: 'right' }}>
                <span style={styles.costValue}>{formatCost(session.cost)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sessions.length > 10 && (
        <div style={styles.moreText}>+ {sessions.length - 10} more sessions</div>
      )}
    </div>
  );
}

/** Budget progress bar with status. */
function BudgetBar({ budget, totalSpent }: { budget: BudgetRecord; totalSpent: number }) {
  const percentUsed = budget.budgetAmount > 0
    ? (totalSpent / budget.budgetAmount) * 100
    : 0;
  const barColor = budgetBarColor(percentUsed, budget.warningPercent, budget.criticalPercent);
  const statusText = budgetStatusLabel(percentUsed, budget.warningPercent, budget.criticalPercent);
  const clampedPercent = Math.min(percentUsed, 100);

  return (
    <div style={styles.budgetSection}>
      <div style={styles.budgetHeader}>
        <span style={styles.budgetLabel}>BUDGET ({budget.scope.toUpperCase()})</span>
        <span style={{ ...styles.budgetStatus, color: barColor }}>
          {statusText}
        </span>
      </div>
      <div style={styles.budgetBarContainer}>
        <div style={styles.budgetBarBackground}>
          <div
            style={{
              ...styles.budgetBarFill,
              width: `${clampedPercent}%`,
              backgroundColor: barColor,
              boxShadow: `0 0 6px ${barColor}`,
            }}
          />
        </div>
      </div>
      <div style={styles.budgetText}>
        {formatCost(totalSpent)} / {formatCost(budget.budgetAmount)} ({Math.round(percentUsed)}%)
      </div>
    </div>
  );
}

/** Simple form to set a budget. */
function BudgetForm({ onSubmit, onCancel }: {
  onSubmit: (amount: number) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState('');

  const handleSubmit = useCallback(() => {
    const parsed = parseFloat(amount);
    if (!isNaN(parsed) && parsed > 0) {
      onSubmit(parsed);
    }
  }, [amount, onSubmit]);

  return (
    <div style={styles.budgetForm}>
      <div style={styles.budgetFormRow}>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="Budget amount ($)"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          style={styles.budgetInput}
        />
        <button style={styles.budgetSubmit} onClick={handleSubmit}>SET</button>
        <button style={styles.budgetCancel} onClick={onCancel}>X</button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CostPanel() {
  const { summary, burnRate, budgets, loading, error, lastUpdated, refresh } = useCostDashboard();
  const [showBudgetForm, setShowBudgetForm] = useState(false);

  const handleSetBudget = useCallback(async (amount: number) => {
    try {
      await costApi.createBudget({ scope: 'session', amount });
      setShowBudgetForm(false);
      await refresh();
    } catch {
      // Budget creation failed silently
    }
  }, [refresh]);

  const handleDeleteBudget = useCallback(async (id: number) => {
    try {
      await costApi.deleteBudget(id);
      await refresh();
    } catch {
      // Budget deletion failed silently
    }
  }, [refresh]);

  // Loading state
  if (loading && !summary) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingState}>
          <div style={styles.loadingPulse} />
          SCANNING COST DATA...
        </div>
      </div>
    );
  }

  // Error state
  if (error && !summary) {
    return (
      <div style={styles.container}>
        <div style={styles.errorState}>
          COST SCAN FAILED: {error.message}
        </div>
      </div>
    );
  }

  // No data
  if (!summary) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyText}>NO COST DATA AVAILABLE</div>
      </div>
    );
  }

  const activeBudget = budgets.length > 0 ? budgets[0] : null;

  return (
    <div style={styles.container}>
      {/* Total Spend */}
      <TotalSpend summary={summary} />

      {/* Burn Rate */}
      {burnRate && <BurnRateDisplay burnRate={burnRate} />}

      {/* Budget Bar */}
      {activeBudget && (
        <div style={styles.budgetWrapper}>
          <BudgetBar budget={activeBudget} totalSpent={summary.totalCost} />
          <button
            style={styles.budgetDeleteBtn}
            onClick={() => { void handleDeleteBudget(activeBudget.id); }}
            title="Remove budget"
          >
            DEL
          </button>
        </div>
      )}

      {/* Budget Form */}
      {!activeBudget && !showBudgetForm && (
        <button
          style={styles.setBudgetBtn}
          onClick={() => { setShowBudgetForm(true); }}
        >
          + SET BUDGET
        </button>
      )}
      {showBudgetForm && (
        <BudgetForm
          onSubmit={(amount) => { void handleSetBudget(amount); }}
          onCancel={() => { setShowBudgetForm(false); }}
        />
      )}

      {/* Session Breakdown */}
      <SessionBreakdown summary={summary} />

      {/* Last Updated */}
      {lastUpdated && (
        <div style={styles.lastUpdated}>
          UPDATED {formatTime(lastUpdated)}
        </div>
      )}
    </div>
  );
}

export default CostPanel;

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    fontFamily: '"Share Tech Mono", monospace',
    color: 'var(--crt-phosphor)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    gap: '12px',
  },
  loadingPulse: {
    width: '32px',
    height: '32px',
    border: '2px solid var(--crt-phosphor-dim)',
    borderTopColor: 'var(--crt-phosphor)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorState: {
    padding: '16px',
    color: '#FF4444',
    textAlign: 'center',
    letterSpacing: '0.1em',
  },
  emptyText: {
    padding: '24px',
    color: 'var(--crt-phosphor-dim)',
    textAlign: 'center',
    letterSpacing: '0.1em',
    fontStyle: 'italic',
  },

  // Total Spend
  totalSpend: {
    textAlign: 'center',
    padding: '12px 0 8px',
  },
  totalAmount: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: 'var(--crt-phosphor-bright, var(--crt-phosphor))',
    textShadow: '0 0 12px var(--crt-phosphor-glow, rgba(0, 255, 0, 0.4))',
    letterSpacing: '0.05em',
  },
  totalSubtext: {
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor-dim)',
    marginTop: '4px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },

  // Burn Rate
  burnRateContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: 'rgba(0, 255, 0, 0.03)',
    border: '1px solid rgba(0, 255, 0, 0.15)',
    borderRadius: '2px',
  },
  burnRateLabel: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.15em',
    flexShrink: 0,
  },
  burnRateValue: {
    fontSize: '0.9rem',
    fontWeight: 'bold',
    color: 'var(--crt-phosphor)',
    flex: 1,
  },
  burnRateTrend: {
    fontSize: '0.7rem',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },

  // Budget
  budgetWrapper: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  budgetSection: {
    flex: 1,
    padding: '10px 12px',
    backgroundColor: 'rgba(0, 255, 0, 0.03)',
    border: '1px solid rgba(0, 255, 0, 0.15)',
    borderRadius: '2px',
  },
  budgetHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  budgetLabel: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.15em',
  },
  budgetStatus: {
    fontSize: '0.65rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  budgetBarContainer: {
    marginBottom: '4px',
  },
  budgetBarBackground: {
    height: '8px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  budgetBarFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  budgetText: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    textAlign: 'right',
  },
  budgetDeleteBtn: {
    background: 'none',
    border: '1px solid rgba(255, 68, 68, 0.4)',
    color: '#FF4444',
    fontSize: '0.6rem',
    padding: '4px 8px',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.05em',
    marginTop: '10px',
    flexShrink: 0,
  },
  setBudgetBtn: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontSize: '0.7rem',
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
    width: '100%',
    textAlign: 'center',
    transition: 'border-color 0.15s ease',
  },
  budgetForm: {
    padding: '8px',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'rgba(0, 255, 0, 0.03)',
    borderRadius: '2px',
  },
  budgetFormRow: {
    display: 'flex',
    gap: '6px',
  },
  budgetInput: {
    flex: 1,
    background: 'rgba(0, 0, 0, 0.5)',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    padding: '6px 8px',
    outline: 'none',
    caretColor: 'var(--crt-phosphor)',
  },
  budgetSubmit: {
    background: 'none',
    border: '1px solid var(--crt-phosphor)',
    color: 'var(--crt-phosphor)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.7rem',
    padding: '6px 12px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
  },
  budgetCancel: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.7rem',
    padding: '6px 8px',
    cursor: 'pointer',
  },

  // Session Breakdown
  breakdownSection: {
    borderTop: '1px solid rgba(0, 255, 0, 0.15)',
    paddingTop: '10px',
  },
  sectionHeader: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.15em',
    marginBottom: '6px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.75rem',
  },
  th: {
    textAlign: 'left',
    padding: '4px 6px',
    color: 'var(--crt-phosphor-dim)',
    fontWeight: 'normal',
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    borderBottom: '1px solid rgba(0, 255, 0, 0.1)',
  },
  tr: {
    borderBottom: '1px solid rgba(0, 255, 0, 0.05)',
  },
  td: {
    padding: '4px 6px',
  },
  sessionId: {
    color: 'var(--crt-phosphor)',
    fontFamily: '"Share Tech Mono", monospace',
  },
  costValue: {
    color: 'var(--crt-phosphor)',
    fontWeight: 'bold',
  },
  moreText: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    textAlign: 'center',
    marginTop: '6px',
    opacity: 0.7,
  },

  // Last Updated
  lastUpdated: {
    fontSize: '0.6rem',
    color: 'var(--crt-phosphor-dim)',
    textAlign: 'right',
    letterSpacing: '0.1em',
    opacity: 0.6,
  },
} satisfies Record<string, CSSProperties>;
