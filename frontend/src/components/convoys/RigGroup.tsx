import { useState, type CSSProperties, type ReactNode } from 'react';

interface RigGroupProps {
  /** Rig name, or null for town-level convoys */
  rig: string | null;
  /** Number of convoys in this group */
  count: number;
  /** Child elements (convoy cards) */
  children: ReactNode;
  /** Whether the group should start expanded */
  defaultExpanded?: boolean;
}

export function RigGroup({ rig, count, children, defaultExpanded = true }: RigGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const displayName = rig ? rig.toUpperCase() : 'TOWN-LEVEL';
  const icon = rig ? '>' : '~';

  return (
    <div style={styles.container}>
      <button
        style={styles.header}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span style={{
          ...styles.expandIcon,
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
        }}>
          {icon}
        </span>
        <span style={styles.rigName}>{displayName}</span>
        <span style={styles.count}>({count})</span>
        <span style={styles.divider} />
      </button>

      {isExpanded && (
        <div style={styles.content}>
          {children}
        </div>
      )}
    </div>
  );
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
} as const;

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 0',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    color: colors.primaryDim,
    letterSpacing: '0.15em',
    width: '100%',
    textAlign: 'left',
  },
  expandIcon: {
    fontSize: '0.7rem',
    color: colors.primary,
    transition: 'transform 0.2s ease',
    width: '12px',
    display: 'inline-block',
  },
  rigName: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  count: {
    color: colors.primaryDim,
    fontSize: '0.7rem',
  },
  divider: {
    flex: 1,
    height: '1px',
    background: `linear-gradient(to right, ${colors.primaryDim}, transparent)`,
    marginLeft: '8px',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingLeft: '20px',
  },
} satisfies Record<string, CSSProperties>;
