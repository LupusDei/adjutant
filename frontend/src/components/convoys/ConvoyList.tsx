import { useMemo, type CSSProperties } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../services/api';
import type { Convoy } from '../../types';
import { ConvoyCard } from './ConvoyCard';
import type { ConvoySortOption } from './ConvoysView';

interface ConvoyListProps {
  sortBy: ConvoySortOption;
}

export function ConvoyList({ sortBy }: ConvoyListProps) {
  const { data: convoys, loading, error } = usePolling<Convoy[]>(
    () => api.convoys.list(),
    { interval: 60000 }
  );

  const sortedConvoys = useMemo(() => {
    if (!convoys) return [];

    const decorated = convoys.map(c => {
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
    });

    return decorated.sort((a, b) => {
      switch (sortBy) {
        case 'ACTIVITY':
          // Newest first
          return b.lastActive - a.lastActive;
        case 'PRIORITY':
          // Urgent (low number) first
          if (a.maxPriority !== b.maxPriority) return a.maxPriority - b.maxPriority;
          return b.lastActive - a.lastActive; // Tie-break with activity
        case 'PROGRESS':
          // Least complete first
          if (a.progress !== b.progress) return a.progress - b.progress;
          return b.lastActive - a.lastActive; // Tie-break with activity
        case 'ID':
          return a.convoy.id.localeCompare(b.convoy.id);
        default:
          return 0;
      }
    }).map(d => d.convoy);
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
      {sortedConvoys.map(convoy => (
        <ConvoyCard key={convoy.id} convoy={convoy} />
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