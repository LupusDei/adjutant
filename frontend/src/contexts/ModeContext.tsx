/**
 * Mode context for app-wide deployment mode state.
 *
 * Fetches mode from GET /api/mode on mount and listens for SSE mode_changed
 * events to keep mode in sync across the app. Provides mode, features, and
 * helper flags to all components.
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { getApiKey } from '../services/api';

// ============================================================================
// Types
// ============================================================================

export type DeploymentMode = 'gastown' | 'swarm' | 'unknown';

export interface AvailableMode {
  mode: DeploymentMode;
  available: boolean;
  reason?: string;
}

export interface ModeContextValue {
  /** Current deployment mode */
  mode: DeploymentMode;
  /** Features available in the current mode */
  features: string[];
  /** Available modes and their transition availability */
  availableModes: AvailableMode[];
  /** Whether mode info is still loading */
  loading: boolean;
  /** Any error from fetching mode */
  error: string | null;
  /** Convenience: whether current mode is gastown */
  isGasTown: boolean;
  /** Convenience: whether current mode is swarm */
  isSwarm: boolean;
  /** Check if a feature is available in the current mode */
  hasFeature: (feature: string) => boolean;
  /** Switch to a different mode (calls POST /api/mode) */
  switchMode: (newMode: DeploymentMode) => Promise<boolean>;
}

// ============================================================================
// Context
// ============================================================================

const ModeContext = createContext<ModeContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface ModeApiResponse {
  success: boolean;
  data?: {
    mode: DeploymentMode;
    features: string[];
    availableModes: AvailableMode[];
  };
  error?: { code: string; message: string };
}

/** Build headers with API key auth if configured. */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const apiKey = getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DeploymentMode>('unknown');
  const [features, setFeatures] = useState<string[]>([]);
  const [availableModes, setAvailableModes] = useState<AvailableMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Apply mode info from API response
  const applyModeInfo = useCallback((data: { mode: DeploymentMode; features: string[]; availableModes?: AvailableMode[] }) => {
    setMode(data.mode);
    setFeatures(data.features);
    if (data.availableModes) {
      setAvailableModes(data.availableModes);
    }
    setError(null);
  }, []);

  // Fetch mode from backend
  const fetchMode = useCallback(async () => {
    try {
      const response = await fetch('/api/mode', { headers: authHeaders() });
      if (!response.ok) {
        // Endpoint doesn't exist - fall back to legacy detection via capabilities
        const capResponse = await fetch('/api/power/capabilities', { headers: authHeaders() });
        if (capResponse.ok) {
          const capData = await capResponse.json() as { success: boolean; data?: { canControl: boolean; autoStart: boolean } };
          if (capData.success && capData.data) {
            const detected = capData.data.canControl ? 'gastown' : 'swarm';
            applyModeInfo({ mode: detected, features: [] });
            return;
          }
        }
        // Ultimate fallback
        applyModeInfo({ mode: 'gastown', features: [] });
        return;
      }

      const result = await response.json() as ModeApiResponse;
      if (result.success && result.data) {
        applyModeInfo(result.data);
      } else {
        applyModeInfo({ mode: 'gastown', features: [] });
      }
    } catch (err) {
      console.warn('Failed to detect deployment mode, assuming gastown:', err);
      applyModeInfo({ mode: 'gastown', features: [] });
      setError(err instanceof Error ? err.message : 'Failed to detect mode');
    } finally {
      setLoading(false);
    }
  }, [applyModeInfo]);

  // Initial fetch
  useEffect(() => {
    void fetchMode();
  }, [fetchMode]);

  // Listen for SSE mode_changed events
  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource('/api/events');

      eventSource.addEventListener('mode_changed', (event) => {
        try {
          const data = JSON.parse(event.data as string) as { mode: DeploymentMode; features: string[]; action: string };
          applyModeInfo({ mode: data.mode, features: data.features });
        } catch {
          // Ignore parse errors
        }
      });

      eventSource.onerror = () => {
        // SSE disconnected - will auto-reconnect per browser behavior
        // Don't set error state since polling fallback works fine
      };
    } catch {
      // EventSource not supported or URL invalid - ignore
    }

    return () => {
      eventSource?.close();
    };
  }, [applyModeInfo]);

  // Switch mode via POST /api/mode
  const doSwitchMode = useCallback(async (newMode: DeploymentMode): Promise<boolean> => {
    try {
      const response = await fetch('/api/mode', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode: newMode }),
      });

      const result = await response.json() as ModeApiResponse;

      if (result.success && result.data) {
        applyModeInfo(result.data);
        return true;
      }

      setError(result.error?.message ?? 'Failed to switch mode');
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch mode');
      return false;
    }
  }, [applyModeInfo]);

  const hasFeature = useCallback((feature: string) => features.includes(feature), [features]);

  const value = useMemo<ModeContextValue>(() => ({
    mode,
    features,
    availableModes,
    loading,
    error,
    isGasTown: mode === 'gastown',
    isSwarm: mode === 'swarm',
    hasFeature,
    switchMode: doSwitchMode,
  }), [mode, features, availableModes, loading, error, hasFeature, doSwitchMode]);

  return (
    <ModeContext.Provider value={value}>
      {children}
    </ModeContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access the deployment mode context.
 * Must be used within a ModeProvider.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useMode(): ModeContextValue {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return context;
}

/**
 * Hook that returns the set of visible tab IDs for the current mode.
 *
 * Tab visibility rules (from AdjutantMode.md):
 * - GT Mode: all 7 tabs
 * - Swarm: chat, crew, epics, beads, settings
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useVisibleTabs(): Set<string> {
  const { mode } = useMode();

  return useMemo(() => {
    switch (mode) {
      case 'swarm':
        return new Set(['dashboard', 'chat', 'crew', 'epics', 'beads', 'timeline', 'proposals', 'settings']);
      case 'gastown':
      default:
        return new Set(['dashboard', 'mail', 'chat', 'epics', 'crew', 'beads', 'timeline', 'proposals', 'settings']);
    }
  }, [mode]);
}

export default ModeContext;
