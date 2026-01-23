import { useState, useCallback, type CSSProperties } from 'react';
import { BeadsList, type BeadsStatusFilter } from './BeadsList';
import { OverseerToggle } from '../shared/OverseerToggle';

export interface BeadsViewProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

export function BeadsView({ isActive = true }: BeadsViewProps) {
  // Default shows active work: open + in_progress + blocked
  const [statusFilter, setStatusFilter] = useState<BeadsStatusFilter>('default');
  const [searchInput, setSearchInput] = useState('');

  // Overseer view filter state
  const [overseerView, setOverseerView] = useState(false);

  const handleOverseerToggle = useCallback((enabled: boolean) => {
    setOverseerView(enabled);
  }, []);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h2 style={styles.title} className="crt-glow">BEADS TRACKER</h2>

        <div style={styles.controls}>
          <OverseerToggle
            storageKey="beads-overseer-view"
            onChange={handleOverseerToggle}
          />

          {/* Search Input */}
          <div style={styles.searchContainer}>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); }}
              placeholder="SEARCH..."
              style={styles.searchInput}
              aria-label="Search beads"
            />
            {searchInput && (
              <button
                style={styles.clearButton}
                onClick={() => { setSearchInput(''); }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <span style={styles.filterLabel}>STATUS:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BeadsStatusFilter)}
            style={styles.select}
          >
            <option value="default">DEFAULT</option>
            <option value="open">OPEN</option>
            <option value="hooked">HOOKED</option>
            <option value="in_progress">IN PROGRESS</option>
            <option value="blocked">BLOCKED</option>
            <option value="deferred">DEFERRED</option>
            <option value="closed">CLOSED</option>
            <option value="all">ALL</option>
          </select>
        </div>
      </header>
      <BeadsList statusFilter={statusFilter} isActive={isActive} searchQuery={searchInput} overseerView={overseerView} />
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
  filterLabel: {
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
  searchContainer: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchInput: {
    backgroundColor: '#050505',
    color: 'var(--crt-phosphor)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    padding: '4px 24px 4px 8px',
    outline: 'none',
    width: '140px',
    letterSpacing: '0.05em',
  },
  clearButton: {
    position: 'absolute',
    right: '4px',
    background: 'none',
    border: 'none',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '1rem',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
} satisfies Record<string, CSSProperties>;
