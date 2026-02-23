import { useMemo, type CSSProperties } from 'react';
import { useEpics } from '../../hooks/useEpics';
import type { EpicWithProgress } from '../../types/epics';
import { EpicCard } from './EpicCard';

export type EpicSortOption = 'ACTIVITY' | 'PROGRESS' | 'ID';

interface EpicsListProps {
  sortBy: EpicSortOption;
  /** Whether this tab is currently active */
  isActive?: boolean;
  /** Optional rig filter */
  rig?: string;
  /** Whether to apply overseer filtering */
  overseerView?: boolean;
  /** Callback when an epic is clicked */
  onEpicClick?: (epicId: string) => void;
}

/** Title patterns for overseer filtering - filter out operational/internal items */
const OVERSEER_EXCLUDED_PATTERNS = [
  'witness', 'wisp', 'internal', 'sync', 'coordination',
  'mail delivery', 'polecat', 'crew assignment', 'rig status',
  'heartbeat', 'health check', 'merge:',
];

function sortEpics(epics: EpicWithProgress[], sortBy: EpicSortOption): EpicWithProgress[] {
  return [...epics].sort((a, b) => {
    switch (sortBy) {
      case 'ACTIVITY': {
        const aTime = a.epic.updatedAt ? new Date(a.epic.updatedAt).getTime() : 0;
        const bTime = b.epic.updatedAt ? new Date(b.epic.updatedAt).getTime() : 0;
        return bTime - aTime;
      }
      case 'PROGRESS':
        if (a.progress !== b.progress) return a.progress - b.progress;
        // Secondary sort by activity
        const aTime = a.epic.updatedAt ? new Date(a.epic.updatedAt).getTime() : 0;
        const bTime = b.epic.updatedAt ? new Date(b.epic.updatedAt).getTime() : 0;
        return bTime - aTime;
      case 'ID':
        return a.epic.id.localeCompare(b.epic.id);
      default:
        return 0;
    }
  });
}

export function EpicsList({ sortBy, isActive = true, rig, overseerView = false, onEpicClick }: EpicsListProps) {
  const { openEpics, completedEpics, loading, error } = useEpics({ enabled: isActive, rig });

  // Apply overseer filtering if enabled
  const filteredOpen = useMemo(() => {
    if (!overseerView) return openEpics;
    return openEpics.filter((ewp) => {
      const titleLower = ewp.epic.title.toLowerCase();
      const idLower = ewp.epic.id.toLowerCase();
      // Exclude wisp beads
      if (idLower.includes('wisp') || titleLower.includes('wisp')) return false;
      // Exclude by title patterns
      if (OVERSEER_EXCLUDED_PATTERNS.some((p) => titleLower.includes(p))) return false;
      return true;
    });
  }, [openEpics, overseerView]);

  const filteredCompleted = useMemo(() => {
    if (!overseerView) return completedEpics;
    return completedEpics.filter((ewp) => {
      const titleLower = ewp.epic.title.toLowerCase();
      const idLower = ewp.epic.id.toLowerCase();
      // Exclude wisp beads
      if (idLower.includes('wisp') || titleLower.includes('wisp')) return false;
      // Exclude by title patterns
      if (OVERSEER_EXCLUDED_PATTERNS.some((p) => titleLower.includes(p))) return false;
      return true;
    });
  }, [completedEpics, overseerView]);

  const sortedOpen = useMemo(() => sortEpics(filteredOpen, sortBy), [filteredOpen, sortBy]);
  const sortedCompleted = useMemo(() => sortEpics(filteredCompleted, sortBy), [filteredCompleted, sortBy]);

  const isEmpty = sortedOpen.length === 0 && sortedCompleted.length === 0;

  if (loading && isEmpty) {
    return <div style={styles.state}>LOADING EPICS...</div>;
  }

  if (error) {
    return <div style={styles.error}>ERROR: {error}</div>;
  }

  if (isEmpty) {
    return <div style={styles.state}>NO EPICS</div>;
  }

  return (
    <div style={styles.container}>
      {/* Open Epics Section */}
      {sortedOpen.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>OPEN</span>
            <span style={styles.sectionCount}>{sortedOpen.length}</span>
          </div>
          <div style={styles.cardList}>
            {sortedOpen.map((epic) => (
              <EpicCard
                key={epic.epic.id}
                epic={epic}
                onClick={onEpicClick ? () => { onEpicClick(epic.epic.id); } : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed Epics Section */}
      {sortedCompleted.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>COMPLETE</span>
            <span style={styles.sectionCount}>{sortedCompleted.length}</span>
          </div>
          <div style={styles.cardList}>
            {sortedCompleted.map((epic) => (
              <EpicCard
                key={epic.epic.id}
                epic={epic}
                onClick={onEpicClick ? () => { onEpicClick(epic.epic.id); } : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    overflowY: 'auto',
    flex: 1,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 4px',
  },
  sectionTitle: {
    fontSize: '11px',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  },
  sectionCount: {
    fontSize: '11px',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    opacity: 0.6,
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
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
  },
} satisfies Record<string, CSSProperties>;
