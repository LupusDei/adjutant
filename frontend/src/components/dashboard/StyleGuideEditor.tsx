import React, { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react';

import { useProjectStyleGuide } from '../../hooks/useProjectStyleGuide';

/**
 * StyleGuideEditor (adj-201) — per-project brand-color editor.
 *
 * Lets the General set a project's proposal brand color: a required primary and
 * an optional secondary, each as a native color swatch picker paired with a
 * monospace hex field. Hex is validated client-side with parity to the backend
 * (`#RGB` / `#RRGGBB`); Save is disabled until the form is dirty AND valid.
 * Clearing primary (the Clear control) clears the whole guide on save.
 *
 * The editor reads/writes through `useProjectStyleGuide` — it owns presentation
 * and validation only; load/save/error state lives in the hook.
 */

interface StyleGuideEditorProps {
  /** Canonical project UUID whose style guide is being edited. */
  projectId: string;
}

/** Backend-parity hex validation: `#RGB` or `#RRGGBB` (case-insensitive). */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

/**
 * A color picker swatch + hex field for one brand color. The swatch is a native
 * `<input type="color">` themed as a phosphor sample cell; the hex field is the
 * authoritative monospace value (also accepts shorthand a picker can't emit).
 */
function ALWAYS_VALID_PICKER(value: string): string {
  // A native color input only accepts #RRGGBB. Expand a valid #RGB so the
  // swatch reflects shorthand the user typed; fall back to black otherwise.
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  const short = /^#(.)(.)(.)$/.exec(v);
  if (short) {
    const [, r, g, b] = short;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#000000';
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: 'var(--theme-bg-screen, #020502)',
  red: 'var(--color-pipboy-red, #FF4444)',
  redGlow: 'var(--color-pipboy-red-glow, rgba(255,68,68,0.4))',
} as const;

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  } as CSSProperties,

  hint: {
    fontSize: '0.7rem',
    letterSpacing: '0.08em',
    color: colors.primaryDim,
    lineHeight: 1.5,
  } as CSSProperties,

  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  } as CSSProperties,

  label: {
    fontSize: '0.72rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: colors.primaryDim,
  } as CSSProperties,

  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as CSSProperties,

  swatch: {
    width: '34px',
    height: '34px',
    padding: 0,
    border: `2px solid ${colors.primaryDim}`,
    borderRadius: '3px',
    background: colors.background,
    cursor: 'pointer',
    flexShrink: 0,
  } as CSSProperties,

  hexInput: {
    flex: 1,
    minWidth: 0,
    padding: '8px 10px',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    letterSpacing: '0.05em',
    color: colors.primary,
    background: colors.background,
    border: `2px solid ${colors.primaryDim}`,
    borderRadius: '3px',
    outline: 'none',
    textTransform: 'lowercase',
  } as CSSProperties,

  hexInputInvalid: {
    borderColor: colors.red,
    color: colors.red,
    boxShadow: `0 0 8px ${colors.redGlow}`,
  } as CSSProperties,

  error: {
    fontSize: '0.7rem',
    letterSpacing: '0.06em',
    color: colors.red,
    textShadow: `0 0 6px ${colors.redGlow}`,
  } as CSSProperties,

  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginTop: '4px',
  } as CSSProperties,

  saveButton: {
    padding: '8px 18px',
    fontFamily: 'inherit',
    fontSize: '0.78rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: colors.background,
    background: colors.primary,
    border: `2px solid ${colors.primary}`,
    borderRadius: '3px',
    cursor: 'pointer',
    boxShadow: `0 0 10px ${colors.primaryGlow}`,
  } as CSSProperties,

  saveButtonDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    boxShadow: 'none',
  } as CSSProperties,

  clearButton: {
    padding: '8px 14px',
    fontFamily: 'inherit',
    fontSize: '0.78rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: colors.primaryDim,
    background: 'transparent',
    border: `2px solid ${colors.primaryDim}`,
    borderRadius: '3px',
    cursor: 'pointer',
  } as CSSProperties,

  clearButtonDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  } as CSSProperties,
} as const;

interface ColorFieldProps {
  label: 'Primary' | 'Secondary';
  optional?: boolean;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({ label, optional, value, invalid, onChange }) => {
  const hexId = `style-guide-${label.toLowerCase()}-hex`;
  return (
    <div style={styles.field}>
      <label style={styles.label} htmlFor={hexId}>
        {label} brand color{optional ? ' (optional)' : ''}
      </label>
      <div style={styles.inputRow}>
        <input
          type="color"
          aria-label={`${label} color swatch`}
          style={styles.swatch}
          value={ALWAYS_VALID_PICKER(value)}
          onChange={(e) => { onChange(e.target.value); }}
        />
        <input
          id={hexId}
          type="text"
          aria-label={`${label} hex`}
          aria-invalid={invalid}
          spellCheck={false}
          placeholder="#00ff00"
          style={{ ...styles.hexInput, ...(invalid ? styles.hexInputInvalid : {}) }}
          value={value}
          onChange={(e) => { onChange(e.target.value); }}
        />
      </div>
    </div>
  );
};

export const StyleGuideEditor: React.FC<StyleGuideEditorProps> = ({ projectId }) => {
  const { guide, loading, saving, error, save } = useProjectStyleGuide(projectId);

  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');

  // Hydrate local fields from the loaded guide. Keyed off the guide values so a
  // refresh (or external change) re-seeds the inputs.
  const loadedPrimary = guide?.brandColorPrimary ?? '';
  const loadedSecondary = guide?.brandColorSecondary ?? '';
  useEffect(() => {
    setPrimary(loadedPrimary);
    setSecondary(loadedSecondary);
  }, [loadedPrimary, loadedSecondary]);

  const primaryInvalid = primary.trim() !== '' && !isValidHex(primary);
  // Secondary is optional: empty is allowed, a non-empty value must be valid.
  const secondaryInvalid = secondary.trim() !== '' && !isValidHex(secondary);

  const dirty = primary.trim() !== loadedPrimary || secondary.trim() !== loadedSecondary;

  // Save requires a valid, non-empty primary (empty primary is the Clear path)
  // and a valid-or-empty secondary.
  const canSave =
    dirty &&
    !saving &&
    primary.trim() !== '' &&
    isValidHex(primary) &&
    !secondaryInvalid;

  const hasGuide = loadedPrimary !== '';

  const handleSave = useCallback(() => {
    void save({
      primary: primary.trim(),
      secondary: secondary.trim() === '' ? null : secondary.trim(),
    });
  }, [save, primary, secondary]);

  const handleClear = useCallback(() => {
    setPrimary('');
    setSecondary('');
    // Empty primary clears the whole guide server-side.
    void save({ primary: '', secondary: null });
  }, [save]);

  const inlineError = useMemo(() => {
    if (primaryInvalid) return 'Invalid primary hex — use #RGB or #RRGGBB.';
    if (secondaryInvalid) return 'Invalid secondary hex — use #RGB or #RRGGBB.';
    if (error) return error;
    return null;
  }, [primaryInvalid, secondaryInvalid, error]);

  if (loading) {
    return <p style={styles.hint}>Loading style guide...</p>;
  }

  return (
    <div style={styles.panel}>
      <p style={styles.hint}>
        Set the brand color agents use when authoring this project&apos;s proposal pages.
        Primary is required; secondary is optional.
      </p>

      <ColorField
        label="Primary"
        value={primary}
        invalid={primaryInvalid}
        onChange={setPrimary}
      />
      <ColorField
        label="Secondary"
        optional
        value={secondary}
        invalid={secondaryInvalid}
        onChange={setSecondary}
      />

      {inlineError && (
        <div role="alert" style={styles.error}>{inlineError}</div>
      )}

      <div style={styles.actions}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          style={{ ...styles.saveButton, ...(!canSave ? styles.saveButtonDisabled : {}) }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={saving || !hasGuide}
          style={{ ...styles.clearButton, ...(saving || !hasGuide ? styles.clearButtonDisabled : {}) }}
        >
          Clear
        </button>
      </div>
    </div>
  );
};

export default StyleGuideEditor;
