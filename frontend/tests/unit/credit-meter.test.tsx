/**
 * CreditMeter (adj-202.3.7) — live spend + session timer.
 *
 * Tests cover the logic-bearing formatting (session clock, credits, dollars) and
 * the rendered telemetry. Pure styling is exempt. The meter math itself lives in
 * `computeBridgeMeter` (tested in useBridgeSession.test.ts); here we verify the
 * presentation contract.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CreditMeter, formatSessionClock } from '../../src/components/bridge/CreditMeter';
import { computeBridgeMeter } from '../../src/hooks/useBridgeSession';

describe('formatSessionClock', () => {
  it('should format zero as 0:00', () => {
    expect(formatSessionClock(0)).toBe('0:00');
  });

  it('should zero-pad seconds under a minute', () => {
    expect(formatSessionClock(5_000)).toBe('0:05');
  });

  it('should roll into minutes', () => {
    expect(formatSessionClock(65_000)).toBe('1:05');
  });

  it('should clamp negative (clock skew) to 0:00', () => {
    expect(formatSessionClock(-1_000)).toBe('0:00');
  });
});

describe('CreditMeter', () => {
  it('should render the session clock and the credit/dollar spend', () => {
    const elapsedMs = 12_000; // 2 blocks
    const meter = computeBridgeMeter(elapsedMs);
    render(<CreditMeter meter={meter} elapsedMs={elapsedMs} />);

    expect(screen.getByTestId('session-clock')).toHaveTextContent('0:12');
    // 12s → upfront(2) + 2 blocks × 2 = 6 credits → $0.06
    expect(screen.getByTestId('credit-spend')).toHaveTextContent('6');
    expect(screen.getByTestId('dollar-spend')).toHaveTextContent('$0.06');
  });
});
