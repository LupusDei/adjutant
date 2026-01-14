import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import { useRigSync } from '../shared/RigFilter';
import type { GastownStatus, PowerState } from '../../types';

/**
 * Props for the PowerButton component.
 */
export interface PowerButtonProps {
  /** Optional CSS class name */
  className?: string;
}

type PowerDisplayState = PowerState | 'unknown';

const POWER_LABELS: Record<PowerDisplayState, string> = {
  stopped: 'OFFLINE',
  starting: 'STARTING',
  running: 'ONLINE',
  stopping: 'STOPPING',
  unknown: 'UNKNOWN',
};

const POWER_SUBLABELS: Record<PowerDisplayState, string> = {
  stopped: 'SYSTEM DOWN',
  starting: 'IGNITING CORES',
  running: 'SYSTEM NOMINAL',
  stopping: 'POWERING DOWN',
  unknown: 'AWAITING SIGNAL',
};

/**
 * PowerButton component with state visualization and control.
 */
export function PowerButton({ className = '' }: PowerButtonProps) {
  const {
    data,
    loading,
    error,
    refresh,
    lastUpdated,
  } = usePolling<GastownStatus>(() => api.getStatus(), {
    interval: 10000,
  });

  // Sync available rigs to the filter context
  useRigSync(data?.rigs);

  const [actionState, setActionState] = useState<PowerState | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const powerState = actionState ?? data?.powerState ?? null;
  const displayState: PowerDisplayState = powerState ?? 'unknown';
  const isTransitioning =
    displayState === 'starting' || displayState === 'stopping';

  useEffect(() => {
    if (data?.powerState && actionState === data.powerState) {
      setActionState(null);
    }
  }, [actionState, data?.powerState]);

  const statusColors = useMemo(() => {
    switch (displayState) {
      case 'running':
        return {
          accent: colors.primaryBright,
          glow: colors.primaryGlow,
        };
      case 'starting':
        return {
          accent: colors.warning,
          glow: colors.warningGlow,
        };
      case 'stopping':
        return {
          accent: colors.warningDim,
          glow: colors.warningGlow,
        };
      case 'stopped':
        return {
          accent: colors.danger,
          glow: colors.dangerGlow,
        };
      default:
        return {
          accent: colors.neutral,
          glow: colors.neutralGlow,
        };
    }
  }, [displayState]);

  const buttonLabel = (() => {
    if (displayState === 'running') return 'SHUTDOWN';
    if (displayState === 'stopped') return 'START';
    if (displayState === 'unknown') return 'CHECKING';
    return 'HOLD';
  })();

  const handleToggle = async () => {
    if (!powerState || isTransitioning || actionLoading) return;

    setActionLoading(true);
    setActionError(null);

    try {
      if (powerState === 'running') {
        setActionState('stopping');
        const result = await api.power.down();
        setActionState(result.newState);
      } else if (powerState === 'stopped') {
        setActionState('starting');
        const result = await api.power.up();
        setActionState(result.newState);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(false);
      void refresh();
    }
  };

  return (
    <section style={styles.container} className={className}>
      <header style={styles.header}>
        <h2 style={styles.title}>POWER CONTROL</h2>
        <div style={styles.syncStatus}>
          {loading ? 'SYNCING...' : 'LIVE'}
          {lastUpdated && !loading && (
            <span style={styles.syncTime}>
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      <div style={styles.body}>
        <div style={styles.stateDisplay}>
          <div
            className={isTransitioning ? 'power-ring-pulse' : ''}
            style={{
              ...styles.stateRing,
              borderColor: statusColors.accent,
              boxShadow: `0 0 18px ${statusColors.glow}`,
            }}
            aria-hidden="true"
          >
            <div
              className={isTransitioning ? 'power-core-breathe' : ''}
              style={{
                ...styles.stateCore,
                backgroundColor: statusColors.accent,
                boxShadow: `0 0 12px ${statusColors.glow}`,
              }}
            />
          </div>
          <div style={styles.stateText}>
            <div
              className={isTransitioning ? 'power-text-flicker' : ''}
              style={{ ...styles.stateLabel, color: statusColors.accent }}
            >
              {POWER_LABELS[displayState]}
            </div>
            <div
              className={isTransitioning ? 'power-text-flicker' : ''}
              style={{ ...styles.stateSubLabel, color: statusColors.accent }}
            >
              {POWER_SUBLABELS[displayState]}
            </div>
          </div>
        </div>

        <button
          type="button"
          className={actionLoading ? 'power-button-loading' : ''}
          style={{
            ...styles.powerButton,
            borderColor: statusColors.accent,
            color: statusColors.accent,
            boxShadow: `0 0 12px ${statusColors.glow}`,
            opacity: actionLoading || isTransitioning ? 0.6 : 1,
            cursor:
              actionLoading || isTransitioning || displayState === 'unknown'
                ? 'not-allowed'
                : 'pointer',
          }}
          onClick={() => void handleToggle()}
          disabled={actionLoading || isTransitioning || displayState === 'unknown'}
          aria-label="Toggle gastown power"
        >
          {actionLoading ? 'EXECUTING...' : buttonLabel}
        </button>
      </div>

      {(error != null || actionError != null) && (
        <div style={styles.errorBanner} role="alert">
          ⚠ POWER ERROR:{' '}
          {actionError ?? error?.message ?? 'Unknown issue'}
        </div>
      )}
    </section>
  );
}

const colors = {
  primary: '#14F07D',
  primaryBright: '#2BFF96',
  primaryGlow: 'rgba(20, 240, 125, 0.35)',
  background: '#0A0A0A',
  backgroundDark: '#050505',
  panelBorder: '#0A7A3E',
  neutral: '#7CFFDD',
  neutralGlow: 'rgba(124, 255, 221, 0.25)',
  warning: '#FFB000',
  warningDim: '#D38C00',
  warningGlow: 'rgba(255, 176, 0, 0.35)',
  danger: '#FF4444',
  dangerGlow: 'rgba(255, 68, 68, 0.35)',
} as const;

const styles = {
  container: {
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.background,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottom: `1px solid ${colors.panelBorder}`,
    paddingBottom: '8px',
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: colors.primary,
  },
  syncStatus: {
    fontSize: '0.75rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: colors.primary,
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  syncTime: {
    color: colors.primaryBright,
    fontSize: '0.7rem',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    alignItems: 'center',
  },
  stateDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  stateRing: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    border: `2px solid ${colors.primary}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundDark,
  },
  stateCore: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: colors.primary,
  },
  stateText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  stateLabel: {
    fontSize: '1.5rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
  },
  stateSubLabel: {
    fontSize: '0.8rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: colors.primaryBright,
  },
  powerButton: {
    padding: '12px 28px',
    fontSize: '1rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    backgroundColor: 'transparent',
    border: `1px solid ${colors.primary}`,
    borderRadius: '999px',
    transition: 'all 0.2s ease',
  },
  errorBanner: {
    border: `1px solid ${colors.danger}`,
    color: colors.danger,
    padding: '8px 12px',
    fontSize: '0.85rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    backgroundColor: colors.backgroundDark,
  },
} satisfies Record<string, CSSProperties>;

export default PowerButton;
