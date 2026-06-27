/**
 * describeConnectError (adj-202.3.7.6) — turn a failed connect into a message a
 * Commander can act on. A 429 daily-ceiling is an expected budget cap, NOT a
 * broken link, so it must read distinctly from a generic failure.
 */
import { describe, it, expect } from 'vitest';

import { describeConnectError } from '../../src/components/bridge/connect-error';

describe('describeConnectError', () => {
  it('should describe a 429 status as a daily ceiling', () => {
    const out = describeConnectError({ error: 'whatever', errorCode: null, errorStatus: 429 });
    expect(out.kind).toBe('ceiling');
    expect(out.title).toMatch(/daily credit ceiling/i);
  });

  it('should describe the ceiling code regardless of status', () => {
    const out = describeConnectError({
      error: 'Daily credit ceiling reached.',
      errorCode: 'DAILY_CREDIT_CEILING_REACHED',
      errorStatus: null,
    });
    expect(out.kind).toBe('ceiling');
  });

  it('should fall back to a generic link failure for other errors', () => {
    const out = describeConnectError({
      error: 'socket hang up',
      errorCode: 'NETWORK_ERROR',
      errorStatus: 502,
    });
    expect(out.kind).toBe('failure');
    expect(out.title).toMatch(/link failed/i);
    expect(out.detail).toBe('socket hang up');
  });

  it('should handle a null error message gracefully', () => {
    const out = describeConnectError({ error: null, errorCode: null, errorStatus: null });
    expect(out.kind).toBe('failure');
    expect(out.title).toBeTruthy();
  });
});
