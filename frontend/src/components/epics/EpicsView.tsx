import { useState, type CSSProperties } from 'react';
import { useRigFilter } from '../../contexts/RigContext';
import { EpicsList, type EpicSortOption } from './EpicsList';
import { EpicDetailView } from './EpicDetailView';

export interface EpicsViewProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

export function EpicsView({ isActive = true }: EpicsViewProps) {
  const [sortBy, setSortBy] = useState<EpicSortOption>('ACTIVITY');
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const { selectedRig, availableRigs, setSelectedRig } = useRigFilter();

  const handleEpicClick = (epicId: string) => {
    setSelectedEpicId(epicId);
  };

  const handleCloseDetail = () => {
    setSelectedEpicId(null);
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.titleSection}>
          <h2 style={styles.title} className="crt-glow">EPICS</h2>
          <span style={styles.subtitle}>PROJECT TRACKING</span>
        </div>

        <div style={styles.controls}>
          {/* Rig Filter */}
          {availableRigs.length > 0 && (
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>RIG:</span>
              <select
                value={selectedRig ?? ''}
                onChange={(e) => setSelectedRig(e.target.value || null)}
                style={styles.select}
              >
                <option value="">ALL RIGS</option>
                {availableRigs.map((rig) => (
                  <option key={rig} value={rig}>
                    {rig.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sort Control */}
          <div style={styles.filterGroup}>
            <span style={styles.filterLabel}>SORT:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as EpicSortOption)}
              style={styles.select}
            >
              <option value="ACTIVITY">LATEST ACTIVITY</option>
              <option value="PROGRESS">LEAST COMPLETE</option>
              <option value="ID">EPIC ID</option>
            </select>
          </div>
        </div>
      </header>

      <EpicsList
        sortBy={sortBy}
        isActive={isActive}
        rig={selectedRig ?? undefined}
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
    gap: '16px',
    flexWrap: 'wrap',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
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
