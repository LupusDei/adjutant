/**
 * Standby persona card for the spawnable roster on the Crew page.
 *
 * Dashed border, diamond icon, persona name/description, inline radar chart,
 * and DEPLOY button. Distinguished from running agent cards by border style
 * and lack of status indicators.
 *
 * Design spec: adj-bpxp
 */
import { useCallback, type CSSProperties } from 'react';
import type { Persona } from '../../types';
import { RadarChart } from './RadarChart';

interface PersonaRosterCardProps {
  persona: Persona;
  /** Called when user clicks DEPLOY. */
  onDeploy: (persona: Persona) => void;
  /** Called when user clicks EDIT. */
  onEdit: (persona: Persona) => void;
}

export function PersonaRosterCard({ persona, onDeploy, onEdit }: PersonaRosterCardProps) {
  const handleDeploy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDeploy(persona);
    },
    [persona, onDeploy]
  );

  return (
    <div
      style={styles.card}
      role="listitem"
      aria-label={`Persona: ${persona.name}`}
      onClick={() => { onEdit(persona); }}
    >
      {/* Header: diamond icon + name + deploy button */}
      <div style={styles.header}>
        <span style={styles.diamondIcon} aria-hidden="true">{'\u25C7'}</span>
        <span style={styles.name}>{persona.name.toUpperCase()}</span>
        <button
          style={styles.deployButton}
          onClick={handleDeploy}
          aria-label={`Deploy ${persona.name}`}
        >
          DEPLOY
        </button>
      </div>

      {/* Description */}
      {persona.description && (
        <div style={styles.description}>{persona.description}</div>
      )}

      {/* Radar chart */}
      <div style={styles.radarContainer}>
        <RadarChart traits={persona.traits} size={72} />
      </div>
    </div>
  );
}

const styles = {
  card: {
    border: '1px dashed var(--crt-phosphor-dim)',
    backgroundColor: 'var(--theme-bg-elevated)',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: 'var(--crt-phosphor)',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  diamondIcon: {
    color: 'var(--crt-phosphor)',
    fontSize: '0.85rem',
    flexShrink: 0,
  },

  name: {
    fontSize: '0.85rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  deployButton: {
    padding: '3px 10px',
    border: '1px solid var(--crt-phosphor)',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor)',
    fontSize: '0.6rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    flexShrink: 0,
  },

  description: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.4,
  },

  radarContainer: {
    display: 'flex',
    justifyContent: 'center',
    padding: '4px 0',
  },
} satisfies Record<string, CSSProperties>;
