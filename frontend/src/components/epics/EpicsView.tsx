import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { OverseerToggle } from '../shared/OverseerToggle';
import { EpicsList, type EpicSortOption } from './EpicsList';
import { EpicDetailView } from './EpicDetailView';
import { api } from '../../services/api';

export interface EpicsViewProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

/** Project options for filtering */
type ProjectFilter = string;

export function EpicsView({ isActive = true }: EpicsViewProps) {
  const [sortBy, setSortBy] = useState<EpicSortOption>('ACTIVITY');
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const [overseerView, setOverseerView] = useState(false);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>(() => {
    return localStorage.getItem('epics-project-filter') ?? 'ALL';
  });
  const [projectOptions, setProjectOptions] = useState<string[]>([]);

  // Fetch bead sources on mount for filter options
  useEffect(() => {
    void api.beads.sources().then((result) => {
      if (result.sources.length > 0) {
        const names = result.sources.map((s) => s.name).sort();
        setProjectOptions(names);
      }
    }).catch(() => {
      // Silently ignore - dropdown will just show ALL
    });
  }, []);

  // Persist project filter to localStorage
  useEffect(() => {
    localStorage.setItem('epics-project-filter', projectFilter);
  }, [projectFilter]);

  const handleEpicClick = useCallback((epicId: string) => {
    setSelectedEpicId(epicId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedEpicId(null);
  }, []);

  const handleOverseerToggle = useCallback((enabled: boolean) => {
    setOverseerView(enabled);
  }, []);

  // Refresh trigger — incremented after assignment to refresh both list and detail
  const refreshTriggerRef = useRef(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleAssign = useCallback(() => {
    refreshTriggerRef.current += 1;
    setRefreshTrigger(refreshTriggerRef.current);
  }, []);

  // Convert UI project filter to API parameter
  const apiProject = projectFilter === 'ALL' ? undefined : projectFilter;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.titleSection}>
          <h2 style={styles.title} className="crt-glow">EPICS</h2>
          <span style={styles.subtitle}>PROJECT TRACKING</span>
        </div>

        <div style={styles.controls}>
          {/* Overseer Toggle */}
          <OverseerToggle
            storageKey="epics-overseer-view"
            onChange={handleOverseerToggle}
          />

          {/* Source Filter */}
          <span style={styles.filterLabel}>PROJECT:</span>
          <select
            value={projectFilter}
            onChange={(e) => { setProjectFilter(e.target.value); }}
            style={styles.select}
          >
            <option value="ALL">ALL PROJECTS</option>
            {projectOptions.map((proj) => (
              <option key={proj} value={proj}>
                {proj.toUpperCase().replace(/_/g, ' ')}
              </option>
            ))}
          </select>

          {/* Sort Control */}
          <span style={styles.filterLabel}>SORT:</span>
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value as EpicSortOption); }}
            style={styles.select}
          >
            <option value="ACTIVITY">LATEST ACTIVITY</option>
            <option value="PROGRESS">LEAST COMPLETE</option>
            <option value="ID">EPIC ID</option>
          </select>
        </div>
      </header>

      <EpicsList
        sortBy={sortBy}
        isActive={isActive}
        project={apiProject}
        overseerView={overseerView}
        onEpicClick={handleEpicClick}
        onAssign={handleAssign}
        refreshTrigger={refreshTrigger}
      />

      <EpicDetailView
        epicId={selectedEpicId}
        onClose={handleCloseDetail}
        onAssign={handleAssign}
        refreshTrigger={refreshTrigger}
      />
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#0A0A0A',
    border: '1px solid var(--crt-phosphor-dim)',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '10px',
  },
  titleSection: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '1.2rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.2em',
    fontFamily: '"Share Tech Mono", monospace',
  },
  subtitle: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    fontFamily: '"Share Tech Mono", monospace',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  filterLabel: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
  },
  select: {
    backgroundColor: '#050505',
    color: 'var(--crt-phosphor)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '4px 8px',
    outline: 'none',
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>;
