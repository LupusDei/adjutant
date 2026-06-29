/**
 * CameraToggle (adj-202.5.1) — front-camera control + state indicator in the
 * panel chrome. Lets the Commander turn their camera on/off for the two-way
 * Bridge link without diving into the sandboxed avatar iframe. A thin preset
 * over MediaToggle; the actual enable/disable is relayed by BridgePanel.
 */
import { MediaToggle } from './MediaToggle';

export interface CameraToggleProps {
  /** True when the camera is live (on). */
  enabled: boolean;
  /** Disable the control (e.g. before the avatar link is up). */
  disabled?: boolean;
  onToggle: () => void;
}

export function CameraToggle({ enabled, disabled = false, onToggle }: CameraToggleProps) {
  return (
    <MediaToggle
      enabled={enabled}
      disabled={disabled}
      onToggle={onToggle}
      glyphOn="📹"
      glyphOff="🚫"
      labelOn="Camera on"
      labelOff="Camera off"
      ariaLabelOn="Turn off camera"
      ariaLabelOff="Turn on camera"
    />
  );
}
