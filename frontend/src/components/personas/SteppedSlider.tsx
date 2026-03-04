/**
 * Retro segmented volume-meter slider for persona traits.
 *
 * 20 rectangular segments in a flex row. Filled segments show
 * green phosphor glow; empty segments show dim borders.
 * Click any segment to set value. Shows "12/20" readout.
 *
 * Design spec: adj-zkxv
 */
import { useCallback, type CSSProperties } from 'react';
import { TRAIT_MAX } from '../../types';

const SEGMENT_COUNT = TRAIT_MAX; // 20 segments

interface SteppedSliderProps {
  /** Current value (0-20). */
  value: number;
  /** Called when user clicks a segment. */
  onChange: (value: number) => void;
  /** Whether the slider is interactive. */
  disabled?: boolean;
}

export function SteppedSlider({ value, onChange, disabled = false }: SteppedSliderProps) {
  const handleClick = useCallback(
    (index: number) => {
      if (disabled) return;
      // Clicking the same segment that's the last filled toggles it off
      const newValue = index + 1 === value ? index : index + 1;
      onChange(Math.max(0, Math.min(SEGMENT_COUNT, newValue)));
    },
    [value, onChange, disabled]
  );

  const segments: React.ReactNode[] = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const filled = i < value;
    segments.push(
      <div
        key={i}
        role="slider"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={SEGMENT_COUNT}
        tabIndex={disabled ? -1 : 0}
        style={{
          ...styles.segment,
          ...(filled ? styles.segmentFilled : styles.segmentEmpty),
          ...(disabled ? styles.segmentDisabled : {}),
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        onClick={() => { handleClick(i); }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(Math.min(SEGMENT_COUNT, value + 1));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(Math.max(0, value - 1));
          }
        }}
      />
    );
  }

  const displayValue = String(value).padStart(2, '0');

  return (
    <div style={styles.container}>
      <div style={styles.track}>{segments}</div>
      <span style={{
        ...styles.readout,
        color: value === 0 ? 'var(--crt-phosphor-dim)' : 'var(--crt-phosphor)',
      }}>
        {displayValue}/{SEGMENT_COUNT}
      </span>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    minWidth: 0,
  },

  track: {
    display: 'flex',
    gap: '1px',
    flex: 1,
    minWidth: 0,
  },

  segment: {
    width: '100%',
    maxWidth: '14px',
    minWidth: '4px',
    height: '16px',
    flex: '1 1 0%',
    transition: 'all 0.1s ease',
  },

  segmentFilled: {
    background: 'var(--crt-phosphor)',
    boxShadow: '0 0 4px var(--crt-phosphor-glow)',
  },

  segmentEmpty: {
    background: 'transparent',
    border: '1px solid var(--crt-phosphor-dim)',
    boxSizing: 'border-box',
  },

  segmentDisabled: {
    opacity: 0.4,
  },

  readout: {
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    letterSpacing: '0.05em',
    fontWeight: 'bold',
    flexShrink: 0,
    width: '40px',
    textAlign: 'right',
  },
} satisfies Record<string, CSSProperties>;
