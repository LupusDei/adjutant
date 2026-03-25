/**
 * Main Personas page view for the web dashboard.
 *
 * Shows the persona roster grid with CREATE PERSONA button.
 * Clicking a card opens the PersonaEditor.
 * When 0 personas exist, shows the empty-state onboarding CTA.
 *
 * Design specs: adj-bpxp, adj-3qgk, adj-rf31
 */
import { useState, useEffect, useCallback, type CSSProperties } from 'react';

import type { Persona } from '../../types';
import { api, ApiError } from '../../services/api';
import { PersonaRosterCard } from './PersonaRosterCard';
import { PersonaEditor } from './PersonaEditor';
import { useMediaQuery } from '../../hooks/useMediaQuery';

type ViewMode = 'list' | 'edit';

interface PersonasViewProps {
  /** Whether this tab is currently active. */
  isActive?: boolean;
}

export function PersonasView({ isActive }: PersonasViewProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);

  const isNarrow = useMediaQuery('(max-width: 768px)');

  // Fetch personas
  const fetchPersonas = useCallback(async () => {
    try {
      const result = await api.personas.list();
      setPersonas(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load personas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void fetchPersonas();
    }
  }, [isActive, fetchPersonas]);

  const handleCreateNew = useCallback(() => {
    setEditingPersona(null);
    setViewMode('edit');
  }, []);

  const handleEdit = useCallback((persona: Persona) => {
    setEditingPersona(persona);
    setViewMode('edit');
  }, []);

  const handleDeploy = useCallback(async (persona: Persona) => {
    try {
      await api.agents.spawn({ personaId: persona.id });
      void fetchPersonas();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to deploy persona';
      alert(`Deploy failed: ${message}`);
    }
  }, [fetchPersonas]);

  const handleSave = useCallback((saved: Persona) => {
    setPersonas(prev => {
      const exists = prev.find(p => p.id === saved.id);
      if (exists) {
        return prev.map(p => p.id === saved.id ? saved : p);
      }
      return [...prev, saved];
    });
    setViewMode('list');
    setEditingPersona(null);
  }, []);

  const handleCancel = useCallback(() => {
    setViewMode('list');
    setEditingPersona(null);
  }, []);

  const handleDelete = useCallback(async (persona: Persona) => {
    if (!confirm(`Delete ${persona.name}?`)) return;
    try {
      await api.personas.delete(persona.id);
      setPersonas(prev => prev.filter(p => p.id !== persona.id));
    } catch {
      // Silent failure — persona still shows until next refresh
    }
  }, []);

  // Editor view
  if (viewMode === 'edit') {
    return (
      <section style={styles.container}>
        <PersonaEditor
          persona={editingPersona}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </section>
    );
  }

  // List view
  return (
    <section style={styles.container}>
      <header style={styles.header}>
        <h2 style={styles.title} className="crt-glow">PERSONAS</h2>
        <button
          style={styles.createButton}
          className="pipboy-button"
          onClick={handleCreateNew}
        >
          + BUILD PERSONA
        </button>
      </header>

      <div style={styles.body}>
        {loading && (
          <div style={styles.loadingState}>
            <div style={styles.loadingPulse} />
            LOADING PERSONAS...
          </div>
        )}

        {error && (
          <div style={styles.errorBanner} role="alert">
            COMM ERROR: {error}
          </div>
        )}

        {!loading && !error && personas.length === 0 && (
          <EmptyState onCreateNew={handleCreateNew} />
        )}

        {!loading && personas.length > 0 && (
          <>
            {/* Section header */}
            <div style={styles.sectionHeader}>
              <span style={styles.sectionIcon}>{'\u25C7'}</span>
              <span style={styles.sectionTitle} className="crt-glow">PERSONA ROSTER</span>
              <span style={styles.sectionLine} />
              <span style={styles.sectionCount}>{personas.length}</span>
            </div>

            {/* Persona grid */}
            <div style={{
              ...styles.grid,
              gridTemplateColumns: isNarrow ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
            }}>
              {personas.map((persona) => (
                <div key={persona.id} style={styles.cardWrapper}>
                  <PersonaRosterCard
                    persona={persona}
                    // eslint-disable-next-line @typescript-eslint/no-misused-promises
                    onDeploy={handleDeploy}
                    onEdit={handleEdit}
                  />
                  <button
                    style={styles.deleteButton}
                    onClick={(e) => { e.stopPropagation(); void handleDelete(persona); }}
                    title={`Delete ${persona.name}`}
                    aria-label={`Delete ${persona.name}`}
                  >
                    {'\u2715'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Empty State
// =============================================================================

interface EmptyStateProps {
  onCreateNew: () => void;
}

function EmptyState({ onCreateNew }: EmptyStateProps) {
  return (
    <div style={styles.emptyState}>
      <div style={styles.emptyIcon}>{'\u25C7'}</div>
      <h3 style={styles.emptyTitle} className="crt-glow">BUILD YOUR FIRST AGENT PERSONA</h3>
      <p style={styles.emptyDescription}>
        Define specialized roles with custom trait distributions.
        Budget 100 points across 12 skills to create focused agents.
      </p>
      <button
        style={styles.emptyCta}
        className="pipboy-button"
        onClick={onCreateNew}
      >
        CREATE PERSONA
      </button>
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = {
  container: {
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'var(--theme-bg-screen)',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: 'var(--crt-phosphor)',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
    paddingBottom: '10px',
    flexShrink: 0,
  },

  title: {
    margin: 0,
    fontSize: '1.25rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: 'var(--crt-phosphor)',
  },

  createButton: {
    fontSize: '0.75rem',
    padding: '6px 14px',
    letterSpacing: '0.1em',
    fontWeight: 'bold',
  },

  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minHeight: 0,
    overflow: 'auto',
    paddingRight: '4px',
  },

  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    gap: '16px',
  },

  loadingPulse: {
    width: '40px',
    height: '40px',
    border: '2px solid var(--crt-phosphor-dim)',
    borderTopColor: 'var(--crt-phosphor)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },

  errorBanner: {
    border: '1px solid #FF4444',
    color: '#FF4444',
    padding: '8px 12px',
    fontSize: '0.85rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },

  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.85rem',
    letterSpacing: '0.15em',
  },

  sectionIcon: {
    color: 'var(--crt-phosphor-bright)',
    fontSize: '0.9rem',
  },

  sectionTitle: {
    color: 'var(--crt-phosphor)',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },

  sectionLine: {
    flex: 1,
    height: '1px',
    background: 'linear-gradient(to right, var(--crt-phosphor-dim), transparent)',
  },

  sectionCount: {
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
  },

  grid: {
    display: 'grid',
    gap: '10px',
  },

  cardWrapper: {
    position: 'relative',
  },

  deleteButton: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '22px',
    height: '22px',
    padding: 0,
    border: '1px solid #FF4444',
    backgroundColor: 'rgba(255, 68, 68, 0.08)',
    color: '#FF4444',
    fontSize: '11px',
    fontWeight: 'bold',
    fontFamily: 'monospace',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
    transition: 'all 0.2s ease',
    lineHeight: 1,
    zIndex: 2,
  },

  // Empty state
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px',
    gap: '16px',
    textAlign: 'center',
  },

  emptyIcon: {
    fontSize: '2rem',
    color: 'var(--crt-phosphor-dim)',
    opacity: 0.6,
  },

  emptyTitle: {
    margin: 0,
    fontSize: '1rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'var(--crt-phosphor)',
  },

  emptyDescription: {
    margin: 0,
    fontSize: '0.8rem',
    color: 'var(--crt-phosphor-dim)',
    maxWidth: '400px',
    lineHeight: 1.5,
  },

  emptyCta: {
    marginTop: '8px',
    fontSize: '0.85rem',
    padding: '10px 24px',
    letterSpacing: '0.1em',
    fontWeight: 'bold',
  },
} satisfies Record<string, CSSProperties>;
