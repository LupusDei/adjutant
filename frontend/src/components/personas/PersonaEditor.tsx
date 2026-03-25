/**
 * Persona editor with two-column layout: left panel (60%) scrollable
 * form with grouped stepped sliders, right panel (40%) sticky prompt preview.
 * Budget gauge pinned to top of left panel.
 *
 * Design specs: adj-rf31, adj-s0t2, adj-zkxv, adj-xs1k, adj-4jb0
 */
import { useState, useCallback, useMemo, type CSSProperties } from 'react';

import type {
  Persona,
  TraitValues,
  PersonaTraitKey,
  CreatePersonaInput,
  UpdatePersonaInput,
} from '../../types';
import {
  emptyTraits,
  sumTraits,
  POINT_BUDGET,
  TRAIT_GROUPS,
  TRAIT_DISPLAY,
} from '../../types';
import { api, ApiError } from '../../services/api';
import { BudgetGauge } from './BudgetGauge';
import { SteppedSlider } from './SteppedSlider';
import { PersonaPreview } from './PersonaPreview';

interface PersonaEditorProps {
  /** Existing persona to edit, or null for creation. */
  persona: Persona | null;
  /** Called after successful save/update. */
  onSave: (persona: Persona) => void;
  /** Called when user cancels editing. */
  onCancel: () => void;
}

export function PersonaEditor({ persona, onSave, onCancel }: PersonaEditorProps) {
  const isEdit = persona !== null;

  const [name, setName] = useState(persona?.name ?? '');
  const [description, setDescription] = useState(persona?.description ?? '');
  const [traits, setTraits] = useState<TraitValues>(persona?.traits ?? emptyTraits());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Collapsible trait groups
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of TRAIT_GROUPS) {
      initial[group.key] = true; // all expanded by default
    }
    return initial;
  });

  const spent = useMemo(() => sumTraits(traits), [traits]);
  const overBudget = spent > POINT_BUDGET;
  const canSave = name.trim().length > 0 && !overBudget && !saving;

  const handleTraitChange = useCallback((traitKey: PersonaTraitKey, value: number) => {
    setTraits(prev => ({ ...prev, [traitKey]: value }));
    // Trigger prompt re-fetch for existing personas
    if (persona) {
      setRefreshKey(k => k + 1);
    }
  }, [persona]);

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, []);

  const groupPoints = useMemo(() => {
    const points: Record<string, number> = {};
    for (const group of TRAIT_GROUPS) {
      points[group.key] = group.traits.reduce((sum, key) => sum + traits[key], 0);
    }
    return points;
  }, [traits]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    try {
      let result: Persona;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (isEdit && persona) {
        const input: UpdatePersonaInput = {
          name: name.trim(),
          description: description.trim(),
          traits,
        };
        result = await api.personas.update(persona.id, input);
      } else {
        const input: CreatePersonaInput = {
          name: name.trim(),
          description: description.trim(),
          traits,
        };
        result = await api.personas.create(input);
      }
      onSave(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to save persona');
      }
    } finally {
      setSaving(false);
    }
  }, [canSave, isEdit, persona, name, description, traits, onSave]);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.editorHeader}>
        <button style={styles.backButton} onClick={onCancel} aria-label="Back to persona list">
          {'<'} BACK
        </button>
        <h3 style={styles.editorTitle}>
          {isEdit ? `EDITING: ${persona.name.toUpperCase()}` : 'NEW PERSONA'}
        </h3>
      </div>

      {/* Two-column layout */}
      <div style={styles.twoColumn}>
        {/* Left panel: form */}
        <div style={styles.leftPanel}>
          {/* Budget gauge (sticky) */}
          <div style={styles.budgetSticky}>
            <BudgetGauge spent={spent} />
          </div>

          {/* Name + description inputs */}
          <div style={styles.inputGroup}>
            <label style={styles.inputLabel} htmlFor="persona-name">NAME</label>
            <input
              id="persona-name"
              style={styles.input}
              className="pipboy-input"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              placeholder="e.g. SENTINEL"
              maxLength={64}
              autoFocus
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.inputLabel} htmlFor="persona-desc">DESCRIPTION</label>
            <input
              id="persona-desc"
              style={styles.input}
              className="pipboy-input"
              type="text"
              value={description}
              onChange={(e) => { setDescription(e.target.value); }}
              placeholder="e.g. QA specialist with deep testing focus"
              maxLength={500}
            />
          </div>

          {/* Trait groups */}
          <div style={styles.traitGroups}>
            {TRAIT_GROUPS.map((group) => {
              const expanded = expandedGroups[group.key] ?? true;
              return (
                <div key={group.key} style={styles.traitGroup}>
                  {/* Group header (collapsible) */}
                  <button
                    style={styles.groupHeader}
                    onClick={() => { toggleGroup(group.key); }}
                    aria-expanded={expanded}
                  >
                    <span style={styles.groupToggle}>{expanded ? 'v' : '>'}</span>
                    <span style={styles.groupLabel} className="crt-glow">{group.label}</span>
                    <span style={styles.groupLine} />
                    <span style={styles.groupPoints}>
                      {groupPoints[group.key]} PTS
                    </span>
                  </button>

                  {/* Trait sliders */}
                  {expanded && (
                    <div style={styles.traitList}>
                      {group.traits.map((traitKey) => {
                        const display = TRAIT_DISPLAY[traitKey];
                        return (
                          <div key={traitKey} style={styles.traitRow} title={display.description}>
                            <span style={styles.traitLabel}>{display.label}</span>
                            <span style={styles.traitDots} />
                            <SteppedSlider
                              value={traits[traitKey]}
                              onChange={(v) => { handleTraitChange(traitKey, v); }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Error */}
          {error && (
            <div style={styles.errorBanner} role="alert">
              {error}
            </div>
          )}

          {/* Over budget error message */}
          {overBudget && (
            <div style={styles.overBudgetError} role="alert">
              REDUCE {spent - POINT_BUDGET} POINTS TO SAVE
            </div>
          )}

          {/* Save/Cancel buttons */}
          <div style={styles.actions}>
            <button
              style={{
                ...styles.saveButton,
                ...(canSave ? {} : styles.saveButtonDisabled),
              }}
              className="pipboy-button"
              onClick={() => { void handleSave(); }}
              disabled={!canSave}
            >
              {saving ? 'SAVING...' : isEdit ? 'UPDATE PERSONA' : 'SAVE PERSONA'}
            </button>
            <button
              style={styles.cancelButton}
              onClick={onCancel}
            >
              CANCEL
            </button>
          </div>
        </div>

        {/* Right panel: prompt preview (sticky) */}
        <div style={styles.rightPanel}>
          <div style={styles.previewSticky}>
            <PersonaPreview
              personaId={persona?.id ?? null}
              refreshKey={refreshKey}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: 'var(--crt-phosphor)',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },

  editorHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flexShrink: 0,
  },

  backButton: {
    padding: '4px 10px',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.7rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    flexShrink: 0,
  },

  editorTitle: {
    margin: 0,
    fontSize: '1rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'var(--crt-phosphor)',
  },

  twoColumn: {
    display: 'flex',
    gap: '16px',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },

  leftPanel: {
    flex: '3 1 0%',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    overflow: 'auto',
    paddingRight: '8px',
    minWidth: 0,
  },

  rightPanel: {
    flex: '2 1 0%',
    minWidth: '200px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },

  budgetSticky: {
    position: 'sticky',
    top: 0,
    zIndex: 5,
    backgroundColor: 'var(--theme-bg-screen)',
    paddingBottom: '4px',
  },

  previewSticky: {
    position: 'sticky',
    top: 0,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    maxHeight: '100%',
    overflow: 'hidden',
  },

  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },

  inputLabel: {
    fontSize: '0.65rem',
    letterSpacing: '0.15em',
    color: 'var(--crt-phosphor-dim)',
    fontWeight: 'bold',
  },

  input: {
    width: '100%',
    fontSize: '0.85rem',
    padding: '8px 10px',
  },

  traitGroups: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },

  traitGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },

  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: 'var(--crt-phosphor)',
  },

  groupToggle: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    width: '12px',
    flexShrink: 0,
  },

  groupLabel: {
    fontSize: '0.8rem',
    fontWeight: 'bold',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    flexShrink: 0,
  },

  groupLine: {
    flex: 1,
    height: '1px',
    background: 'linear-gradient(to right, var(--crt-phosphor-dim), transparent)',
  },

  groupPoints: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    flexShrink: 0,
  },

  traitList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingLeft: '20px',
  },

  traitRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  traitLabel: {
    fontSize: '0.7rem',
    letterSpacing: '0.08em',
    color: 'var(--crt-phosphor-dim)',
    fontWeight: 'bold',
    flexShrink: 0,
    minWidth: '120px',
  },

  traitDots: {
    flex: '0 0 auto',
    minWidth: '8px',
  },

  errorBanner: {
    border: '1px solid var(--pipboy-red)',
    color: 'var(--pipboy-red)',
    padding: '8px 12px',
    fontSize: '0.75rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    backgroundColor: 'rgba(254, 20, 20, 0.1)',
  },

  overBudgetError: {
    color: 'var(--pipboy-red)',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    textAlign: 'center',
    padding: '8px 0',
  },

  actions: {
    display: 'flex',
    gap: '12px',
    paddingTop: '8px',
    paddingBottom: '16px',
  },

  saveButton: {
    flex: 1,
    fontSize: '0.85rem',
    padding: '10px',
    letterSpacing: '0.1em',
    fontWeight: 'bold',
  },

  saveButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },

  cancelButton: {
    padding: '10px 20px',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
} satisfies Record<string, CSSProperties>;
