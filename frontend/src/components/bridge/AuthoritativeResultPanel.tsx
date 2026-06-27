/**
 * AuthoritativeResultPanel (adj-202.3.7) — the grounding contract made visible.
 *
 * The Bridge's avatar speaks, but it only NARRATES. This panel renders the
 * STRUCTURED tool result verbatim — it is the source of truth. If a spoken claim
 * ever diverges from what is shown here, the readout wins. So the data is printed
 * exactly as the server returned it (pretty-printed JSON), and a structured error
 * is surfaced as its code + message, never silently dropped.
 *
 * Pure presentation over the hook's `BridgeToolRunResult`.
 */
import { type CSSProperties } from 'react';

import type { BridgeToolRunResult } from '../../types/bridge';

const AZURE = '#1FB6D6';
const PURPLE = '#a118c4';
const ERROR_RED = '#ff5c6c';

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  border: `1px solid ${AZURE}55`,
  background: '#0a0a0f',
  borderRadius: 4,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  padding: '0.5rem 0.75rem',
  borderBottom: `1px solid ${AZURE}33`,
  fontFamily: 'var(--font-mono, monospace)',
};

const eyebrowStyle: CSSProperties = {
  fontSize: '0.5625rem',
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  color: '#9aa0a6',
};

const readoutStyle: CSSProperties = {
  margin: 0,
  padding: '0.75rem',
  overflow: 'auto',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.75rem',
  lineHeight: 1.5,
  color: '#e6e6ee',
  whiteSpace: 'pre',
  flex: 1,
};

const emptyStyle: CSSProperties = {
  padding: '1.5rem 0.75rem',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.8125rem',
  color: '#9aa0a6',
};

export interface AuthoritativeResultPanelProps {
  result: BridgeToolRunResult | null;
}

export function AuthoritativeResultPanel({ result }: AuthoritativeResultPanelProps) {
  return (
    <section style={panelStyle} aria-label="Authoritative readout">
      <header style={headerStyle}>
        <span style={eyebrowStyle}>Authoritative readout // source of truth</span>
        {result && result.ok && (
          <span style={{ color: AZURE, fontSize: '0.8125rem', fontWeight: 600 }}>{result.tool}</span>
        )}
        {result && result.ok && result.projectId && (
          <span style={{ color: PURPLE, fontSize: '0.6875rem' }}>{result.projectId}</span>
        )}
      </header>

      {!result && (
        <p style={emptyStyle}>
          No readout yet. Ask the Adjutant for a fleet briefing and the structured result lands here.
        </p>
      )}

      {result && result.ok && (
        <pre data-testid="authoritative-readout" style={readoutStyle}>
          {JSON.stringify(result.data, null, 2)}
        </pre>
      )}

      {result && !result.ok && (
        <div style={{ padding: '0.75rem', fontFamily: 'var(--font-mono, monospace)' }} role="alert">
          <div style={{ color: ERROR_RED, fontWeight: 700, fontSize: '0.8125rem', letterSpacing: '0.04em' }}>
            {result.error.code}
          </div>
          <div style={{ color: '#e6e6ee', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {result.error.message}
          </div>
        </div>
      )}
    </section>
  );
}
