import { useState, useCallback, useEffect, useMemo, type CSSProperties } from 'react';
import { KanbanBoard } from './KanbanBoard';
import { OverseerToggle } from '../shared/OverseerToggle';
import { usePolling } from '../../hooks/usePolling';
import { fuzzyMatch } from '../../hooks/useFuzzySearch';
import { api } from '../../services/api';
import type { BeadInfo } from '../../types';

export interface BeadsViewProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

/** Rig options for filtering */
type RigFilter = 'ALL' | 'TOWN' | string;

/** Excluded types (always filtered) */
const EXCLUDED_TYPES = ['message', 'epic', 'convoy', 'agent'];

/** Additional type exclusions for overseer view */
const OVERSEER_EXCLUDED_TYPES = ['role', 'witness', 'wisp', 'infrastructure', 'coordination', 'sync'];

/** Title patterns for overseer filtering */
const OVERSEER_EXCLUDED_PATTERNS = [
  'witness', 'wisp', 'internal', 'sync', 'coordination',
  'mail delivery', 'polecat', 'crew assignment', 'rig status', 'heartbeat', 'health check',
];

export function BeadsView({ isActive = true }: BeadsViewProps) {
  const [searchInput, setSearchInput] = useState('');
  const [rigFilter, setRigFilter] = useState<RigFilter>(() => {
    return localStorage.getItem('beads-rig-filter') ?? 'ALL';
  });
  const [overseerView, setOverseerView] = useState(false);
  const [beads, setBeads] = useState<BeadInfo[]>([]);

  // Fetch beads from API
  const {
    data: fetchedBeads,
    loading,
    error,
  } = usePolling<BeadInfo[]>(
    () => api.beads.list({ status: 'all', limit: 500 }),
    { interval: 30000, enabled: isActive }
  );

  // Update local beads state when fetch completes
  useEffect(() => {
    if (fetchedBeads) {
      setBeads(fetchedBeads);
    }
  }, [fetchedBeads]);

  // Extract unique rigs from beads for filter dropdown
  const rigOptions = useMemo(() => {
    const rigs = new Set<string>();
    for (const bead of beads) {
      if (bead.source && bead.source !== 'town' && bead.source !== 'unknown') {
        rigs.add(bead.source);
      }
    }
    return Array.from(rigs).sort();
  }, [beads]);

  // Persist rig filter to localStorage
  useEffect(() => {
    localStorage.setItem('beads-rig-filter', rigFilter);
  }, [rigFilter]);

  // Filter beads based on search, rig, and overseer view
  const filteredBeads = useMemo(() => {
    let result = beads;

    // Filter out excluded types
    result = result.filter((b) => !EXCLUDED_TYPES.includes(b.type.toLowerCase()));

    // Apply rig filter
    if (rigFilter === 'TOWN') {
      result = result.filter((b) => b.source === 'town');
    } else if (rigFilter !== 'ALL') {
      result = result.filter((b) => b.source === rigFilter);
    }

    // Apply overseer filter
    if (overseerView) {
      result = result.filter((bead) => {
        const typeLower = bead.type.toLowerCase();
        const titleLower = bead.title.toLowerCase();
        const idLower = bead.id.toLowerCase();
        const assigneeLower = (bead.assignee ?? '').toLowerCase();

        // Exclude wisp-related beads
        if (typeLower.includes('wisp') || titleLower.includes('wisp') ||
            idLower.includes('wisp') || assigneeLower.includes('wisp')) {
          return false;
        }

        // Exclude operational types
        if (OVERSEER_EXCLUDED_TYPES.includes(typeLower)) return false;

        // Exclude by title patterns
        if (OVERSEER_EXCLUDED_PATTERNS.some((p) => titleLower.includes(p))) return false;

        // Exclude merge beads
        if (titleLower.startsWith('merge:')) return false;

        return true;
      });
    }

    // Apply search filter
    if (searchInput.trim()) {
      const query = searchInput.toLowerCase().trim();
      result = result.filter((bead) => {
        if (fuzzyMatch(query, bead.id).matches) return true;
        if (fuzzyMatch(query, bead.title).matches) return true;
        if (bead.assignee && fuzzyMatch(query, bead.assignee).matches) return true;
        return false;
      });
    }

    return result;
  }, [beads, rigFilter, overseerView, searchInput]);

  const handleOverseerToggle = useCallback((enabled: boolean) => {
    setOverseerView(enabled);
  }, []);

  const handleBeadsChange = useCallback((updater: (prev: BeadInfo[]) => BeadInfo[]) => {
    setBeads(updater);
  }, []);

  if (loading && beads.length === 0) {
    return (
      <div style={styles.container}>
        <header style={styles.header}>
          <h2 style={styles.title} className="crt-glow">WORK BOARD</h2>
        </header>
        <div style={styles.loadingState}>
          <div style={styles.loadingPulse} />
          SCANNING BEADS DATABASE...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <header style={styles.header}>
          <h2 style={styles.title} className="crt-glow">WORK BOARD</h2>
        </header>
        <div style={styles.errorState}>
          SCAN FAILED: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h2 style={styles.title} className="crt-glow">WORK BOARD</h2>

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

          {/* Rig Filter */}
          <span style={styles.filterLabel}>RIG:</span>
          <select
            value={rigFilter}
            onChange={(e) => setRigFilter(e.target.value as RigFilter)}
            style={styles.select}
          >
            <option value="ALL">ALL</option>
            <option value="TOWN">TOWN</option>
            {rigOptions.map((rig) => (
              <option key={rig} value={rig}>
                {rig.toUpperCase().replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </header>

      <KanbanBoard beads={filteredBeads} onBeadsChange={handleBeadsChange} />
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
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    gap: '16px',
    fontFamily: '"Share Tech Mono", monospace',
  },
  loadingPulse: {
    width: '40px',
    height: '40px',
    border: '2px solid var(--crt-phosphor-dim)',
    borderTopColor: 'var(--crt-phosphor)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorState: {
    padding: '24px',
    color: '#FF4444',
    textAlign: 'center',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  },
} satisfies Record<string, CSSProperties>;
