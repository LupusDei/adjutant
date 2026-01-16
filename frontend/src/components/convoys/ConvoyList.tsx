import { useMemo, type CSSProperties } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../services/api';
import type { Convoy } from '../../types';
import { ConvoyCard } from './ConvoyCard';
import { RigGroup } from './RigGroup';
import type { ConvoySortOption } from './ConvoysView';

interface ConvoyListProps {
  sortBy: ConvoySortOption;
  /** Whether this tab is currently active */
  isActive?: boolean;
}

interface DecoratedConvoy {
  convoy: Convoy;
  lastActive: number;
  maxPriority: number;
  progress: number;
}

interface RigGroupData {
  rig: string | null;
  convoys: Convoy[];
}

function decorateConvoy(c: Convoy): DecoratedConvoy {
  let lastActive = 0;
  let maxPriority = 4;

  c.trackedIssues.forEach(issue => {
    if (issue.updatedAt) {
      const d = new Date(issue.updatedAt).getTime();
      if (d > lastActive) lastActive = d;
    }
    if (issue.priority !== undefined && issue.priority < maxPriority) {
      maxPriority = issue.priority;
    }
  });

  const progress = c.progress.total > 0 ? c.progress.completed / c.progress.total : 1;

  return { convoy: c, lastActive, maxPriority, progress };
}

function sortConvoys(convoys: DecoratedConvoy[], sortBy: ConvoySortOption): Convoy[] {
  return [...convoys].sort((a, b) => {
    switch (sortBy) {
      case 'ACTIVITY':
        return b.lastActive - a.lastActive;
      case 'PRIORITY':
        if (a.maxPriority !== b.maxPriority) return a.maxPriority - b.maxPriority;
        return b.lastActive - a.lastActive;
      case 'PROGRESS':
        if (a.progress !== b.progress) return a.progress - b.progress;
        return b.lastActive - a.lastActive;
      case 'ID':
        return a.convoy.id.localeCompare(b.convoy.id);
      default:
        return 0;
    }
  }).map(d => d.convoy);
}

export function ConvoyList({ sortBy, isActive = true }: ConvoyListProps) {
  const { data: convoys, loading, error } = usePolling<Convoy[]>(
    () => api.convoys.list(),
    { interval: 60000, enabled: isActive }
  );

  const groupedConvoys = useMemo(() => {
    if (!convoys) return [];

    // Group convoys by rig
    const rigMap = new Map<string | null, DecoratedConvoy[]>();

    for (const convoy of convoys) {
      const decorated = decorateConvoy(convoy);
      const existing = rigMap.get(convoy.rig) ?? [];
      existing.push(decorated);
      rigMap.set(convoy.rig, existing);
    }

    // Build sorted groups
    const groups: RigGroupData[] = [];

    // Town-level (null rig) first
    if (rigMap.has(null)) {
      groups.push({
        rig: null,
        convoys: sortConvoys(rigMap.get(null)!, sortBy)
      });
    }

    // Then rigs alphabetically
    const rigNames = Array.from(rigMap.keys())
      .filter((rig): rig is string => rig !== null)
      .sort((a, b) => a.localeCompare(b));

    for (const rig of rigNames) {
      groups.push({
        rig,
        convoys: sortConvoys(rigMap.get(rig)!, sortBy)
      });
    }

    return groups;
  }, [convoys, sortBy]);

  if (loading && !convoys) {
    return <div style={styles.state}>LOADING CONVOY DATA...</div>;
  }

  if (error) {
    return <div style={styles.error}>ERROR: {error.message}</div>;
  }

  if (!convoys || convoys.length === 0) {
    return <div style={styles.state}>NO ACTIVE CONVOYS</div>;
  }

  return (
    <div style={styles.container}>
      {groupedConvoys.map(group => (
        <RigGroup
          key={group.rig ?? '__town__'}
          rig={group.rig}
          count={group.convoys.length}
        >
          {group.convoys.map(convoy => (
            <ConvoyCard key={convoy.id} convoy={convoy} />
          ))}
        </RigGroup>
      ))}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    overflowY: 'auto',
    flex: 1,
  },
  state: {
    padding: '48px',
    textAlign: 'center',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  },
  error: {
    padding: '48px',
    textAlign: 'center',
    color: '#FF4444',
    fontFamily: '"Share Tech Mono", monospace',
  }
} satisfies Record<string, CSSProperties>;