/**
 * MediaToggle (adj-202.5.1) — the shared primitive behind the Bridge media
 * controls (mic, camera, screen-share). It is a single toggle button whose
 * `aria-pressed` carries the on/off state for assistive tech while the visible
 * glyph + label mirror it. The actual capture enable/disable is relayed by
 * BridgePanel to the sandboxed avatar iframe (the panel never touches WebRTC
 * directly — one broker-owned session).
 *
 * MicToggle / CameraToggle / ScreenShareToggle are thin presets over this so the
 * chrome controls stay visually + behaviourally consistent (no copy-paste).
 */
import { type CSSProperties, type ReactNode } from 'react';

const ON = '#1FB6D6'; // azure — capture live
const OFF = '#ff8800'; // amber — capture off

export interface MediaToggleProps {
  /** True when the capture is live (on). */
  enabled: boolean;
  /** Disable the control (e.g. before the avatar link is up). */
  disabled?: boolean;
  onToggle: () => void;
  /** Glyph shown when on / off (decorative — `aria-hidden`). */
  glyphOn: ReactNode;
  glyphOff: ReactNode;
  /** Visible text shown when on / off. */
  labelOn: string;
  labelOff: string;
  /** Accessible action label ("Mute microphone" / "Unmute microphone"). */
  ariaLabelOn: string;
  ariaLabelOff: string;
}

function buttonStyle(enabled: boolean, disabled: boolean): CSSProperties {
  const color = disabled ? '#55565c' : enabled ? ON : OFF;
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

export function MediaToggle({
  enabled,
  disabled = false,
  onToggle,
  glyphOn,
  glyphOff,
  labelOn,
  labelOff,
  ariaLabelOn,
  ariaLabelOff,
}: MediaToggleProps) {
  return (
    <button
      type="button"
      style={buttonStyle(enabled, disabled)}
      aria-pressed={enabled}
      aria-label={enabled ? ariaLabelOn : ariaLabelOff}
      disabled={disabled}
      onClick={onToggle}
    >
      <span aria-hidden>{enabled ? glyphOn : glyphOff}</span>
      <span>{enabled ? labelOn : labelOff}</span>
    </button>
  );
}
