import { useState, type CSSProperties } from 'react';
import { ConvoyList } from './ConvoyList';

export type ConvoySortOption = 'ACTIVITY' | 'PRIORITY' | 'PROGRESS' | 'ID';

export interface ConvoysViewProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

export function ConvoysView({ isActive = true }: ConvoysViewProps) {
  const [sortBy, setSortBy] = useState<ConvoySortOption>('ACTIVITY');

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h2 style={styles.title} className="crt-glow">CONVOY TRACKING</h2>
        
        <div style={styles.controls}>
          <span style={styles.sortLabel}>SORT BY:</span>
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as ConvoySortOption)}
            style={styles.select}
          >
            <option value="ACTIVITY">LATEST ACTIVITY</option>
            <option value="PRIORITY">URGENCY (P0-P4)</option>
            <option value="PROGRESS">LEAST COMPLETE</option>
            <option value="ID">CONVOY ID</option>
          </select>
        </div>
      </header>
      <ConvoyList sortBy={sortBy} isActive={isActive} />
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#0A0A0A',
    border: '1px solid var(--crt-phosphor-dim)',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    margin: 0,
    fontSize: '1.2rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.2em',
    fontFamily: '"Share Tech Mono", monospace',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  sortLabel: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
  },
  select: {
    backgroundColor: '#050505',
    color: 'var(--crt-phosphor)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    padding: '2px 8px',
    outline: 'none',
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>;