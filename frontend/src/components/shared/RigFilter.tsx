import { type CSSProperties, useEffect } from 'react';
import { useRigFilter } from '../../contexts/RigContext';

/**
 * Props for the RigFilter component.
 */
export interface RigFilterProps {
  /** Optional CSS class name */
  className?: string;
}

/**
 * Pip-Boy styled rig filter dropdown.
 * Allows filtering UI by selected rig. Defaults to "ALL RIGS".
 */
export function RigFilter({ className = '' }: RigFilterProps) {
  const { selectedRig, availableRigs, setSelectedRig } = useRigFilter();

  // Don't render if no rigs available
  if (availableRigs.length === 0) {
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedRig(value === '' ? null : value);
  };

  return (
    <div style={styles.container} className={className}>
      <label style={styles.label} htmlFor="rig-filter">
        RIG:
      </label>
      <div style={styles.selectWrapper}>
        <select
          id="rig-filter"
          value={selectedRig ?? ''}
          onChange={handleChange}
          style={styles.select}
        >
          <option value="">ALL RIGS</option>
          {availableRigs.map(rig => (
            <option key={rig} value={rig}>
              {rig.toUpperCase().replace(/_/g, '_')}
            </option>
          ))}
        </select>
        <span style={styles.selectArrow}>▼</span>
      </div>
    </div>
  );
}

/**
 * Hook to sync available rigs from status data.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useRigSync(rigs: { name: string }[] | undefined) {
  const { setAvailableRigs } = useRigFilter();

  useEffect(() => {
    if (rigs && rigs.length > 0) {
      const rigNames = rigs.map(r => r.name);
      setAvailableRigs(rigNames);
    }
  }, [rigs, setAvailableRigs]);
}

// Pip-Boy color palette
const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: '#050805',
  backgroundHover: '#0A1A0A',
} as const;

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  },
  label: {
    fontSize: '0.7rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: colors.primaryDim,
  },
  selectWrapper: {
    position: 'relative',
    display: 'inline-block',
  },
  select: {
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    backgroundColor: colors.background,
    border: `1px solid ${colors.primaryDim}`,
    color: colors.primary,
    padding: '4px 24px 4px 8px',
    fontSize: '0.7rem',
    fontFamily: 'inherit',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    outline: 'none',
    minWidth: '100px',
    // Hover/focus handled by CSS
  },
  selectArrow: {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
    fontSize: '0.6rem',
    color: colors.primaryDim,
  },
} satisfies Record<string, CSSProperties>;

export default RigFilter;
