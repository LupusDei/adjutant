/**
 * GraphControls - Overlay control panel for the dependency graph.
 * Provides epic filter dropdown, collapse/expand all, and fit view.
 * Pip-Boy styled with dark background and green borders.
 */
import React, { useCallback, type CSSProperties } from 'react';

import { useReactFlow } from '@xyflow/react';

/** Props for GraphControls. */
export interface GraphControlsProps {
  /** List of epic IDs for the filter dropdown. */
  epicIds: string[];
  /** Currently selected epic filter, or null for all. */
  epicFilter: string | null;
  /** Callback when epic filter changes. */
  onEpicFilterChange: (epicId: string | null) => void;
  /** Collapse all collapsible nodes. */
  onCollapseAll: () => void;
  /** Expand all collapsed nodes. */
  onExpandAll: () => void;
  /** Whether any nodes are currently collapsed. */
  hasCollapsedNodes: boolean;
}

/**
 * GraphControls renders an overlay panel in the top-right of the graph
 * with filtering and layout controls.
 */
function GraphControlsInner({
  epicIds,
  epicFilter,
  onEpicFilterChange,
  onCollapseAll,
  onExpandAll,
  hasCollapsedNodes,
}: GraphControlsProps) {
  const { fitView } = useReactFlow();

  const handleFitView = useCallback(() => {
    void fitView({ padding: 0.2, duration: 300 });
  }, [fitView]);

  const handleFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      onEpicFilterChange(value === '' ? null : value);
    },
    [onEpicFilterChange]
  );

  return (
    <div style={styles.container}>
      {/* Epic filter */}
      {epicIds.length > 0 && (
        <div style={styles.controlGroup}>
          <label style={styles.label}>EPIC:</label>
          <select
            value={epicFilter ?? ''}
            onChange={handleFilterChange}
            style={styles.select}
          >
            <option value="">ALL</option>
            {epicIds.map((id) => (
              <option key={id} value={id}>
                {id.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Collapse/Expand */}
      <button
        style={styles.button}
        onClick={hasCollapsedNodes ? onExpandAll : onCollapseAll}
        title={hasCollapsedNodes ? 'Expand all sub-trees' : 'Collapse all sub-trees'}
      >
        {hasCollapsedNodes ? 'EXPAND ALL' : 'COLLAPSE ALL'}
      </button>

      {/* Fit View */}
      <button
        style={styles.button}
        onClick={handleFitView}
        title="Fit graph to viewport"
      >
        FIT VIEW
      </button>
    </div>
  );
}

/** Memoized GraphControls. */
export const GraphControls = React.memo(GraphControlsInner);

const styles = {
  container: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    backgroundColor: '#0a0a0aee',
    border: '1px solid #00aa0066',
    borderRadius: '2px',
    boxShadow: '0 0 8px rgba(0, 170, 0, 0.1)',
    fontFamily: '"Share Tech Mono", monospace',
    zIndex: 10,
    minWidth: '120px',
  } satisfies CSSProperties,

  controlGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  } satisfies CSSProperties,

  label: {
    fontSize: '0.6rem',
    color: '#00aa00',
    letterSpacing: '0.1em',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,

  select: {
    flex: 1,
    backgroundColor: '#050505',
    color: '#00ff00',
    border: '1px solid #00aa0066',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.65rem',
    padding: '2px 4px',
    outline: 'none',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  } satisfies CSSProperties,

  button: {
    background: 'transparent',
    border: '1px solid #00aa0066',
    color: '#00aa00',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.6rem',
    padding: '4px 8px',
    cursor: 'pointer',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  } satisfies CSSProperties,
} as const;
