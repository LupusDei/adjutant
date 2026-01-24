/**
 * MobileAudioUnlock Component
 * Shows a prompt on mobile devices to enable audio playback.
 * Must be tapped by user to unlock audio (browser autoplay policy).
 */

import React, { useState, useEffect } from 'react';
import { useMobileAudio } from '../../hooks/useMobileAudio';

export interface MobileAudioUnlockProps {
  /** Optional class name */
  className?: string;
  /** Callback when audio is unlocked */
  onUnlock?: () => void;
}

/**
 * Mobile audio unlock banner.
 * Only shows on mobile devices when audio needs to be unlocked.
 */
export const MobileAudioUnlock: React.FC<MobileAudioUnlockProps> = ({
  className = '',
  onUnlock,
}) => {
  const { needsUnlock, unlock, isUnlocked } = useMobileAudio();
  const [dismissed, setDismissed] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Check if previously dismissed this session
  useEffect(() => {
    const wasDismissed = sessionStorage.getItem('audio-unlock-dismissed');
    if (wasDismissed === 'true') {
      setDismissed(true);
    }
  }, []);

  // Don't show if not needed, already unlocked, or dismissed
  if (!needsUnlock || isUnlocked || dismissed) {
    return null;
  }

  const handleUnlock = async () => {
    setUnlocking(true);
    const success = await unlock();
    setUnlocking(false);

    if (success) {
      onUnlock?.();
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('audio-unlock-dismissed', 'true');
  };

  return (
    <div className={`mobile-audio-unlock ${className}`} style={styles.container}>
      <div style={styles.content}>
        <span style={styles.icon}>🔊</span>
        <span style={styles.text}>Tap to enable audio notifications</span>
      </div>
      <div style={styles.buttons}>
        <button
          type="button"
          style={styles.unlockButton}
          onClick={handleUnlock}
          disabled={unlocking}
        >
          {unlocking ? 'ENABLING...' : 'ENABLE'}
        </button>
        <button
          type="button"
          style={styles.dismissButton}
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderBottom: '1px solid var(--crt-phosphor-dim, #00aa00)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.85rem',
    color: 'var(--crt-phosphor, #00ff00)',
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  icon: {
    fontSize: '1.2rem',
  },
  text: {
    letterSpacing: '0.03em',
  },
  buttons: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  unlockButton: {
    padding: '4px 12px',
    border: '2px solid var(--crt-phosphor, #00ff00)',
    borderRadius: '2px',
    background: 'transparent',
    color: 'var(--crt-phosphor, #00ff00)',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  },
  dismissButton: {
    padding: '4px 8px',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    borderRadius: '2px',
    background: 'transparent',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
};

export default MobileAudioUnlock;
