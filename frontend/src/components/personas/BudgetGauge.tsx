/**
 * Retro segmented power gauge for persona point budget.
 *
 * 10 segments (each = 10 points). Colors shift from green (safe)
 * to amber (warning at 80+) to red (over budget at 101+).
 * Shows "092/100 PTS" readout with contextual status labels.
 *
 * Design specs: adj-xs1k, adj-4jb0
 */
import type { CSSProperties } from 'react';
import { POINT_BUDGET } from '../../types';

const GAUGE_SEGMENTS = 10;
const POINTS_PER_SEGMENT = POINT_BUDGET / GAUGE_SEGMENTS; // 10

interface BudgetGaugeProps {
  /** Current total points spent. */
  spent: number;
}

/**
 * Determine the gauge color zone based on points spent.
 */
function getZone(spent: number): 'safe' | 'warning' | 'full' | 'over' {
  if (spent > POINT_BUDGET) return 'over';
  if (spent === POINT_BUDGET) return 'full';
  if (spent >= 80) return 'warning';
  return 'safe';
}

function getZoneColor(zone: ReturnType<typeof getZone>): string {
  switch (zone) {
    case 'safe': return 'var(--crt-phosphor)';
    case 'warning': return 'var(--pipboy-amber)';
    case 'full': return 'var(--pipboy-amber)';
    case 'over': return 'var(--pipboy-red)';
  }
}

function getStatusLabel(spent: number, zone: ReturnType<typeof getZone>): string {
  switch (zone) {
    case 'safe': return '';
    case 'warning': return 'NEARING LIMIT';
    case 'full': return 'FULLY ALLOCATED';
    case 'over': return `OVER BUDGET BY ${spent - POINT_BUDGET}`;
  }
}

export function BudgetGauge({ spent }: BudgetGaugeProps) {
  const zone = getZone(spent);
  const zoneColor = getZoneColor(zone);
  const statusLabel = getStatusLabel(spent, zone);
  const displaySpent = String(Math.min(spent, 999)).padStart(3, '0');

  const segments: React.ReactNode[] = [];
  for (let i = 0; i < GAUGE_SEGMENTS; i++) {
    const segmentStart = i * POINTS_PER_SEGMENT;
    const segmentEnd = segmentStart + POINTS_PER_SEGMENT;

    let fillPercent: number;
    if (spent >= segmentEnd) {
      fillPercent = 100;
    } else if (spent <= segmentStart) {
      fillPercent = 0;
    } else {
      fillPercent = ((spent - segmentStart) / POINTS_PER_SEGMENT) * 100;
    }

    segments.push(
      <div key={i} style={styles.segmentOuter}>
        <div
          style={{
            ...styles.segmentFill,
            width: `${fillPercent}%`,
            background: zoneColor,
            boxShadow: fillPercent > 0 ? `0 0 6px ${zoneColor}` : 'none',
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.container,
        borderColor: zone === 'over' ? 'var(--pipboy-red)' : 'var(--crt-phosphor-dim)',
      }}
      className={zone === 'over' ? 'pulse-error' : ''}
      role="meter"
      aria-valuenow={spent}
      aria-valuemin={0}
      aria-valuemax={POINT_BUDGET}
      aria-label={`Budget: ${spent} of ${POINT_BUDGET} points`}
    >
      <div style={styles.labelRow}>
        <span style={styles.label}>BUDGET</span>
        {statusLabel && (
          <span style={{ ...styles.statusLabel, color: zoneColor }}>
            {statusLabel}
          </span>
        )}
      </div>
      <div style={styles.gaugeRow}>
        <div style={styles.track}>{segments}</div>
        <span style={{ ...styles.readout, color: zoneColor }}>
          {displaySpent}/{POINT_BUDGET} PTS
        </span>
      </div>
    </div>
  );
}

const styles = {
  container: {
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'var(--theme-bg-elevated)',
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  },

  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },

  label: {
    fontSize: '0.7rem',
    letterSpacing: '0.15em',
    color: 'var(--crt-phosphor-dim)',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },

  statusLabel: {
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    fontWeight: 'bold',
  },

  gaugeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  track: {
    display: 'flex',
    gap: '3px',
    flex: 1,
  },

  segmentOuter: {
    flex: '1 1 0%',
    height: '20px',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'transparent',
    overflow: 'hidden',
    position: 'relative',
  },

  segmentFill: {
    height: '100%',
    transition: 'width 0.15s ease, background 0.15s ease',
  },

  readout: {
    fontSize: '0.8rem',
    fontWeight: 'bold',
    letterSpacing: '0.05em',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
} satisfies Record<string, CSSProperties>;
