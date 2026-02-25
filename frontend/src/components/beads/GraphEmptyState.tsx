/**
 * GraphEmptyState - Styled empty state for the dependency graph view.
 * Displayed when there are no beads to render in the graph.
 * Pip-Boy retro terminal theme with scanline/CRT styling.
 */
import React, { type CSSProperties } from 'react';

/**
 * GraphEmptyState renders a CRT-styled "no data" message
 * when the dependency graph has no beads to display.
 */
function GraphEmptyStateInner() {
  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {/* Decorative terminal border */}
        <div style={styles.borderTop}>
          {'// '}
          {'='.repeat(32)}
          {' //'}
        </div>

        {/* Main message */}
        <div style={styles.message}>
          NO DEPENDENCY DATA AVAILABLE
        </div>

        {/* Subtext hint */}
        <div style={styles.subtext}>
          {'>'} CREATE BEADS WITH DEPENDENCIES TO POPULATE GRAPH
        </div>

        {/* Decorative terminal border */}
        <div style={styles.borderBottom}>
          {'// '}
          {'='.repeat(32)}
          {' //'}
        </div>

        {/* Scanline overlay */}
        <div style={styles.scanlines} />
      </div>
    </div>
  );
}

/** Memoized GraphEmptyState. */
export const GraphEmptyState = React.memo(GraphEmptyStateInner);

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    backgroundColor: '#0a0a0a',
  } satisfies CSSProperties,

  inner: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '32px 40px',
    border: '1px solid #00550044',
    borderRadius: '2px',
    backgroundColor: '#0d0d0d',
    boxShadow: 'inset 0 0 30px rgba(0, 170, 0, 0.03)',
    overflow: 'hidden',
  } satisfies CSSProperties,

  borderTop: {
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.6rem',
    color: '#003300',
    letterSpacing: '0.05em',
    userSelect: 'none',
  } satisfies CSSProperties,

  message: {
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.9rem',
    color: '#00aa00',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    textShadow: '0 0 6px rgba(0, 170, 0, 0.3)',
  } satisfies CSSProperties,

  subtext: {
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.65rem',
    color: '#005500',
    letterSpacing: '0.08em',
  } satisfies CSSProperties,

  borderBottom: {
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.6rem',
    color: '#003300',
    letterSpacing: '0.05em',
    userSelect: 'none',
  } satisfies CSSProperties,

  scanlines: {
    position: 'absolute',
    inset: 0,
    background: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0, 0, 0, 0.06) 1px, rgba(0, 0, 0, 0.06) 2px)',
    pointerEvents: 'none',
  } satisfies CSSProperties,
} as const;
