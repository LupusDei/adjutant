import { useState, useEffect, useCallback, useRef } from 'react';

/** Detect iOS (iPhone/iPad) including iPadOS which reports as Mac */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod') ||
    (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/**
 * Hook that tracks iOS virtual keyboard visibility using the Visual Viewport API.
 * Also provides a swipe-down gesture handler that dismisses the keyboard.
 *
 * Returns:
 * - isKeyboardOpen: whether the iOS keyboard is currently visible
 * - dismissKeyboard: function to programmatically dismiss the keyboard
 * - isIOS: whether the current device is iOS
 */
export function useIOSKeyboard() {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const ios = useRef(isIOS());
  const touchStartY = useRef<number | null>(null);

  const dismissKeyboard = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  // Track keyboard via visualViewport resize
  useEffect(() => {
    if (!ios.current || !window.visualViewport) return;

    const viewport = window.visualViewport;
    // Threshold: if viewport height shrinks by >150px from window height, keyboard is up
    const checkKeyboard = () => {
      const heightDiff = window.innerHeight - viewport.height;
      setIsKeyboardOpen(heightDiff > 150);
    };

    viewport.addEventListener('resize', checkKeyboard);
    return () => { viewport.removeEventListener('resize', checkKeyboard); };
  }, []);

  // Swipe-down gesture to dismiss keyboard
  useEffect(() => {
    if (!ios.current) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (!isKeyboardOpen) return;
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isKeyboardOpen || touchStartY.current === null) return;
      const deltaY = e.touches[0].clientY - touchStartY.current;
      // Swipe down 60px+ dismisses keyboard
      if (deltaY > 60) {
        dismissKeyboard();
        touchStartY.current = null;
      }
    };

    const handleTouchEnd = () => {
      touchStartY.current = null;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isKeyboardOpen, dismissKeyboard]);

  return { isKeyboardOpen, dismissKeyboard, isIOS: ios.current };
}
