import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import { OverseerToggle } from '../shared/OverseerToggle';
import { EpicsList, type EpicSortOption } from './EpicsList';
import { EpicDetailView } from './EpicDetailView';
import { api } from '../../services/api';
import { useMode } from '../../contexts/ModeContext';

export interface EpicsViewProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

/** Rig options for filtering */
type RigFilter = 'ALL' | string;

export function EpicsView({ isActive = true }: EpicsViewProps) {
  const { isGasTown } = useMode();
  const [sortBy, setSortBy] = useState<EpicSortOption>('ACTIVITY');
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const [overseerView, setOverseerView] = useState(false);
  const [rigFilter, setRigFilter] = useState<RigFilter>(() => {
    return localStorage.getItem('epics-rig-filter') ?? 'ALL';
  });
  const [rigOptions, setRigOptions] = useState<string[]>([]);

  // Fetch bead sources on mount for filter options
  useEffect(() => {
    void api.beads.sources().then((result) => {
      if (result.sources && result.sources.length > 0) {
        const names = result.sources.map((s) => s.name).sort();
        setRigOptions(names);
      }
    }).catch(() => {
      // Silently ignore - dropdown will just show ALL
    });
  }, []);

  // Persist rig filter to localStorage
  useEffect(() => {
    localStorage.setItem('epics-rig-filter', rigFilter);
  }, [rigFilter]);

  const handleEpicClick = useCallback((epicId: string) => {
    setSelectedEpicId(epicId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedEpicId(null);
  }, []);

  const handleOverseerToggle = useCallback((enabled: boolean) => {
    setOverseerView(enabled);
  }, []);

  // Convert UI rig filter to API parameter
  const apiRig = rigFilter === 'ALL' ? undefined : rigFilter;

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
          <span style={styles.filterLabel}>{isGasTown ? 'RIG:' : 'PROJECT:'}</span>
          <select
            value={rigFilter}
            onChange={(e) => { setRigFilter(e.target.value); }}
            style={styles.select}
          >
            <option value="ALL">{isGasTown ? 'ALL RIGS' : 'ALL PROJECTS'}</option>
            {rigOptions.map((rig) => (
              <option key={rig} value={rig}>
                {rig.toUpperCase().replace(/_/g, ' ')}
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
        rig={apiRig}
        overseerView={overseerView}
        onEpicClick={handleEpicClick}
      />

      <EpicDetailView
        epicId={selectedEpicId}
        onClose={handleCloseDetail}
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
