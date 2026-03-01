import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { fuzzyMatch } from '../../hooks/useFuzzySearch';
import { api } from '../../services/api';
import { AgentAssignDropdown } from '../shared/AgentAssignDropdown';
import type { BeadInfo } from '../../types';

export type BeadsStatusFilter = 'default' | 'open' | 'hooked' | 'in_progress' | 'closed' | 'all';

type ActionType = 'sling' | 'delete';

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
 * Gets priority label and color.
 */
function getPriorityInfo(priority: number): { label: string; color: string } {
  switch (priority) {
    case 0:
      return { label: 'P0', color: '#FF4444' }; // Critical
    case 1:
      return { label: 'P1', color: '#FFB000' }; // High
    case 2:
      return { label: 'P2', color: 'var(--crt-phosphor)' }; // Normal
    case 3:
      return { label: 'P3', color: 'var(--crt-phosphor-dim)' }; // Low
    case 4:
      return { label: 'P4', color: '#666666' }; // Backlog
    default:
      return { label: `P${priority}`, color: 'var(--crt-phosphor-dim)' };
  }
}

/**
 * Gets status display info with distinct colors for each state.
 * Valid statuses: open, hooked, in_progress, closed
 * Hooked is displayed as ACTIVE (same as in_progress).
 */
function getStatusInfo(status: string): { label: string; color: string; bgColor?: string } {
  const normalized = status.toLowerCase() === 'hooked' ? 'in_progress' : status.toLowerCase();
  switch (normalized) {
    case 'open':
      return { label: 'OPEN', color: 'var(--crt-phosphor)' };
    case 'hooked':
      return { label: 'HOOKED', color: '#00FFFF', bgColor: 'rgba(0, 255, 255, 0.1)' }; // Cyan
    case 'in_progress':
      return { label: 'ACTIVE', color: '#00FF88', bgColor: 'rgba(0, 255, 136, 0.1)' }; // Bright cyan-green
    case 'closed':
      return { label: 'DONE', color: '#555555' }; // Dark gray
    default:
      return { label: status.toUpperCase(), color: 'var(--crt-phosphor-dim)' };
  }
}

/**
 * Formats a timestamp for display.
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'TODAY';
  } else if (diffDays === 1) {
    return 'YESTERDAY';
  } else if (diffDays < 7) {
    return `${diffDays}D AGO`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Extracts short assignee name.
 */
function formatAssignee(assignee: string | null): string {
  if (!assignee) return '-';
  // Extract name from path like "gastown_boy/dag" -> "dag"
  const parts = assignee.split('/');
  return parts[parts.length - 1] ?? assignee;
}

/**
 * Highlights matching characters in a string based on fuzzy match.
 */
function highlightMatches(text: string, query: string): ReactNode {
  if (!query) {
    return text;
  }

  const result = fuzzyMatch(query, text);
  if (!result.matches || result.matchIndices.length === 0) {
    return text;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  const matchSet = new Set(result.matchIndices);

  for (let i = 0; i < text.length; i++) {
    if (matchSet.has(i)) {
      // Add text before this match
      if (i > lastIndex) {
        parts.push(text.slice(lastIndex, i));
      }
      // Add highlighted character
      parts.push(
        <span key={i} style={highlightStyle}>
          {text[i]}
        </span>
      );
      lastIndex = i + 1;
    }
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

const highlightStyle: CSSProperties = {
  backgroundColor: 'rgba(0, 255, 0, 0.3)',
  color: 'var(--crt-phosphor-bright)',
  fontWeight: 'bold',
};

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

  const {
    data: beads,
    loading,
    error,
    refresh,
  } = usePolling<BeadInfo[]>(
    // Fetch from ALL beads databases (no rig filter)
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
    const EXCLUDED_TYPES = ['message', 'epic', 'convoy', 'agent'];

    // Additional type exclusions for overseer view (Gas Town operations)
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

    // Title patterns that indicate Gas Town operational beads
    const OVERSEER_EXCLUDED_TITLE_PATTERNS = [
      'witness',
      'wisp',
      'internal',
      'sync',
      'coordination',
      'mail delivery',
      'polecat',
      'crew assignment',
      'rig status',
      'heartbeat',
      'health check',
    ];

    let filteredBeads = beads.filter(
      (bead) => !EXCLUDED_TYPES.includes(bead.type.toLowerCase())
    );

    // Apply overseer filter: hide Gas Town operational beads
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

            {/* Group Content */}
            {!isCollapsed && (
              <table style={styles.table}>
                <thead>
                  <tr style={styles.headerRow}>
                    <th style={{ ...styles.th, width: '80px' }}>ID</th>
                    <th style={{ ...styles.th, width: '40px' }}>PRI</th>
                    <th style={{ ...styles.th, width: '60px' }}>TYPE</th>
                    <th style={styles.th}>TITLE</th>
                    <th style={{ ...styles.th, width: '70px' }}>STATUS</th>
                    <th style={{ ...styles.th, width: '80px' }}>ASSIGNEE</th>
                    <th style={{ ...styles.th, width: '70px' }}>UPDATED</th>
                    <th style={{ ...styles.th, width: '60px' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {group.beads.map((bead) => {
                    const priorityInfo = getPriorityInfo(bead.priority);
                    const statusInfo = getStatusInfo(bead.status);
                    const isClosed = bead.status.toLowerCase() === 'closed';
                    // Active work states where agent name should be prominently shown
                    const isActiveWork = ['hooked', 'in_progress'].includes(bead.status.toLowerCase());

                    const currentAction = actionInProgress?.id === bead.id ? actionInProgress : null;
                    const result = actionResult?.id === bead.id ? actionResult : null;
                    const canSling = !isClosed && !bead.assignee;
                    const canDelete = !isClosed; // Can request delete for any non-closed bead
                    const hasActions = canSling || canDelete;
                    const isMenuOpen = openMenuId === bead.id;

                    return (
                      <tr
                        key={bead.id}
                        style={{
                          ...styles.row,
                          opacity: isClosed ? 0.5 : 1,
                          backgroundColor: statusInfo.bgColor ?? 'transparent',
                        }}
                      >
                        <td style={styles.idCell}>
                          {highlightMatches(bead.id, highlightQuery)}
                        </td>
                        <td style={{ ...styles.cell, color: priorityInfo.color }}>
                          {priorityInfo.label}
                        </td>
                        <td style={styles.typeCell}>{bead.type.toUpperCase()}</td>
                        <td style={styles.titleCell} title={bead.title}>
                          {highlightMatches(bead.title, highlightQuery)}
                        </td>
                        <td style={{ ...styles.cell, color: statusInfo.color, fontWeight: statusInfo.bgColor ? 'bold' : 'normal' }}>
                          {statusInfo.label}
                        </td>
                        <td
                          style={{
                            ...styles.cell,
                            ...(isActiveWork && bead.assignee ? styles.activeAssigneeCell : {}),
                          }}
                          onClick={onAssign ? (e) => { e.stopPropagation(); } : undefined}
                        >
                          {onAssign ? (
                            <AgentAssignDropdown
                              beadId={bead.id}
                              currentAssignee={bead.assignee}
                              onAssign={(agent) => { onAssign(bead.id, agent); }}
                              compact
                              disabled={isClosed}
                            />
                          ) : (
                            highlightMatches(formatAssignee(bead.assignee), highlightQuery)
                          )}
                        </td>
                        <td style={styles.dateCell}>
                          {formatDate(bead.updatedAt ?? bead.createdAt)}
                        </td>
                        <td style={styles.actionCell}>
                          {hasActions && (
                            <div
                              style={styles.actionMenu}
                              ref={isMenuOpen ? menuRef : null}
                            >
                              {/* Show result feedback or menu trigger */}
                              {currentAction ? (
                                <span style={styles.actionLoading}>...</span>
                              ) : result ? (
                                <span style={{
                                  ...styles.actionResult,
                                  color: result.success ? 'var(--crt-phosphor-bright)' : '#FF4444',
                                }}>
                                  {result.success ? '✓' : '✗'}
                                </span>
                              ) : (
                                <button
                                  style={styles.actionButton}
                                  onClick={() => { setOpenMenuId(isMenuOpen ? null : bead.id); }}
                                  title="Actions"
                                >
                                  ⋮
                                </button>
                              )}

                              {/* Dropdown menu */}
                              {isMenuOpen && (
                                <div style={styles.dropdown}>
                                  {canSling && (
                                    <button
                                      style={styles.dropdownItem}
                                      onClick={() => { void handleAction(bead, 'sling'); }}
                                    >
                                      SLING
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      style={{
                                        ...styles.dropdownItem,
                                        ...styles.dropdownItemDelete,
                                      }}
                                      onClick={() => { void handleAction(bead, 'delete'); }}
                                    >
                                      DELETE
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
    backgroundColor: '#111',
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
  row: {
    borderBottom: '1px solid #222',
    transition: 'background-color 0.1s ease',
  },
  cell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor)',
    whiteSpace: 'nowrap',
  },
  activeAssigneeCell: {
    color: 'var(--crt-phosphor-bright)',
    fontWeight: 'bold',
    textShadow: '0 0 4px var(--crt-phosphor-glow)',
  },
  idCell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor-bright)',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  typeCell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.7rem',
    whiteSpace: 'nowrap',
  },
  titleCell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dateCell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.7rem',
    whiteSpace: 'nowrap',
  },
  actionCell: {
    padding: '4px 6px',
    textAlign: 'center',
    position: 'relative',
  },
  actionMenu: {
    position: 'relative',
    display: 'inline-block',
  },
  actionButton: {
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.9rem',
    padding: '2px 8px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    lineHeight: 1,
  },
  actionLoading: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.8rem',
  },
  actionResult: {
    fontSize: '0.8rem',
    fontWeight: 'bold',
  },
  dropdown: {
    position: 'absolute',
    right: 0,
    top: '100%',
    marginTop: '2px',
    backgroundColor: '#111',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
    zIndex: 100,
    minWidth: '70px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    padding: '6px 10px',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor)',
    border: 'none',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.7rem',
    letterSpacing: '0.05em',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background-color 0.1s ease',
  },
  dropdownItemDelete: {
    color: '#FF6B35',
    borderTop: '1px solid #333',
  },
} satisfies Record<string, CSSProperties>;
