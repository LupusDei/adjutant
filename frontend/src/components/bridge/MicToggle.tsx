/**
 * MicToggle (adj-202.3.7.2) — mic control + state indicator in the panel chrome.
 *
 * Spec US1 calls for a mic toggle the Commander can see and reach without diving
 * into the sandboxed avatar iframe. This is a toggle button: `aria-pressed`
 * carries the mic state for assistive tech, and the visible glyph/label mirror
 * it. The actual mute/unmute is relayed by BridgePanel to the avatar iframe.
 */
import { type CSSProperties } from 'react';

const AZURE = '#1FB6D6';
const MUTED = '#ff8800';

export interface MicToggleProps {
  /** True when the mic is live (unmuted). */
  enabled: boolean;
  /** Disable the control (e.g. before the avatar link is up). */
  disabled?: boolean;
  onToggle: () => void;
}

function buttonStyle(enabled: boolean, disabled: boolean): CSSProperties {
  const color = disabled ? '#55565c' : enabled ? AZURE : MUTED;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.4rem 0.75rem',
    background: 'transparent',
    border: `1px solid ${disabled ? '#33343a' : color}`,
    borderRadius: 3,
    color,
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '0.75rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

export function MicToggle({ enabled, disabled = false, onToggle }: MicToggleProps) {
  return (
    <button
      type="button"
      style={buttonStyle(enabled, disabled)}
      aria-pressed={enabled}
      aria-label={enabled ? 'Mute microphone' : 'Unmute microphone'}
      disabled={disabled}
      onClick={onToggle}
    >
      <span aria-hidden>{enabled ? '🎙' : '🔇'}</span>
      <span>{enabled ? 'Mic on' : 'Mic off'}</span>
    </button>
  );
}
