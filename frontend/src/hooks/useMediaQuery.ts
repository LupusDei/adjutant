import { useState, useEffect } from 'react';

/**
 * Hook that tracks whether a CSS media query matches.
 * Updates automatically when the match changes (e.g., on resize).
 *
 * @param query - CSS media query string (e.g., "(max-width: 768px)")
 * @returns boolean indicating whether the query matches
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/**
 * Convenience hook for detecting mobile viewport.
 * Uses 640px breakpoint (common mobile threshold).
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 640px)');
}
