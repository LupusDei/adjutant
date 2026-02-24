import React from 'react';
import { useIOSKeyboard } from '../../hooks/useIOSKeyboard';

/**
 * Floating keyboard dismiss button for iOS.
 * Renders a small "DONE" button above the keyboard when it's open.
 * Also enables swipe-down gesture to dismiss (handled by the hook).
 * Only renders on iOS devices — no-op on desktop/Android.
 */
export const KeyboardDismiss: React.FC = () => {
  const { isKeyboardOpen, dismissKeyboard, isIOS } = useIOSKeyboard();

  if (!isIOS || !isKeyboardOpen) return null;

  return (
    <button
      type="button"
      onClick={dismissKeyboard}
      className="keyboard-dismiss-btn"
      aria-label="Dismiss keyboard"
    >
      DONE
    </button>
  );
};
