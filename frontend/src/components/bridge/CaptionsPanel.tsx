/**
 * CaptionsPanel (adj-202.3.7.1) — live captions for The Bridge.
 *
 * Shows the avatar's spoken narration as text: spec US1 requires captions, and
 * they are the accessible path for an audio-off or deaf/HoH Commander. The
 * region is an `aria-live="polite"` log so assistive tech announces new lines as
 * they arrive. Captions also reinforce the grounding contract — the narration is
 * visible alongside the authoritative readout, never a substitute for it.
 *
 * Pure presentation; the transcript is fed in by BridgePanel from the avatar
 * iframe's postMessage stream.
 */
import { type CSSProperties } from 'react';

const AZURE = '#1FB6D6';
const PURPLE = '#a118c4';

export interface CaptionLine {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  /** False while the line is still being transcribed (interim result). */
  final: boolean;
}

export interface CaptionsPanelProps {
  captions: CaptionLine[];
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  border: `1px solid ${PURPLE}44`,
  background: '#0a0a0f',
  borderRadius: 4,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: `1px solid ${PURPLE}33`,
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.5625rem',
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  color: '#9aa0a6',
};

const logStyle: CSSProperties = {
  margin: 0,
  padding: '0.5rem 0.75rem',
  listStyle: 'none',
  overflow: 'auto',
  flex: 1,
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.75rem',
  lineHeight: 1.5,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const emptyStyle: CSSProperties = { color: '#9aa0a6' };

function roleColor(role: CaptionLine['role']): string {
  return role === 'assistant' ? AZURE : '#cfd2d6';
}

function roleLabel(role: CaptionLine['role']): string {
  return role === 'assistant' ? 'ADJUTANT' : 'COMMANDER';
}

export function CaptionsPanel({ captions }: CaptionsPanelProps) {
  return (
    <section style={panelStyle} aria-label="Live captions">
      <header style={headerStyle}>Captions // live narration</header>
      <ol style={logStyle} role="log" aria-live="polite" aria-relevant="additions text">
        {captions.length === 0 ? (
          <li style={emptyStyle}>No narration yet. The Adjutant's words appear here as it speaks.</li>
        ) : (
          captions.map((line) => (
            <li key={line.id} style={{ opacity: line.final ? 1 : 0.65 }}>
              <span
                style={{
                  color: roleColor(line.role),
                  fontSize: '0.5625rem',
                  letterSpacing: '0.1em',
                  marginRight: '0.4rem',
                }}
              >
                {roleLabel(line.role)}
              </span>
              <span style={{ color: '#e6e6ee' }}>{line.text}</span>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
