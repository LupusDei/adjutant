/**
 * ScreenShareToggle (adj-202.5.2) — screen-share control + state indicator in
 * the panel chrome. Lets the Commander share a screen/surface into the Bridge
 * session. A thin preset over MediaToggle; BridgePanel relays the command to the
 * avatar iframe, which publishes a LiveKit ScreenShare track via the SDK.
 */
import { MediaToggle } from './MediaToggle';

export interface ScreenShareToggleProps {
  /** True when a screen is being shared. */
  enabled: boolean;
  /** Disable the control (e.g. before the avatar link is up). */
  disabled?: boolean;
  onToggle: () => void;
}

export function ScreenShareToggle({ enabled, disabled = false, onToggle }: ScreenShareToggleProps) {
  return (
    <MediaToggle
      enabled={enabled}
      disabled={disabled}
      onToggle={onToggle}
      glyphOn="🖥"
      glyphOff="🖥"
      labelOn="Sharing"
      labelOff="Share screen"
      ariaLabelOn="Stop sharing screen"
      ariaLabelOff="Share screen"
    />
  );
}
