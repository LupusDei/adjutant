import type { CSSProperties } from 'react';

/**
 * Props for the RigBadge component.
 */
export interface RigBadgeProps {
  /** The rig name or address to extract rig from */
  rig: string | null;
  /** Size variant */
  size?: 'small' | 'medium';
  /** Optional CSS class name */
  className?: string;
}

/**
 * Extract rig name from an address like "gastown_boy/crew/carl" -> "gastown_boy"
 * or from a direct rig name.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function extractRigName(address: string | null): string | null {
  if (!address) return null;

  // If it's a simple name like "mayor/" with no rig, return null
  if (!address.includes('/') || address === 'mayor/' || address === 'deacon/') {
    return null;
  }

  // Extract first segment as rig name (e.g., "gastown_boy/crew/carl" -> "gastown_boy")
  const parts = address.split('/');
  const firstPart = parts[0];

  // Filter out non-rig prefixes
  if (!firstPart || firstPart === 'mayor' || firstPart === 'deacon') {
    return null;
  }

  return firstPart;
}

/**
 * Get abbreviated rig name for display.
 * "gastown_boy" -> "GT_BOY", "gastown" -> "GASTOWN"
 */
function getDisplayName(rig: string): string {
  // Special case abbreviations
  if (rig === 'gastown_boy') return 'GT_BOY';
  if (rig === 'greenplace') return 'GRNPLC';

  // Default: uppercase, truncate if too long
  const upper = rig.toUpperCase().replace(/_/g, '_');
  return upper.length > 10 ? upper.slice(0, 8) + '..' : upper;
}

/**
 * Get color for a rig (consistent hashing).
 * Each rig gets a distinct color within the Pip-Boy palette.
 */
function getRigColor(rig: string): { main: string; glow: string } {
  // Predefined colors for known rigs - using theme variables for consistency
  const colorMap: Record<string, { main: string; glow: string }> = {
    gastown: {
      main: 'var(--theme-bright)',
      glow: 'var(--theme-bloom)',
    },
    gastown_boy: {
      main: 'var(--theme-primary)',
      glow: 'var(--theme-bloom)',
    },
    greenplace: {
      main: 'var(--theme-bright)',
      glow: 'var(--theme-bloom)',
    },
    beads: {
      main: 'var(--theme-dim)',
      glow: 'var(--theme-bloom)',
    },
  };

  if (colorMap[rig]) {
    return colorMap[rig];
  }

  // Fallback: hash-based color selection for unknown rigs
  let hash = 0;
  for (let i = 0; i < rig.length; i++) {
    hash = rig.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Generate hue from hash (avoiding red zone)
  const hue = (Math.abs(hash) % 200) + 80; // 80-280 range (green to blue to purple)
  const main = `hsl(${hue}, 100%, 70%)`;
  const glow = `hsla(${hue}, 100%, 70%, 0.4)`;

  return { main, glow };
}

/**
 * Pip-Boy styled rig badge component.
 * Displays rig name in terminal-style brackets with color coding.
 */
export function RigBadge({ rig, size = 'small', className = '' }: RigBadgeProps) {
  const rigName = typeof rig === 'string' && !rig.includes('/')
    ? rig
    : extractRigName(rig);

  if (!rigName) {
    return null; // Don't render badge for town-level agents
  }

  const displayName = getDisplayName(rigName);
  const colors = getRigColor(rigName);
  const sizeStyles = size === 'small' ? styles.small : styles.medium;

  return (
    <span
      className={className}
      style={{
        ...styles.badge,
        ...sizeStyles,
        color: colors.main,
        textShadow: `0 0 4px ${colors.glow}`,
        borderColor: colors.main,
        boxShadow: `0 0 3px ${colors.glow}`,
      }}
      title={rigName}
    >
      [{displayName}]
    </span>
  );
}

const styles = {
  badge: {
    display: 'inline-block',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    border: '1px solid',
    borderRadius: '2px',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  small: {
    fontSize: '0.65rem',
    padding: '1px 4px',
  },
  medium: {
    fontSize: '0.75rem',
    padding: '2px 6px',
  },
} satisfies Record<string, CSSProperties>;

export default RigBadge;
