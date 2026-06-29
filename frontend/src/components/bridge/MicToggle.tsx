/**
 * MicToggle (adj-202.3.7.2) — mic control + state indicator in the panel chrome.
 *
 * Spec US1 calls for a mic toggle the Commander can see and reach without diving
 * into the sandboxed avatar iframe. A thin preset over MediaToggle: `aria-pressed`
 * carries the mic state for assistive tech, and the visible glyph/label mirror
 * it. The actual mute/unmute is relayed by BridgePanel to the avatar iframe.
 */
import { MediaToggle } from './MediaToggle';

export interface MicToggleProps {
  /** True when the mic is live (unmuted). */
  enabled: boolean;
  /** Disable the control (e.g. before the avatar link is up). */
  disabled?: boolean;
  onToggle: () => void;
}

export function MicToggle({ enabled, disabled = false, onToggle }: MicToggleProps) {
  return (
    <MediaToggle
      enabled={enabled}
      disabled={disabled}
      onToggle={onToggle}
      glyphOn="🎙"
      glyphOff="🔇"
      labelOn="Mic on"
      labelOff="Mic off"
      ariaLabelOn="Mute microphone"
      ariaLabelOff="Unmute microphone"
    />
  );
}
