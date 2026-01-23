/**
 * MasterMuteToggle Component - T043 [US3]
 * Pip-Boy themed global audio mute toggle for header
 */
import React from 'react';
import './voice.css';

export interface MasterMuteToggleProps {
  /** Whether audio is muted */
  isMuted: boolean;
  /** Callback when mute state changes */
  onToggle: () => void;
  /** Whether the toggle is disabled */
  disabled?: boolean;
  /** Optional class name */
  className?: string;
  /** Show label text */
  showLabel?: boolean;
}

/**
 * Master mute toggle button for global audio control.
 * Displays in the PipBoyFrame header.
 */
export const MasterMuteToggle: React.FC<MasterMuteToggleProps> = ({
  isMuted,
  onToggle,
  disabled = false,
  className = '',
  showLabel = false,
}) => {
  return (
    <button
      type="button"
      className={`master-mute-toggle ${isMuted ? 'master-mute-toggle-muted' : ''} ${className}`}
      onClick={onToggle}
      disabled={disabled}
      aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
      title={isMuted ? 'Unmute audio notifications' : 'Mute audio notifications'}
    >
      <span className="master-mute-icon">
        {isMuted ? '🔇' : '🔊'}
      </span>
      {showLabel && (
        <span className="master-mute-label">
          {isMuted ? 'MUTED' : 'AUDIO'}
        </span>
      )}
    </button>
  );
};

export default MasterMuteToggle;
