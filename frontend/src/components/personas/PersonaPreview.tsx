/**
 * Live prompt preview panel for the persona editor.
 *
 * Shows the generated system prompt text that updates as the user
 * adjusts trait sliders (debounced 200ms). Rendered with terminal
 * styling (monospace, dark background, green text).
 *
 * Design spec: adj-rf31
 */
import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { api } from '../../services/api';

interface PersonaPreviewProps {
  /** Persona ID to fetch the prompt for. Null for unsaved personas. */
  personaId: string | null;
  /** Manual prompt override for unsaved/edited personas (computed client-side fallback). */
  fallbackPrompt?: string;
  /** Debounce trigger — increment this to re-fetch. */
  refreshKey: number;
}

export function PersonaPreview({ personaId, fallbackPrompt, refreshKey }: PersonaPreviewProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!personaId) {
      setPrompt(null);
      return;
    }

    // Debounce 200ms
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      api.personas
        .getPrompt(personaId)
        .then((data) => {
          setPrompt(data.prompt);
        })
        // eslint-disable-next-line @typescript-eslint/use-unknown-in-catch-callback-variable
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to load prompt');
        })
        .finally(() => {
          setLoading(false);
        });
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [personaId, refreshKey]);

  const displayPrompt = prompt ?? fallbackPrompt ?? null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerIcon}>{'>'}</span>
        <span style={styles.headerTitle}>PROMPT PREVIEW</span>
        <span style={styles.headerLine} />
      </div>

      <div style={styles.content}>
        {loading && !displayPrompt && (
          <div style={styles.loadingState}>GENERATING PROMPT...</div>
        )}

        {error && !displayPrompt && (
          <div style={styles.errorState}>{error}</div>
        )}

        {!displayPrompt && !loading && !error && (
          <div style={styles.emptyState}>
            ADJUST TRAITS TO SEE PREVIEW
          </div>
        )}

        {displayPrompt && (
          <pre style={styles.promptText}>{displayPrompt}</pre>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    height: '100%',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },

  headerIcon: {
    color: 'var(--crt-phosphor-bright)',
    fontSize: '0.85rem',
  },

  headerTitle: {
    fontSize: '0.75rem',
    letterSpacing: '0.15em',
    color: 'var(--crt-phosphor)',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    flexShrink: 0,
  },

  headerLine: {
    flex: 1,
    height: '1px',
    background: 'linear-gradient(to right, var(--crt-phosphor-dim), transparent)',
  },

  content: {
    flex: 1,
    overflow: 'auto',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: '#020202',
    padding: '12px',
    minHeight: 0,
  },

  loadingState: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textAlign: 'center',
    padding: '24px',
  },

  errorState: {
    color: 'var(--pipboy-red)',
    fontSize: '0.75rem',
    letterSpacing: '0.05em',
    textAlign: 'center',
    padding: '24px',
  },

  emptyState: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textAlign: 'center',
    padding: '48px 24px',
  },

  promptText: {
    margin: 0,
    padding: 0,
    color: 'var(--crt-phosphor)',
    fontSize: '0.7rem',
    lineHeight: 1.6,
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
} satisfies Record<string, CSSProperties>;
