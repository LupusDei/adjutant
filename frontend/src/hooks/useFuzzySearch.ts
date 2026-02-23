import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

/** Result of a fuzzy match with indices for highlighting. */
export interface FuzzyMatchResult {
  /** Whether the item matches */
  matches: boolean;
  /** Score (higher = better match, 0 = no match) */
  score: number;
  /** Indices of matching characters in the original string */
  matchIndices: number[];
}

/**
 * Performs fuzzy matching: checks if query characters appear in order within target.
 * Returns match result with character indices for highlighting.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult {
  if (!query) {
    return { matches: true, score: 0, matchIndices: [] };
  }

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  const matchIndices: number[] = [];
  let queryIdx = 0;
  let score = 0;
  let consecutiveBonus = 0;

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      matchIndices.push(i);
      // Bonus for consecutive matches
      score += 1 + consecutiveBonus;
      consecutiveBonus += 0.5;
      // Bonus for match at start of word
      if (i === 0 || /\s|[-_/]/.test(target[i - 1])) {
        score += 2;
      }
      queryIdx++;
    } else {
      consecutiveBonus = 0;
    }
  }

  const matches = queryIdx === queryLower.length;
  // Penalize longer targets (prefer shorter matches)
  if (matches) {
    score = score / (1 + targetLower.length * 0.1);
  }

  return { matches, score: matches ? score : 0, matchIndices };
}

/**
 * Matches a query against multiple fields, returning the best match.
 */
export function fuzzyMatchFields(
  query: string,
  fields: (string | null | undefined)[]
): { matches: boolean; score: number; fieldIndex: number; matchIndices: number[] } {
  if (!query) {
    return { matches: true, score: 0, fieldIndex: -1, matchIndices: [] };
  }

  let bestResult = { matches: false, score: 0, fieldIndex: -1, matchIndices: [] as number[] };

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;

    const result = fuzzyMatch(query, field);
    if (result.matches && result.score > bestResult.score) {
      bestResult = { ...result, fieldIndex: i };
    }
  }

  return bestResult;
}

export interface UseFuzzySearchOptions {
  /** Debounce delay in ms. Default: 150 */
  debounceMs?: number;
}

export interface UseFuzzySearchResult<T> {
  /** Current search query (debounced) */
  query: string;
  /** Raw input value (for controlled input) */
  inputValue: string;
  /** Filtered items */
  results: T[];
  /** Update the search input */
  setInputValue: (value: string) => void;
  /** Clear the search */
  clear: () => void;
  /** Whether search is active (non-empty query) */
  isSearching: boolean;
}

/**
 * Hook for fuzzy searching through items with debounced input.
 *
 * @param items - Array of items to search through
 * @param getSearchFields - Function to extract searchable fields from an item
 * @param options - Search options
 */
export function useFuzzySearch<T>(
  items: T[],
  getSearchFields: (item: T) => (string | null | undefined)[],
  options: UseFuzzySearchOptions = {}
): UseFuzzySearchResult<T> {
  const { debounceMs = 150 } = options;

  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce input changes
  useEffect(() => {
    clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      setDebouncedQuery(inputValue.trim());
    }, debounceMs);

    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, [inputValue, debounceMs]);

  // Filter and sort items
  const results = useMemo(() => {
    if (!debouncedQuery) {
      return items;
    }

    const scored: { item: T; score: number }[] = [];

    for (const item of items) {
      const fields = getSearchFields(item);
      const match = fuzzyMatchFields(debouncedQuery, fields);

      if (match.matches) {
        scored.push({ item, score: match.score });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => s.item);
  }, [items, debouncedQuery, getSearchFields]);

  const clear = useCallback(() => {
    setInputValue('');
    setDebouncedQuery('');
  }, []);

  return {
    query: debouncedQuery,
    inputValue,
    results,
    setInputValue,
    clear,
    isSearching: debouncedQuery.length > 0,
  };
}
