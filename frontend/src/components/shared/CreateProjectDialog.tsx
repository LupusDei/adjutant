/**
 * CreateProjectDialog - Terminal-themed modal for creating/registering a new project.
 * Supports three modes: Clone from URL, Open local path, Create empty project.
 */

import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import { api } from '../../services/api';
import type { ProjectInfo } from '../../types';

// ============================================================================
// Types
// ============================================================================

type CreateMode = 'clone' | 'path' | 'empty';

export interface CreateProjectDialogProps {
  /** Called with the newly created project on success */
  onSuccess: (project: ProjectInfo) => void;
  /** Called when the user cancels / closes the dialog */
  onCancel: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function CreateProjectDialog({ onSuccess, onCancel }: CreateProjectDialogProps) {
  const [mode, setMode] = useState<CreateMode>('clone');
  const [cloneUrl, setCloneUrl] = useState('');
  const [targetDir, setTargetDir] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const canSubmit = useCallback((): boolean => {
    if (submitting) return false;
    switch (mode) {
      case 'clone':
        return cloneUrl.trim().length > 0;
      case 'path':
        return localPath.trim().length > 0;
      case 'empty':
        return name.trim().length > 0;
      default:
        return false;
    }
  }, [mode, cloneUrl, localPath, name, submitting]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit()) return;
    setSubmitting(true);
    setError(null);

    try {
      let project: ProjectInfo;
      switch (mode) {
        case 'clone':
          project = await api.projects.create({
            cloneUrl: cloneUrl.trim(),
            targetDir: targetDir.trim() || undefined,
            name: name.trim() || undefined,
          });
          break;
        case 'path':
          project = await api.projects.create({
            path: localPath.trim(),
            name: name.trim() || undefined,
          });
          break;
        case 'empty':
          project = await api.projects.create({
            name: name.trim(),
            empty: true,
          });
          break;
      }
      onSuccess(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setSubmitting(false);
    }
  }, [canSubmit, mode, cloneUrl, targetDir, localPath, name, onSuccess]);

  // Handle Enter key in form fields
  const handleFieldKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit()) {
      void handleSubmit();
    }
  }, [canSubmit, handleSubmit]);

  const submitLabel = submitting
    ? mode === 'clone' ? 'CLONING...' : 'CREATING...'
    : 'CREATE';

  return (
    <div style={styles.backdrop} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerText}>NEW PROJECT</span>
          <button style={styles.closeButton} onClick={onCancel}>
            [X]
          </button>
        </div>

        {/* Mode Tabs */}
        <div style={styles.tabBar}>
          {MODES.map((m) => (
            <button
              key={m.key}
              style={{
                ...styles.tab,
                ...(mode === m.key ? styles.tabActive : {}),
              }}
              onClick={() => {
                setMode(m.key);
                setError(null);
              }}
              disabled={submitting}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Form Content */}
        <div style={styles.content}>
          {mode === 'clone' && (
            <>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>REPOSITORY URL</label>
                <input
                  style={styles.input}
                  type="text"
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  onKeyDown={handleFieldKeyDown}
                  placeholder="https://github.com/user/repo.git"
                  disabled={submitting}
                  autoFocus
                />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>TARGET DIRECTORY</label>
                <input
                  style={styles.input}
                  type="text"
                  value={targetDir}
                  onChange={(e) => setTargetDir(e.target.value)}
                  onKeyDown={handleFieldKeyDown}
                  placeholder="/path/to/clone/into (optional)"
                  disabled={submitting}
                />
                <span style={styles.fieldHint}>
                  Leave empty to use default location
                </span>
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>PROJECT NAME</label>
                <input
                  style={styles.input}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleFieldKeyDown}
                  placeholder="(optional - derived from URL)"
                  disabled={submitting}
                />
              </div>
            </>
          )}

          {mode === 'path' && (
            <>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>LOCAL PATH</label>
                <input
                  style={styles.input}
                  type="text"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  onKeyDown={handleFieldKeyDown}
                  placeholder="/path/to/existing/project"
                  disabled={submitting}
                  autoFocus
                />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>PROJECT NAME</label>
                <input
                  style={styles.input}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleFieldKeyDown}
                  placeholder="(optional - derived from directory)"
                  disabled={submitting}
                />
              </div>
            </>
          )}

          {mode === 'empty' && (
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>PROJECT NAME</label>
              <input
                style={styles.input}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleFieldKeyDown}
                placeholder="my-new-project"
                disabled={submitting}
                autoFocus
              />
              <span style={styles.fieldHint}>
                Creates a new empty project with no repository
              </span>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div style={styles.errorBox}>
              <span style={styles.errorPrefix}>ERROR:</span> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button
            style={styles.cancelButton}
            onClick={onCancel}
            disabled={submitting}
          >
            CANCEL
          </button>
          <button
            style={{
              ...styles.submitButton,
              ...(!canSubmit() ? styles.submitButtonDisabled : {}),
            }}
            onClick={() => void handleSubmit()}
            disabled={!canSubmit()}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Mode Definitions
// ============================================================================

const MODES: { key: CreateMode; label: string }[] = [
  { key: 'clone', label: 'CLONE' },
  { key: 'path', label: 'PATH' },
  { key: 'empty', label: 'EMPTY' },
];

// ============================================================================
// Styles
// ============================================================================

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  background: 'var(--theme-bg-screen)',
} as const;

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: colors.background,
    border: `1px solid ${colors.primary}`,
    boxShadow: '0 0 20px rgba(0, 255, 0, 0.15), inset 0 0 30px rgba(0, 0, 0, 0.5)',
    width: '460px',
    maxWidth: '90vw',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", monospace',
  },
  header: {
    padding: '12px 16px',
    borderBottom: `1px solid ${colors.primaryDim}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    color: colors.primary,
    fontSize: '0.9rem',
    letterSpacing: '0.15em',
    textShadow: '0 0 6px rgba(0, 255, 0, 0.4)',
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    color: colors.primaryDim,
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    cursor: 'pointer',
    padding: '2px 4px',
    letterSpacing: '0.05em',
  },
  tabBar: {
    display: 'flex',
    borderBottom: `1px solid ${colors.primaryDim}`,
  },
  tab: {
    flex: 1,
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: colors.primaryDim,
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    letterSpacing: '0.15em',
    padding: '10px 12px',
    cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: colors.primary,
    borderBottomColor: colors.primary,
    textShadow: '0 0 6px rgba(0, 255, 0, 0.4)',
  },
  content: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    minHeight: '140px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  fieldLabel: {
    color: colors.primaryDim,
    fontSize: '0.65rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: 'rgba(0, 255, 0, 0.03)',
    border: `1px solid ${colors.primaryDim}`,
    color: colors.primary,
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    padding: '8px 10px',
    outline: 'none',
    letterSpacing: '0.03em',
    caretColor: colors.primary,
  },
  fieldHint: {
    color: colors.primaryDim,
    fontSize: '0.6rem',
    letterSpacing: '0.05em',
    opacity: 0.7,
  },
  errorBox: {
    backgroundColor: 'rgba(255, 68, 68, 0.08)',
    border: '1px solid rgba(255, 68, 68, 0.4)',
    color: '#FF6666',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '10px 12px',
    letterSpacing: '0.03em',
    lineHeight: 1.4,
  },
  errorPrefix: {
    color: '#FF4444',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  footer: {
    padding: '12px 16px',
    borderTop: `1px solid ${colors.primaryDim}`,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    color: colors.primaryDim,
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '6px 16px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
  },
  submitButton: {
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    border: `1px solid ${colors.primary}`,
    color: colors.primary,
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '6px 16px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
    textShadow: '0 0 4px rgba(0, 255, 0, 0.3)',
  },
  submitButtonDisabled: {
    opacity: 0.4,
    cursor: 'default',
    textShadow: 'none',
  },
} satisfies Record<string, CSSProperties>;

export default CreateProjectDialog;
