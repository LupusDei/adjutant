/**
 * BeadRow — a memoized table row in BeadsList.
 *
 * adj-139.4.7: Extracted from BeadsList to lift inline style objects out
 * of the render-hot path and add React.memo so unchanged rows don't
 * re-render on every 30s poll.
 *
 * adj-139.4.5: This row is also designed to plug into <TableVirtuoso>
 * which calls `itemContent(index, item)` with a fixed item type per row.
 */

import { memo, type CSSProperties, type ReactNode } from 'react';

import { fuzzyMatch } from '../../hooks/useFuzzySearch';
import { AgentAssignDropdown } from '../shared/AgentAssignDropdown';
import type { BeadInfo } from '../../types';

// ---------------------------------------------------------------------------
// Pure helpers (no React state) — hoisted to module scope so re-imports
// share a single allocation across every row instance.
// ---------------------------------------------------------------------------

export type ActionType = 'sling' | 'delete';

export interface BeadActionState {
  /** Action currently running (e.g. user pressed SLING and request is in-flight) */
  actionInProgress?: { type: ActionType } | null;
  /** Last action result (shows ✓/✗ for ~2 seconds after completion) */
  actionResult?: { type: ActionType; success: boolean } | null;
}

export interface BeadRowProps {
  bead: BeadInfo;
  /** Current cost, if known — pass `null` to render an empty cost cell */
  cost: number | null;
  /** Fuzzy-search query for inline highlighting (empty = no highlight) */
  highlightQuery: string;
  /** Whether the action dropdown for this row is open */
  isMenuOpen: boolean;
  /** Local action state for this row */
  actionState?: BeadActionState;
  /** Optional inline assign callback — when present, ASSIGNEE cell becomes a dropdown */
  onAssign?: (beadId: string, agentName: string) => void;
  /** Optional menu toggle callback */
  onToggleMenu?: (beadId: string) => void;
  /** Optional action handler */
  onAction?: (bead: BeadInfo, action: ActionType) => void;
  /** Optional ref attached to the action menu div when isMenuOpen is true (used for click-outside) */
  menuRef?: ((node: HTMLDivElement | null) => void) | React.RefObject<HTMLDivElement>;
}

function getPriorityInfo(priority: number): { label: string; color: string } {
  switch (priority) {
    case 0: return { label: 'P0', color: '#FF4444' };
    case 1: return { label: 'P1', color: '#FFB000' };
    case 2: return { label: 'P2', color: 'var(--crt-phosphor)' };
    case 3: return { label: 'P3', color: 'var(--crt-phosphor-dim)' };
    case 4: return { label: 'P4', color: '#666666' };
    default: return { label: `P${priority}`, color: 'var(--crt-phosphor-dim)' };
  }
}

function getStatusInfo(status: string): { label: string; color: string; bgColor?: string } {
  const normalized = status.toLowerCase() === 'hooked' ? 'in_progress' : status.toLowerCase();
  switch (normalized) {
    case 'open':
      return { label: 'OPEN', color: 'var(--crt-phosphor)' };
    case 'hooked':
      return { label: 'HOOKED', color: '#00FFFF', bgColor: 'rgba(0, 255, 255, 0.1)' };
    case 'in_progress':
      return { label: 'ACTIVE', color: '#00FF88', bgColor: 'rgba(0, 255, 136, 0.1)' };
    case 'closed':
      return { label: 'DONE', color: '#555555' };
    default:
      return { label: status.toUpperCase(), color: 'var(--crt-phosphor-dim)' };
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  if (diffDays < 7) return `${diffDays}D AGO`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatAssignee(assignee: string | null): string {
  if (!assignee) return '-';
  const parts = assignee.split('/');
  return parts[parts.length - 1] ?? assignee;
}

function formatBeadCost(cost: number): string {
  if (cost < 0.01 && cost > 0) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function highlightMatches(text: string, query: string): ReactNode {
  if (!query) return text;
  const result = fuzzyMatch(query, text);
  if (!result.matches || result.matchIndices.length === 0) return text;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  const matchSet = new Set(result.matchIndices);
  for (let i = 0; i < text.length; i++) {
    if (matchSet.has(i)) {
      if (i > lastIndex) parts.push(text.slice(lastIndex, i));
      parts.push(<span key={i} style={highlightStyle}>{text[i]}</span>);
      lastIndex = i + 1;
    }
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

// ---------------------------------------------------------------------------
// Module-scoped style objects — allocated once at import time
// ---------------------------------------------------------------------------

const highlightStyle: CSSProperties = {
  backgroundColor: 'rgba(0, 255, 0, 0.3)',
  color: 'var(--crt-phosphor-bright)',
  fontWeight: 'bold',
};

const rowStyle: CSSProperties = {
  borderBottom: '1px solid #222',
  transition: 'background-color 0.1s ease',
};

/** Pre-computed row variant for closed beads (opacity 0.5). */
const rowStyleClosed: CSSProperties = {
  ...rowStyle,
  opacity: 0.5,
};

const cellStyle: CSSProperties = {
  padding: '8px 6px',
  color: 'var(--crt-phosphor)',
  whiteSpace: 'nowrap',
};

const activeAssigneeStyle: CSSProperties = {
  ...cellStyle,
  color: 'var(--crt-phosphor-bright)',
  fontWeight: 'bold',
  textShadow: '0 0 4px var(--crt-phosphor-glow)',
};

const idCellStyle: CSSProperties = {
  padding: '8px 6px',
  color: 'var(--crt-phosphor-bright)',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
};

const typeCellStyle: CSSProperties = {
  padding: '8px 6px',
  color: 'var(--crt-phosphor-dim)',
  fontSize: '0.7rem',
  whiteSpace: 'nowrap',
};

const titleCellStyle: CSSProperties = {
  padding: '8px 6px',
  color: 'var(--crt-phosphor)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const costCellStyle: CSSProperties = {
  padding: '8px 6px',
  color: 'var(--crt-phosphor)',
  fontSize: '0.75rem',
  whiteSpace: 'nowrap',
  fontWeight: 'bold',
};

const dateCellStyle: CSSProperties = {
  padding: '8px 6px',
  color: 'var(--crt-phosphor-dim)',
  fontSize: '0.7rem',
  whiteSpace: 'nowrap',
};

const actionCellStyle: CSSProperties = {
  padding: '4px 6px',
  textAlign: 'center',
  position: 'relative',
};

const actionMenuStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

const actionButtonStyle: CSSProperties = {
  backgroundColor: 'transparent',
  color: 'var(--crt-phosphor)',
  border: '1px solid var(--crt-phosphor-dim)',
  fontFamily: '"Share Tech Mono", monospace',
  fontSize: '0.9rem',
  padding: '2px 8px',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  lineHeight: 1,
};

const actionLoadingStyle: CSSProperties = {
  color: 'var(--crt-phosphor-dim)',
  fontSize: '0.8rem',
};

const actionResultBaseStyle: CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 'bold',
};

const actionResultSuccessStyle: CSSProperties = {
  ...actionResultBaseStyle,
  color: 'var(--crt-phosphor-bright)',
};

const actionResultFailStyle: CSSProperties = {
  ...actionResultBaseStyle,
  color: '#FF4444',
};

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '100%',
  marginTop: '2px',
  backgroundColor: 'var(--theme-bg-elevated)',
  border: '1px solid var(--crt-phosphor-dim)',
  borderRadius: '2px',
  zIndex: 100,
  minWidth: '70px',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
};

const dropdownItemStyle: CSSProperties = {
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
};

const dropdownItemDeleteStyle: CSSProperties = {
  ...dropdownItemStyle,
  color: '#FF6B35',
  borderTop: '1px solid #333',
};

/**
 * Cache for per-status row styles. Each status value gets one stable style
 * object across the entire app lifetime, avoiding allocations on every render.
 */
const rowStyleByStatus = new Map<string, CSSProperties>();

function getRowStyle(statusKey: string, isClosed: boolean, bgColor: string | undefined): CSSProperties {
  const cacheKey = `${statusKey}|${isClosed ? 'c' : 'o'}|${bgColor ?? ''}`;
  const cached = rowStyleByStatus.get(cacheKey);
  if (cached) return cached;
  const style: CSSProperties = {
    ...(isClosed ? rowStyleClosed : rowStyle),
    backgroundColor: bgColor ?? 'transparent',
  };
  rowStyleByStatus.set(cacheKey, style);
  return style;
}

/**
 * Cache for per-color cell styles (priority + status text colors).
 */
const cellStyleByColor = new Map<string, CSSProperties>();
function getCellStyle(color: string, fontWeight?: 'bold' | 'normal'): CSSProperties {
  const cacheKey = `${color}|${fontWeight ?? 'n'}`;
  const cached = cellStyleByColor.get(cacheKey);
  if (cached) return cached;
  const style: CSSProperties = {
    ...cellStyle,
    color,
    ...(fontWeight ? { fontWeight } : {}),
  };
  cellStyleByColor.set(cacheKey, style);
  return style;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render just the <td> cells of a bead row, with no surrounding <tr>.
 *
 * Used by TableVirtuoso (which wraps its own <tr>) and by BeadRow (which
 * wraps with its own styled <tr>). Keeps cell content DRY across both
 * code paths.
 */
function BeadRowCellsImpl({
  bead,
  cost,
  highlightQuery,
  isMenuOpen,
  actionState,
  onAssign,
  onToggleMenu,
  onAction,
  menuRef,
}: BeadRowProps) {
  const priorityInfo = getPriorityInfo(bead.priority);
  const statusInfo = getStatusInfo(bead.status);
  const isClosed = bead.status.toLowerCase() === 'closed';
  const isActiveWork = bead.status.toLowerCase() === 'hooked' || bead.status.toLowerCase() === 'in_progress';

  const canSling = !isClosed && !bead.assignee;
  const canDelete = !isClosed;
  const hasActions = canSling || canDelete;

  const currentAction = actionState?.actionInProgress ?? null;
  const result = actionState?.actionResult ?? null;

  const priorityCellStyle = getCellStyle(priorityInfo.color);
  const statusCellStyle = getCellStyle(statusInfo.color, statusInfo.bgColor ? 'bold' : 'normal');
  const assigneeCellStyle = isActiveWork && bead.assignee ? activeAssigneeStyle : cellStyle;

  return (
    <>
      <td style={idCellStyle}>{highlightMatches(bead.id, highlightQuery)}</td>
      <td style={priorityCellStyle}>{priorityInfo.label}</td>
      <td style={typeCellStyle}>{bead.type.toUpperCase()}</td>
      <td style={titleCellStyle} title={bead.title}>
        {highlightMatches(bead.title, highlightQuery)}
      </td>
      <td style={statusCellStyle}>{statusInfo.label}</td>
      <td
        style={assigneeCellStyle}
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
      <td style={costCellStyle}>
        {cost != null ? formatBeadCost(cost) : ''}
      </td>
      <td style={dateCellStyle}>
        {formatDate(bead.updatedAt ?? bead.createdAt)}
      </td>
      <td style={actionCellStyle}>
        {hasActions && (
          <div
            style={actionMenuStyle}
            ref={isMenuOpen ? menuRef : undefined}
          >
            {currentAction ? (
              <span style={actionLoadingStyle}>...</span>
            ) : result ? (
              <span style={result.success ? actionResultSuccessStyle : actionResultFailStyle}>
                {result.success ? '✓' : '✗'}
              </span>
            ) : (
              <button
                style={actionButtonStyle}
                onClick={() => { onToggleMenu?.(bead.id); }}
                title="Actions"
              >
                {'⋮'}
              </button>
            )}

            {isMenuOpen && (
              <div style={dropdownStyle}>
                {canSling && (
                  <button
                    style={dropdownItemStyle}
                    onClick={() => { onAction?.(bead, 'sling'); }}
                  >
                    SLING
                  </button>
                )}
                {canDelete && (
                  <button
                    style={dropdownItemDeleteStyle}
                    onClick={() => { onAction?.(bead, 'delete'); }}
                  >
                    DELETE
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </td>
    </>
  );
}

/**
 * <tr>-wrapping bead row. Used in the plain-table render path.
 */
function BeadRowImpl(props: BeadRowProps) {
  const statusInfo = getStatusInfo(props.bead.status);
  const isClosed = props.bead.status.toLowerCase() === 'closed';
  const rowStyleFinal = getRowStyle(statusInfo.label, isClosed, statusInfo.bgColor);
  return (
    <tr style={rowStyleFinal}>
      <BeadRowCellsImpl {...props} />
    </tr>
  );
}

/**
 * adj-139.4.7: Memoize on the fields BeadRow renders. The 30s poll produces
 * new BeadInfo references every refresh; without this guard, every visible
 * row re-renders even when nothing changed.
 */
function arePropsEqual(prev: BeadRowProps, next: BeadRowProps): boolean {
  const a = prev.bead;
  const b = next.bead;
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.type === b.type &&
    a.assignee === b.assignee &&
    a.updatedAt === b.updatedAt &&
    a.createdAt === b.createdAt &&
    prev.cost === next.cost &&
    prev.highlightQuery === next.highlightQuery &&
    prev.isMenuOpen === next.isMenuOpen &&
    prev.actionState?.actionInProgress?.type === next.actionState?.actionInProgress?.type &&
    prev.actionState?.actionResult?.type === next.actionState?.actionResult?.type &&
    prev.actionState?.actionResult?.success === next.actionState?.actionResult?.success &&
    prev.onAssign === next.onAssign &&
    prev.onToggleMenu === next.onToggleMenu &&
    prev.onAction === next.onAction
  );
}

export const BeadRow = memo(BeadRowImpl, arePropsEqual);

/**
 * Cells-only variant exported for TableVirtuoso integration.
 * TableVirtuoso provides its own <tr> wrapper, so BeadRowCells returns
 * only the <td> children.
 */
export const BeadRowCells = memo(BeadRowCellsImpl, arePropsEqual);

// Re-export the shared status info for parents that need it (e.g. row grouping)
export { getStatusInfo, getPriorityInfo, formatBeadCost };
