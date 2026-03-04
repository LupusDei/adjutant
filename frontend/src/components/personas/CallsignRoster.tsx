/**
 * Collapsible callsign roster toggles for the Crew/Agents page.
 *
 * Displays all callsigns in a grid with custom retro toggle switches.
 * Master toggle at the top enables/disables all callsigns.
 * ON state: green glow. OFF state: dim.
 *
 * Design spec: adj-adnk
 */
import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { api } from '../../services/api';
import type { CallsignSetting } from '../../types';

export function CallsignRoster() {
  const [expanded, setExpanded] = useState(false);
  const [callsigns, setCallsigns] = useState<CallsignSetting[]>([]);
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  const enabledCount = callsigns.filter(c => c.enabled).length;
  const totalCount = callsigns.length;

  // Fetch callsign settings when expanded
  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    api.callsigns
      .list()
      .then((data) => {
        setCallsigns(data.callsigns);
        setMasterEnabled(data.masterEnabled);
      })
      .catch(() => {
        // Silently fail — callsigns are non-critical UI
      })
      .finally(() => {
        setLoading(false);
      });
  }, [expanded]);

  const handleMasterToggle = useCallback(async () => {
    const newState = !masterEnabled;
    setMasterEnabled(newState);
    // Optimistically update all callsigns
    setCallsigns(prev => prev.map(c => ({ ...c, enabled: newState })));
    try {
      await api.callsigns.toggleAll(newState);
    } catch {
      // Revert on failure
      setMasterEnabled(!newState);
      setCallsigns(prev => prev.map(c => ({ ...c, enabled: !newState })));
    }
  }, [masterEnabled]);

  const handleToggle = useCallback(async (name: string) => {
    const current = callsigns.find(c => c.name === name);
    if (!current) return;
    const newState = !current.enabled;

    // Optimistic update
    setCallsigns(prev => prev.map(c => c.name === name ? { ...c, enabled: newState } : c));

    try {
      await api.callsigns.toggle(name, newState);
    } catch {
      // Revert
      setCallsigns(prev => prev.map(c => c.name === name ? { ...c, enabled: !newState } : c));
    }
  }, [callsigns]);

  return (
    <div style={styles.container}>
      <button
        style={styles.sectionToggle}
        onClick={() => { setExpanded(prev => !prev); }}
        aria-expanded={expanded}
      >
        <span style={styles.toggleArrow}>{expanded ? 'v' : '>'}</span>
        <span style={styles.sectionLabel}>
          CALLSIGN ROSTER ({enabledCount}/{totalCount} ENABLED)
        </span>
        <span style={styles.sectionLine} />
      </button>

      {expanded && (
        <div style={styles.content}>
          {loading ? (
            <div style={styles.loadingState}>LOADING CALLSIGNS...</div>
          ) : (
            <>
              {/* Master toggle */}
              <div style={styles.masterRow}>
                <span style={styles.masterLabel}>ENABLE ALL</span>
                <RetroToggle enabled={masterEnabled} onToggle={() => { void handleMasterToggle(); }} />
              </div>

              {/* Callsign grid */}
              <div style={styles.grid}>
                {callsigns.map((cs) => (
                  <div key={cs.name} style={styles.callsignItem}>
                    <span style={{
                      ...styles.callsignName,
                      color: cs.enabled ? 'var(--crt-phosphor)' : 'var(--crt-phosphor-dim)',
                      opacity: cs.enabled ? 1 : 0.5,
                    }}>
                      {cs.name.toUpperCase()}
                    </span>
                    <RetroToggle
                      enabled={cs.enabled}
                      onToggle={() => { void handleToggle(cs.name); }}
                      compact
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Retro Toggle Switch
// =============================================================================

interface RetroToggleProps {
  enabled: boolean;
  onToggle: () => void;
  compact?: boolean;
}

/**
 * Custom retro toggle: [===ON ] / [ OFF===]
 * ON state: green glow. OFF state: dim.
 */
function RetroToggle({ enabled, onToggle, compact = false }: RetroToggleProps) {
  const width = compact ? 44 : 60;
  const height = compact ? 16 : 20;

  return (
    <button
      style={{
        ...styles.toggle,
        width: `${width}px`,
        height: `${height}px`,
        borderColor: enabled ? 'var(--crt-phosphor)' : 'var(--crt-phosphor-dim)',
        boxShadow: enabled ? '0 0 6px var(--crt-phosphor-glow)' : 'none',
      }}
      onClick={onToggle}
      aria-checked={enabled}
      role="switch"
    >
      <span style={{
        ...styles.toggleKnob,
        left: enabled ? 'calc(100% - 50%)' : '0%',
        width: '50%',
        background: enabled ? 'var(--crt-phosphor)' : 'var(--crt-phosphor-dim)',
        boxShadow: enabled ? '0 0 4px var(--crt-phosphor-glow)' : 'none',
      }} />
      <span style={{
        ...styles.toggleLabel,
        fontSize: compact ? '0.45rem' : '0.5rem',
        color: enabled ? '#000' : 'var(--crt-phosphor-dim)',
        justifyContent: enabled ? 'flex-start' : 'flex-end',
        paddingLeft: enabled ? '3px' : '0',
        paddingRight: enabled ? '0' : '3px',
      }}>
        {enabled ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  },

  sectionToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: 'var(--crt-phosphor)',
    fontSize: '0.8rem',
  },

  toggleArrow: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    width: '12px',
    flexShrink: 0,
  },

  sectionLabel: {
    fontWeight: 'bold',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    flexShrink: 0,
  },

  sectionLine: {
    flex: 1,
    height: '1px',
    background: 'linear-gradient(to right, var(--crt-phosphor-dim), transparent)',
  },

  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'var(--theme-bg-elevated)',
    padding: '12px',
  },

  loadingState: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textAlign: 'center',
    padding: '16px',
  },

  masterRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
    paddingBottom: '10px',
  },

  masterLabel: {
    fontSize: '0.75rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    color: 'var(--crt-phosphor)',
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '8px',
  },

  callsignItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '6px',
    padding: '2px 0',
  },

  callsignName: {
    fontSize: '0.7rem',
    fontWeight: 'bold',
    letterSpacing: '0.08em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Retro toggle styles
  toggle: {
    position: 'relative',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    padding: 0,
    overflow: 'hidden',
    flexShrink: 0,
  },

  toggleKnob: {
    position: 'absolute',
    top: 0,
    height: '100%',
    transition: 'all 0.2s ease',
  },

  toggleLabel: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    fontFamily: '"Share Tech Mono", monospace',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
} satisfies Record<string, CSSProperties>;
