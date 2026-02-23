import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { KanbanBoard } from './KanbanBoard';
import { BeadDetailView } from './BeadDetailView';
import { AgentAssignModal } from './AgentAssignModal';
import { OverseerToggle } from '../shared/OverseerToggle';
import { usePolling } from '../../hooks/usePolling';
import { fuzzyMatch } from '../../hooks/useFuzzySearch';
import { api } from '../../services/api';
import { useMode } from '../../contexts/ModeContext';
import type { BeadInfo } from '../../types';
import type { KanbanColumnId } from '../../types/kanban';

export interface BeadsViewProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

/** Rig options for filtering */
type RigFilter = string;

/** Sort options matching iOS app */
type BeadSort = 'lastUpdated' | 'priority' | 'createdDate' | 'alphabetical' | 'assignee';

const SORT_OPTIONS: { value: BeadSort; label: string }[] = [
  { value: 'lastUpdated', label: 'LAST UPDATED' },
  { value: 'priority', label: 'PRIORITY' },
  { value: 'createdDate', label: 'CREATED' },
  { value: 'alphabetical', label: 'A-Z' },
  { value: 'assignee', label: 'ASSIGNEE' },
];

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
  const { isGasTown } = useMode();
  const [searchInput, setSearchInput] = useState('');
  const [rigFilter, setRigFilter] = useState<RigFilter>(() => {
    return localStorage.getItem('beads-rig-filter') ?? (isGasTown ? 'TOWN' : 'ALL');
  });
  const [rigOptions, setRigOptions] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<BeadSort>(() => {
    return (localStorage.getItem('beads-sort') ?? 'priority') as BeadSort;
  });
  const [overseerView, setOverseerView] = useState(false);
  const [beads, setBeads] = useState<BeadInfo[]>([]);
  const [selectedBeadId, setSelectedBeadId] = useState<string | null>(null);

  // Fetch bead sources on mount for filter options
  useEffect(() => {
    void api.beads.sources().then((result) => {
      if (result.sources.length > 0) {
        const names = result.sources.map((s) => s.name).sort();
        setRigOptions(names);
      }
    }).catch(() => {
      // Silently ignore - dropdown will just show ALL/TOWN
    });
  }, []);

  // Convert UI rig filter to API parameter
  // ALL sends rig=all to fetch from all databases; specific names fetch per-project
  const apiRig = rigFilter === 'ALL' ? 'all' : rigFilter === 'TOWN' ? 'town' : rigFilter;

  // Fetch beads from API
  const {
    data: fetchedBeads,
    loading,
    error,
    refresh,
  } = usePolling<BeadInfo[]>(
    () => api.beads.list({ status: 'all', limit: 500, rig: apiRig }),
    { interval: 30000, enabled: isActive }
  );

  // Refetch when rig filter changes
  useEffect(() => {
    void refresh();
  }, [rigFilter, refresh]);

  // Update local beads state when fetch completes
  useEffect(() => {
    if (fetchedBeads) {
      setBeads(fetchedBeads);
    }
  }, [fetchedBeads]);

  // Persist rig filter to localStorage
  useEffect(() => {
    localStorage.setItem('beads-rig-filter', rigFilter);
  }, [rigFilter]);

  // Persist sort preference to localStorage
  useEffect(() => {
    localStorage.setItem('beads-sort', sortBy);
  }, [sortBy]);

  // Filter beads based on search and overseer view
  // Note: Rig filtering is now done server-side via API parameter
  const filteredBeads = useMemo(() => {
    let result = beads;

    // Filter out excluded types
    result = result.filter((b) => !EXCLUDED_TYPES.includes(b.type.toLowerCase()));

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

    // Apply sorting
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'lastUpdated': {
          const dateA = new Date(a.updatedAt ?? a.createdAt).getTime();
          const dateB = new Date(b.updatedAt ?? b.createdAt).getTime();
          return dateB - dateA; // Most recent first
        }
        case 'priority': {
          if (a.priority !== b.priority) {
            return a.priority - b.priority; // Lower number = higher priority
          }
          // Tie-break by last updated
          const dateA = new Date(a.updatedAt ?? a.createdAt).getTime();
          const dateB = new Date(b.updatedAt ?? b.createdAt).getTime();
          return dateB - dateA;
        }
        case 'createdDate': {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA; // Newest first
        }
        case 'alphabetical':
          return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        case 'assignee': {
          const assigneeA = a.assignee ?? '';
          const assigneeB = b.assignee ?? '';
          // Unassigned sorts last
          if (!assigneeA && assigneeB) return 1;
          if (assigneeA && !assigneeB) return -1;
          if (assigneeA !== assigneeB) {
            return assigneeA.localeCompare(assigneeB, undefined, { sensitivity: 'base' });
          }
          // Same assignee: sort by priority
          return a.priority - b.priority;
        }
        default:
          return 0;
      }
    });

    return result;
  }, [beads, overseerView, searchInput, sortBy]);

  const handleOverseerToggle = useCallback((enabled: boolean) => {
    setOverseerView(enabled);
  }, []);

  const handleBeadsChange = useCallback((updater: (prev: BeadInfo[]) => BeadInfo[]) => {
    setBeads(updater);
  }, []);

  const handleBeadClick = useCallback((bead: BeadInfo) => {
    setSelectedBeadId(bead.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedBeadId(null);
  }, []);

  // Drag-to-assign modal state
  const [pendingAssign, setPendingAssign] = useState<{ beadId: string; targetColumn: KanbanColumnId } | null>(null);
  const pendingResolveRef = useRef<((agentName: string | null) => void) | null>(null);

  const handleAssignRequest = useCallback(
    (beadId: string, targetColumn: KanbanColumnId): Promise<string | null> => {
      return new Promise((resolve) => {
        pendingResolveRef.current = resolve;
        setPendingAssign({ beadId, targetColumn });
      });
    },
    []
  );

  const handleAssignConfirm = useCallback((agentName: string) => {
    pendingResolveRef.current?.(agentName);
    pendingResolveRef.current = null;
    setPendingAssign(null);
  }, []);

  const handleAssignCancel = useCallback(() => {
    pendingResolveRef.current?.(null);
    pendingResolveRef.current = null;
    setPendingAssign(null);
  }, []);

  // Inline assign from KanbanCard dropdown
  const handleAssign = useCallback((beadId: string, assignee: string) => {
    void api.beads.update(beadId, { assignee }).then(() => {
      void refresh();
    });
  }, [refresh]);

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
        <h2 style={styles.title} className="crt-glow">
          {isGasTown ? 'WORK BOARD' : 'TASKS'}
        </h2>

        <div style={styles.controls}>
          {isGasTown && (
            <OverseerToggle
              storageKey="beads-overseer-view"
              onChange={handleOverseerToggle}
            />
          )}

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

          {/* Source Filter */}
          {(isGasTown || rigOptions.length > 0) && (
            <>
              <span style={styles.filterLabel}>{isGasTown ? 'RIG:' : 'SOURCE:'}</span>
              <select
                value={rigFilter}
                onChange={(e) => { setRigFilter(e.target.value); }}
                style={styles.select}
              >
                <option value="ALL">{isGasTown ? 'ALL RIGS' : 'ALL'}</option>
                {isGasTown && <option value="TOWN">TOWN</option>}
                {rigOptions.map((rig) => (
                  <option key={rig} value={rig}>
                    {rig.toUpperCase().replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </>
          )}

          {/* Sort Dropdown */}
          <span style={styles.filterLabel}>SORT:</span>
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value as BeadSort); }}
            style={styles.select}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <KanbanBoard
        beads={filteredBeads}
        onBeadsChange={handleBeadsChange}
        onBeadClick={handleBeadClick}
        onAssignRequest={handleAssignRequest}
        onAssign={handleAssign}
      />

      <BeadDetailView
        beadId={selectedBeadId}
        onClose={handleCloseDetail}
      />

      {pendingAssign && (
        <AgentAssignModal
          beadId={pendingAssign.beadId}
          onConfirm={handleAssignConfirm}
          onCancel={handleAssignCancel}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
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
