import { describe, it, expect } from 'vitest';
import { statusLabel, statusIndicatorClass } from '../../src/components/dashboard/agentStatusDisplay';

describe('agent status display mappers', () => {
  it('maps the known live states', () => {
    expect(statusLabel('working')).toBe('WORKING');
    expect(statusLabel('idle')).toBe('IDLE');
    expect(statusLabel('blocked')).toBe('BLOCKED');
    expect(statusIndicatorClass('working')).toBe('working');
    expect(statusIndicatorClass('blocked')).toBe('stuck');
  });

  // The reported bug: a live agent reconnecting after a backend restart is
  // marked `booting` by the backend, but the UI rendered it as OFFLINE because
  // there was no `booting` case. It must read as BOOTING (alive), NOT OFFLINE.
  it('renders booting as a distinct live state, not OFFLINE', () => {
    expect(statusLabel('booting')).toBe('BOOTING');
    expect(statusLabel('booting')).not.toBe('OFFLINE');
    expect(statusIndicatorClass('booting')).toBe('booting');
    expect(statusIndicatorClass('booting')).not.toBe('offline');
  });

  it('falls through to OFFLINE only for a genuinely unknown/absent status', () => {
    expect(statusLabel('offline')).toBe('OFFLINE');
    expect(statusLabel('')).toBe('OFFLINE');
    expect(statusIndicatorClass('offline')).toBe('offline');
  });
});
