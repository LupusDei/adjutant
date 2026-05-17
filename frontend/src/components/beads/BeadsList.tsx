import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { TableVirtuoso } from 'react-virtuoso';

import { usePolling } from '../../hooks/usePolling';
import { fuzzyMatch } from '../../hooks/useFuzzySearch';
import { api } from '../../services/api';
import { costApi, type BeadCostResult } from '../../services/api-costs';
import type { BeadInfo } from '../../types';
import { BeadRow, BeadRowCells, type ActionType, type BeadActionState } from './BeadRow';

/**
 * adj-139.4.5: Groups smaller than this threshold render as plain tables
 * (no virtual scroll viewport). Above this, switch to TableVirtuoso so the
 * Beads tab doesn't choke at 500+ rows per group.
 */
const VIRTUALIZE_THRESHOLD = 30;

/**
 * adj-139.4.5: Height of each per-group virtual scroll viewport. Big
 * enough to feel substantial; small enough that adjacent groups remain
 * accessible by page scroll.
 */
const VIRTUAL_GROUP_HEIGHT_PX = 600;

export type BeadsStatusFilter = 'default' | 'open' | 'hooked' | 'in_progress' | 'closed' | 'all';

export interface BeadsListProps {
  statusFilter: BeadsStatusFilter;
  isActive?: boolean;
  /** Search query for fuzzy filtering */
  searchQuery?: string;
  /** Filter to overseer-relevant beads only */
  overseerView?: boolean;
  /** Callback when an agent is assigned to a bead via inline dropdown */
  onAssign?: ((beadId: string, agentName: string) => void) | undefined;
}

/** Group of beads from a source database */
interface BeadGroup {
  source: string;
  displayName: string;
  beads: BeadInfo[];
}

/**
 * Groups beads by source database, maintaining sort order within each group.
 */
function groupBeadsBySource(beads: BeadInfo[]): BeadGroup[] {
  const groupMap = new Map<string, BeadInfo[]>();

  for (const bead of beads) {
    const source = bead.source;
    const existing = groupMap.get(source);
    if (existing) {
      existing.push(bead);
    } else {
      groupMap.set(source, [bead]);
    }
  }

  // Convert to array and sort: town first, then alphabetically
  const groups: BeadGroup[] = [];
  const sortedSources = Array.from(groupMap.keys()).sort((a, b) => {
    if (a === 'town') return -1;
    if (b === 'town') return 1;
    return a.localeCompare(b);
  });

  for (const source of sortedSources) {
    const sourceBeads = groupMap.get(source) ?? [];
    groups.push({
      source,
      displayName: source === 'town' ? 'TOWN (hq-*)' : (source ?? 'UNKNOWN').toUpperCase().replace(/_/g, ' '),
      beads: sourceBeads,
    });
  }

  return groups;
}

export function BeadsList({ statusFilter, isActive = true, searchQuery = '', overseerView = false, onAssign }: BeadsListProps) {
  const [actionInProgress, setActionInProgress] = useState<{ id: string; type: ActionType } | null>(null);
  const [actionResult, setActionResult] = useState<{ id: string; type: ActionType; success: boolean } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [beadCosts, setBeadCosts] = useState<Record<string, number>>({});

  const {
    data: beads,
    loading,
    error,
    refresh,
  } = usePolling<BeadInfo[]>(
    // Fetch from ALL beads databases (no project filter)
    () => api.beads.list({
      status: statusFilter,
      // Don't filter by type - show all beads (tasks, bugs, features, etc.)
      limit: 500,
    }),
    {
      interval: 30000,
      enabled: isActive,
    }
  );

  // Exclude message and epic types, then apply search query and overseer filter
  const searchedBeads = useMemo(() => {
    if (!beads) return [];

    // Base excluded types (always filtered out)
    // Note: "bug" and "task" are intentionally NOT excluded — they are actionable work items
    const EXCLUDED_TYPES = ['message', 'epic', 'agent'];

    // Additional type exclusions for overseer view (operational beads)
    const OVERSEER_EXCLUDED_TYPES = [
      'role',
      'witness',
      'wisp',
      'infrastructure',
      'coordination',
      'sync',
    ];

    // Sources to exclude in overseer view (internal/operational)
    const OVERSEER_EXCLUDED_SOURCES = [
      'witness',
      'wisp',
    ];

    // Title patterns that indicate operational beads
    const OVERSEER_EXCLUDED_TITLE_PATTERNS = [
      'witness',
      'wisp',
      'internal',
      'sync',
      'coordination',
      'heartbeat',
      'health check',
    ];

    let filteredBeads = beads.filter(
      (bead) => !EXCLUDED_TYPES.includes(bead.type.toLowerCase())
    );

    // Apply overseer filter: hide operational beads
    if (overseerView) {
      filteredBeads = filteredBeads.filter((bead) => {
        const typeLower = bead.type.toLowerCase();
        const sourceLower = bead.source.toLowerCase();
        const titleLower = bead.title.toLowerCase();
        const idLower = bead.id.toLowerCase();
        const assigneeLower = (bead.assignee ?? '').toLowerCase();
        const labelsLower = bead.labels.map(l => l.toLowerCase());

        // Exclude any bead with "wisp" anywhere in its data
        if (typeLower.includes('wisp')) return false;
        if (sourceLower.includes('wisp')) return false;
        if (titleLower.includes('wisp')) return false;
        if (idLower.includes('wisp')) return false;
        if (assigneeLower.includes('wisp')) return false;
        if (labelsLower.some(label => label.includes('wisp'))) return false;

        // Exclude operational types
        if (OVERSEER_EXCLUDED_TYPES.includes(typeLower)) return false;

        // Exclude beads from operational sources
        if (OVERSEER_EXCLUDED_SOURCES.some(src => sourceLower.includes(src))) return false;

        // Exclude beads with operational title patterns
        if (OVERSEER_EXCLUDED_TITLE_PATTERNS.some(pattern => titleLower.includes(pattern))) return false;

        // Exclude merge beads
        if (titleLower.startsWith('merge:')) return false;

        return true;
      });
    }

    if (!searchQuery.trim()) return filteredBeads;

    const query = searchQuery.toLowerCase().trim();
    return filteredBeads.filter((bead) => {
      // Check ID and title (always defined)
      if (fuzzyMatch(query, bead.id).matches) return true;
      if (fuzzyMatch(query, bead.title).matches) return true;
      // Check assignee (may be null)
      if (bead.assignee && fuzzyMatch(query, bead.assignee).matches) return true;
      return false;
    });
  }, [beads, searchQuery, overseerView]);

  // Group beads by source database
  const beadGroups = useMemo(() => {
    return groupBeadsBySource(searchedBeads);
  }, [searchedBeads]);

  // Query for highlighting
  const highlightQuery = searchQuery.trim();

  // Derive a stable key from the set of active bead IDs so cost-fetch
  // only re-fires when the actual set of active beads changes, not on
  // every 30s poll cycle that produces a new array reference (adj-6ksw).
  const activeBeadIds = useMemo(
    () =>
      (searchedBeads ?? [])
        .filter((b) => b.status.toLowerCase() === 'in_progress' || b.status.toLowerCase() === 'hooked')
        .map((b) => b.id)
        .sort()
        .join(','),
    [searchedBeads]
  );

  // Fetch costs for in-progress beads (non-closed, non-open to limit API calls)
  useEffect(() => {
    if (!activeBeadIds) return;

    const ids = activeBeadIds.split(',');
    let cancelled = false;
    const fetchCosts = async () => {
      const results: Record<string, number> = {};
      // Fetch in parallel, limiting to first 20 to avoid excessive requests
      const fetches = ids.slice(0, 20).map(async (id) => {
        try {
          const result: BeadCostResult = await costApi.fetchBeadCost(id);
          if (!cancelled && result.totalCost > 0) {
            results[id] = result.totalCost;
          }
        } catch {
          // Cost fetch failures are non-fatal
        }
      });
      await Promise.all(fetches);
      if (!cancelled) {
        // Replace state entirely instead of merging to avoid accumulating
        // stale entries for beads no longer in the active set (adj-scrr).
        setBeadCosts(results);
      }
    };

    void fetchCosts();
    return () => { cancelled = true; };
  }, [activeBeadIds]);

  // Refetch when status filter changes
  useEffect(() => {
    void refresh();
  }, [statusFilter, refresh]);

  const toggleGroup = useCallback((source: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, [openMenuId]);

  const handleAction = useCallback(async (bead: BeadInfo, action: ActionType) => {
    setOpenMenuId(null);
    setActionInProgress({ id: bead.id, type: action });
    setActionResult(null);

    try {
      if (action === 'sling') {
        await api.messages.send({
          to: 'user',
          body: `Sling request: ${bead.id}\n\nPlease assign this bead to an agent:\n\nID: ${bead.id}\nTitle: ${bead.title}\nType: ${bead.type}\nPriority: P${bead.priority}`,
        });
      } else {
        await api.messages.send({
          to: 'user',
          body: `Delete request: ${bead.id}\n\nRequest to delete this bead:\n\nID: ${bead.id}\nTitle: ${bead.title}\nType: ${bead.type}\n\nIf deletion is not appropriate, please close with a note.`,
        });
      }
      setActionResult({ id: bead.id, type: action, success: true });
      setTimeout(() => { setActionResult(null); }, 2000);
    } catch {
      setActionResult({ id: bead.id, type: action, success: false });
      setTimeout(() => { setActionResult(null); }, 3000);
    } finally {
      setActionInProgress(null);
    }
  }, []);

  // Stable callbacks passed to memoized BeadRow children
  const handleToggleMenu = useCallback((beadId: string) => {
    setOpenMenuId((prev) => (prev === beadId ? null : beadId));
  }, []);

  const handleRowAction = useCallback((bead: BeadInfo, action: ActionType) => {
    void handleAction(bead, action);
  }, [handleAction]);

  // adj-139.4.5: Build the action-state for a single bead row.
  const buildActionState = useCallback((beadId: string): BeadActionState | undefined => {
    const isThisInProgress = actionInProgress?.id === beadId;
    const isThisResult = actionResult?.id === beadId;
    if (!isThisInProgress && !isThisResult) return undefined;
    const state: BeadActionState = {};
    if (isThisInProgress && actionInProgress) {
      state.actionInProgress = { type: actionInProgress.type };
    }
    if (isThisResult && actionResult) {
      state.actionResult = {
        type: actionResult.type,
        success: actionResult.success,
      };
    }
    return state;
  }, [actionInProgress, actionResult]);

  // adj-139.4.5: Render the column header row. Used in both the plain
  // table and the TableVirtuoso `fixedHeaderContent` slot.
  const renderHeaderRow = useCallback((): ReactNode => (
    <tr style={styles.headerRow}>
      <th style={thIdStyle}>ID</th>
      <th style={thPriStyle}>PRI</th>
      <th style={thTypeStyle}>TYPE</th>
      <th style={styles.th}>TITLE</th>
      <th style={thStatusStyle}>STATUS</th>
      <th style={thAssigneeStyle}>ASSIGNEE</th>
      <th style={thCostStyle}>COST</th>
      <th style={thUpdatedStyle}>UPDATED</th>
      <th style={thActionStyle}>ACTION</th>
    </tr>
  ), []);

  // Plain table renderer for small groups
  const renderPlainGroup = useCallback((beads: BeadInfo[]) => (
    <table style={styles.table}>
      <thead>{renderHeaderRow()}</thead>
      <tbody>
        {beads.map((bead) => {
          const isMenuOpen = openMenuId === bead.id;
          return (
            <BeadRow
              key={bead.id}
              bead={bead}
              cost={beadCosts[bead.id] ?? null}
              highlightQuery={highlightQuery}
              isMenuOpen={isMenuOpen}
              actionState={buildActionState(bead.id)}
              onAssign={onAssign}
              onToggleMenu={handleToggleMenu}
              onAction={handleRowAction}
              menuRef={isMenuOpen ? menuRef : undefined}
            />
          );
        })}
      </tbody>
    </table>
  ), [openMenuId, beadCosts, highlightQuery, buildActionState, onAssign, handleToggleMenu, handleRowAction, renderHeaderRow]);

  // TableVirtuoso renderer for large groups.
  // Important: TableVirtuoso owns the scroll container — we constrain its
  // height so it doesn't try to consume the entire page.
  const renderVirtualGroup = useCallback((beads: BeadInfo[]) => (
    <TableVirtuoso
      data={beads}
      style={virtualTableStyle}
      computeItemKey={(_index, bead) => bead.id}
      fixedHeaderContent={renderHeaderRow}
      itemContent={(_index, bead) => {
        const isMenuOpen = openMenuId === bead.id;
        return (
          <BeadRowCells
            bead={bead}
            cost={beadCosts[bead.id] ?? null}
            highlightQuery={highlightQuery}
            isMenuOpen={isMenuOpen}
            actionState={buildActionState(bead.id)}
            onAssign={onAssign}
            onToggleMenu={handleToggleMenu}
            onAction={handleRowAction}
            menuRef={isMenuOpen ? menuRef : undefined}
          />
        );
      }}
    />
  ), [openMenuId, beadCosts, highlightQuery, buildActionState, onAssign, handleToggleMenu, handleRowAction, renderHeaderRow]);

  if (loading && !beads) {
    return (
      <div style={styles.loadingState}>
        <div style={styles.loadingPulse} />
        SCANNING BEADS DATABASE...
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorState}>
        SCAN FAILED: {error.message}
      </div>
    );
  }

  if (!beads || beads.length === 0) {
    return (
      <div style={styles.emptyState}>
        NO BEADS FOUND
      </div>
    );
  }

  if (searchedBeads.length === 0 && highlightQuery) {
    return (
      <div style={styles.emptyState}>
        NO MATCHES FOR "{highlightQuery.toUpperCase()}"
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {beadGroups.map((group) => {
        const isCollapsed = collapsedGroups.has(group.source);

        return (
          <div key={group.source} style={styles.group}>
            {/* Group Header */}
            <button
              style={styles.groupHeader}
              onClick={() => { toggleGroup(group.source); }}
              aria-expanded={!isCollapsed}
            >
              <span style={styles.groupChevron}>
                {isCollapsed ? '▶' : '▼'}
              </span>
              <span style={styles.groupName}>{group.displayName}</span>
              <span style={styles.groupCount}>[{group.beads.length}]</span>
            </button>

            {/* Group Content — virtualize when many rows */}
            {!isCollapsed && (
              group.beads.length > VIRTUALIZE_THRESHOLD
                ? renderVirtualGroup(group.beads)
                : renderPlainGroup(group.beads)
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
    width: '100%',
  },
  group: {
    marginBottom: '12px',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 12px',
    backgroundColor: 'var(--theme-bg-elevated)',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.85rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.1em',
    textAlign: 'left',
    transition: 'background-color 0.15s ease',
  },
  groupChevron: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    width: '12px',
  },
  groupName: {
    flex: 1,
    fontWeight: 'bold',
  },
  groupCount: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
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
  emptyState: {
    padding: '48px',
    color: 'var(--crt-phosphor-dim)',
    textAlign: 'center',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  },
  table: {
    width: '100%',
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    marginTop: '4px',
  },
  headerRow: {
    borderBottom: '1px solid var(--crt-phosphor-dim)',
  },
  th: {
    textAlign: 'left',
    padding: '8px 6px',
    color: 'var(--crt-phosphor-dim)',
    fontWeight: 'normal',
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    whiteSpace: 'nowrap',
  },
} satisfies Record<string, CSSProperties>;

// adj-139.4.5: Per-column th styles hoisted out of the JSX hot path so
// each render reuses the same object reference. Width column values come
// from the original inline {...styles.th, width: 'Xpx'} spreads.
const thIdStyle: CSSProperties = { ...styles.th, width: '80px' };
const thPriStyle: CSSProperties = { ...styles.th, width: '40px' };
const thTypeStyle: CSSProperties = { ...styles.th, width: '60px' };
const thStatusStyle: CSSProperties = { ...styles.th, width: '70px' };
const thAssigneeStyle: CSSProperties = { ...styles.th, width: '80px' };
const thCostStyle: CSSProperties = { ...styles.th, width: '60px' };
const thUpdatedStyle: CSSProperties = { ...styles.th, width: '70px' };
const thActionStyle: CSSProperties = { ...styles.th, width: '60px' };

// adj-139.4.5: TableVirtuoso outer style — fixed height so the virtual
// scroll viewport doesn't try to consume the full page.
const virtualTableStyle: CSSProperties = {
  height: VIRTUAL_GROUP_HEIGHT_PX,
  width: '100%',
};
