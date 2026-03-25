import React, { useState, useCallback, type CSSProperties } from 'react';

import { api } from '../../services/api';
import type { AutoDevelopStatus } from '../../types';

interface AutoDevelopToggleProps {
  /** Project ID to toggle auto-develop for. */
  projectId: string;
  /** Current auto-develop status (null if not yet loaded). */
  status: AutoDevelopStatus | null;
  /** Called after a successful toggle to refresh parent state. */
  onToggled?: () => void;
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: 'var(--theme-bg-screen)',
  amber: '#FFAA00',
} as const;

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  } as CSSProperties,

  label: {
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: colors.primaryDim,
  } as CSSProperties,

  toggleButton: {
    width: '44px',
    height: '24px',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.2s',
    flexShrink: 0,
  } as CSSProperties,

  toggleOn: {
    backgroundColor: colors.primary,
  },

  toggleOff: {
    backgroundColor: colors.primaryDim,
  },

  toggleDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },

  toggleKnob: {
    position: 'absolute',
    top: '2px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: colors.background,
    transition: 'left 0.2s',
  } as CSSProperties,

  toggleKnobOn: {
    left: '22px',
  },

  toggleKnobOff: {
    left: '2px',
  },

  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  } as CSSProperties,

  statusActive: {
    backgroundColor: colors.primary,
    boxShadow: `0 0 8px ${colors.primaryGlow}`,
  },

  statusPaused: {
    backgroundColor: colors.amber,
    boxShadow: `0 0 8px ${colors.amber}66`,
  },

  statusDisabled: {
    backgroundColor: colors.primaryDim,
    opacity: 0.4,
  },
} as const;

/** Auto-develop toggle switch with status indicator dot. */
export const AutoDevelopToggle: React.FC<AutoDevelopToggleProps> = ({
  projectId,
  status,
  onToggled,
}) => {
  const [toggling, setToggling] = useState(false);

  const enabled = status?.enabled ?? false;
  const paused = status?.paused ?? false;

  const handleToggle = useCallback(async () => {
    if (toggling) return;
    setToggling(true);
    try {
      await api.projects.updateAutoDevelop(projectId, !enabled);
      onToggled?.();
    } catch {
      // Silently fail - the UI will remain in current state
    } finally {
      setToggling(false);
    }
  }, [projectId, enabled, toggling, onToggled]);

  const dotStyle: CSSProperties = {
    ...styles.statusDot,
    ...(enabled && !paused ? styles.statusActive : paused ? styles.statusPaused : styles.statusDisabled),
  };

  return (
    <div style={styles.container}>
      <span style={dotStyle} title={enabled ? (paused ? 'Paused' : 'Active') : 'Disabled'} />
      <span style={styles.label}>AUTO-DEV</span>
      <button
        type="button"
        onClick={() => { void handleToggle(); }}
        disabled={toggling}
        style={{
          ...styles.toggleButton,
          ...(enabled ? styles.toggleOn : styles.toggleOff),
          ...(toggling ? styles.toggleDisabled : {}),
        }}
        title={enabled ? 'Disable auto-develop' : 'Enable auto-develop'}
        aria-label={enabled ? 'Disable auto-develop' : 'Enable auto-develop'}
      >
        <span
          style={{
            ...styles.toggleKnob,
            ...(enabled ? styles.toggleKnobOn : styles.toggleKnobOff),
          }}
        />
      </button>
    </div>
  );
};

export default AutoDevelopToggle;
