/**
 * CreditMeter (adj-202.3.7) — live spend + session timer for The Bridge.
 *
 * A GWM-1 avatar session burns real Runway credits (≈ $0.20/min), so the panel
 * shows the running cost at all times. The meter math lives in `computeBridgeMeter`
 * (the single source of truth, mirrored from the backend cost guard); this
 * component is the read-out: a session clock plus the credit and dollar spend.
 *
 * Pure presentation — the only logic is time formatting (tested).
 */
import { type CSSProperties } from 'react';

import type { BridgeMeter } from '../../hooks/useBridgeSession';

const AZURE = '#1FB6D6';
const PURPLE = '#a118c4';

/**
 * Format an elapsed-ms duration as a session clock (`M:SS`, minutes uncapped).
 * Negative input (clock skew) clamps to `0:00`.
 */
export function formatSessionClock(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

export interface CreditMeterProps {
  meter: BridgeMeter;
  elapsedMs: number;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1.25rem',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.8125rem',
  letterSpacing: '0.04em',
};

const cellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  lineHeight: 1.2,
};

const labelStyle: CSSProperties = {
  fontSize: '0.625rem',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: '#9aa0a6',
};

const valueStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 600,
};

export function CreditMeter({ meter, elapsedMs }: CreditMeterProps) {
  return (
    <div style={wrapStyle} role="group" aria-label="Session telemetry">
      <div style={cellStyle}>
        <span style={labelStyle}>Session</span>
        <span data-testid="session-clock" style={{ ...valueStyle, color: AZURE }}>
          {formatSessionClock(elapsedMs)}
        </span>
      </div>
      <div style={cellStyle}>
        <span style={labelStyle}>Credits</span>
        <span data-testid="credit-spend" style={{ ...valueStyle, color: PURPLE }}>
          {meter.credits}
        </span>
      </div>
      <div style={cellStyle}>
        <span style={labelStyle}>Spend</span>
        <span data-testid="dollar-spend" style={{ ...valueStyle, color: PURPLE }}>
          {`$${meter.dollars.toFixed(2)}`}
        </span>
      </div>
    </div>
  );
}
