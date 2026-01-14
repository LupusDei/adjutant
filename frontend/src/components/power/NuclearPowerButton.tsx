import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import type { GastownStatus, PowerState } from '../../types';
import './NuclearPowerButton.css';

/**
 * Power toggle switch for the header.
 * Simple flip switch to control Gastown power state.
 */
export function NuclearPowerButton() {
  const { data, refresh } = usePolling<GastownStatus>(() => api.getStatus(), {
    interval: 10000,
  });

  const [actionState, setActionState] = useState<PowerState | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const powerState = actionState ?? data?.powerState ?? null;
  const isRunning = powerState === 'running';
  const isStopped = powerState === 'stopped';
  const isTransitioning = powerState === 'starting' || powerState === 'stopping';

  // Reset action state when server catches up
  useEffect(() => {
    if (data?.powerState && actionState === data.powerState) {
      setActionState(null);
    }
  }, [actionState, data?.powerState]);

  const handleToggle = useCallback(async () => {
    if (isTransitioning || actionLoading || !powerState) return;

    setActionLoading(true);

    try {
      if (isRunning) {
        setActionState('stopping');
        const result = await api.power.down();
        setActionState(result.newState);
      } else if (isStopped) {
        setActionState('starting');
        const result = await api.power.up();
        setActionState(result.newState);
      }
    } catch {
      setActionState(null);
    } finally {
      setActionLoading(false);
      void refresh();
    }
  }, [isTransitioning, actionLoading, powerState, isRunning, isStopped, refresh]);

  const statusClass = isRunning
    ? 'power-on'
    : isStopped
      ? 'power-off'
      : isTransitioning
        ? 'power-transitioning'
        : 'power-unknown';

  const statusLabel = isRunning
    ? 'ON'
    : isStopped
      ? 'OFF'
      : isTransitioning
        ? '...'
        : '?';

  return (
    <div className={`power-toggle ${statusClass}`}>
      <span className="power-label">TOWN</span>
      <button
        type="button"
        className="toggle-switch"
        onClick={() => void handleToggle()}
        disabled={isTransitioning || actionLoading || !powerState}
        aria-label={`Power is ${statusLabel}. Click to ${isRunning ? 'shut down' : 'start'} Gastown.`}
        aria-pressed={isRunning}
        role="switch"
      >
        <div className="switch-track">
          <span className="track-label track-label-on">ON</span>
          <span className="track-label track-label-off">OFF</span>
          <div className="switch-thumb">
            <div className="thumb-indicator" />
          </div>
        </div>
      </button>
    </div>
  );
}

export default NuclearPowerButton;
