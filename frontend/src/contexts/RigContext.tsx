import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { extractRigName } from '../components/shared/RigBadge';

/**
 * Rig filter state and actions.
 */
export interface RigContextValue {
  /** Currently selected rig filter (null = all rigs) */
  selectedRig: string | null;
  /** List of available rigs */
  availableRigs: string[];
  /** Set the selected rig filter */
  setSelectedRig: (rig: string | null) => void;
  /** Update the list of available rigs */
  setAvailableRigs: (rigs: string[]) => void;
  /** Check if an item matches the current filter */
  matchesFilter: (rigOrAddress: string | null) => boolean;
}

const RigContext = createContext<RigContextValue | null>(null);

/**
 * Storage key for persisting rig selection.
 */
const STORAGE_KEY = 'gastown-boy-selected-rig';

/**
 * Provider component for rig filter state.
 */
export function RigProvider({ children }: { children: ReactNode }) {
  // Load initial state from localStorage (default to null = all rigs)
  const [selectedRig, setSelectedRigState] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) as string | null : null;
    } catch {
      return null;
    }
  });

  const [availableRigs, setAvailableRigsState] = useState<string[]>([]);

  // Persist selection to localStorage
  const setSelectedRig = useCallback((rig: string | null) => {
    setSelectedRigState(rig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rig));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const setAvailableRigs = useCallback((rigs: string[]) => {
    setAvailableRigsState(rigs);
  }, []);

  // Check if an item matches the current filter
  const matchesFilter = useCallback((rigOrAddress: string | null): boolean => {
    // If no filter selected OR rigs haven't loaded yet, everything matches
    // (prevents stale localStorage filter from hiding all content on startup)
    if (selectedRig === null || availableRigs.length === 0) return true;

    // Extract rig name from address if needed
    const itemRig = rigOrAddress?.includes('/')
      ? extractRigName(rigOrAddress)
      : rigOrAddress;

    return itemRig === selectedRig;
  }, [selectedRig, availableRigs.length]);

  const value = useMemo(() => ({
    selectedRig,
    availableRigs,
    setSelectedRig,
    setAvailableRigs,
    matchesFilter,
  }), [selectedRig, availableRigs, setSelectedRig, setAvailableRigs, matchesFilter]);

  return (
    <RigContext.Provider value={value}>
      {children}
    </RigContext.Provider>
  );
}

/**
 * Hook to access rig filter context.
 */
export function useRigFilter(): RigContextValue {
  const context = useContext(RigContext);
  if (!context) {
    throw new Error('useRigFilter must be used within a RigProvider');
  }
  return context;
}

/**
 * Hook to get filtered items based on rig selection.
 * @overload When getRig is provided, items can be any type
 * @overload When getRig is omitted, items must have a rig property
 */
export function useRigFilteredItems<T>(
  items: T[],
  getRig: (item: T) => string | null
): T[];
export function useRigFilteredItems<T extends { rig?: string | null }>(
  items: T[]
): T[];
export function useRigFilteredItems<T>(
  items: T[],
  getRig?: (item: T) => string | null
): T[] {
  const { matchesFilter } = useRigFilter();

  return useMemo(() => {
    return items.filter(item => {
      const rig = getRig ? getRig(item) : (item as { rig?: string | null }).rig ?? null;
      return matchesFilter(rig);
    });
  }, [items, matchesFilter, getRig]);
}

export default RigContext;
