/**
 * ModeContext - Provides deployment mode state across the app.
 *
 * Fetches initial mode from GET /api/mode and listens for SSE mode_changed
 * events so the UI reacts to runtime mode switches in real time.
 *
 * Exposes: mode, features, availableModes, loading, error, switchMode(), hasFeature()
 */

import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import { useSSE } from '../hooks/useSSE';
import type { SSEHandler } from '../hooks/useSSE';

// ============================================================================
// Types
// ============================================================================

export type DeploymentMode = 'gastown' | 'standalone' | 'swarm' | 'unknown';

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
  /** Modes that can be switched to */
  availableModes: AvailableMode[];
  /** Whether initial mode fetch is in progress */
  loading: boolean;
  /** Error from mode fetch or switch */
  error: string | null;
  /** Whether this is a Gas Town deployment */
  isGasTown: boolean;
  /** Whether power control is available */
  hasPowerControl: boolean;
  /** Check if a feature is available in the current mode */
  hasFeature: (feature: string) => boolean;
  /** Switch to a different deployment mode at runtime */
  switchMode: (newMode: DeploymentMode) => Promise<boolean>;
}

// ============================================================================
// Context
// ============================================================================

const ModeContext = createContext<ModeContextValue | null>(null);

const API_BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

// ============================================================================
// Provider
// ============================================================================

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DeploymentMode>('unknown');
  const [features, setFeatures] = useState<string[]>([]);
  const [availableModes, setAvailableModes] = useState<AvailableMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial mode from backend
  const fetchMode = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/mode`);
      if (!response.ok) {
        // Fallback: if /api/mode doesn't exist, assume gastown (legacy)
        setMode('gastown');
        setFeatures([
          'power_control', 'rigs', 'epics', 'crew_hierarchy',
          'mail', 'dashboard', 'refinery', 'witness', 'websocket', 'sse',
        ]);
        return;
      }

      const json = await response.json() as {
        success: boolean;
        data?: {
          mode: DeploymentMode;
          features: string[];
          availableModes: AvailableMode[];
        };
      };

      if (json.success && json.data) {
        setMode(json.data.mode);
        setFeatures(json.data.features);
        setAvailableModes(json.data.availableModes);
      }
    } catch (err) {
      console.warn('Failed to fetch mode, assuming gastown:', err);
      setMode('gastown');
      setFeatures([
        'power_control', 'rigs', 'epics', 'crew_hierarchy',
        'mail', 'dashboard', 'refinery', 'witness', 'websocket', 'sse',
      ]);
      setError(err instanceof Error ? err.message : 'Failed to fetch mode');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMode();
  }, [fetchMode]);

  // SSE listener: update mode when backend emits mode_changed
  const handleModeChanged: SSEHandler = useCallback((data) => {
    const newMode = data['mode'] as DeploymentMode | undefined;
    const newFeatures = data['features'] as string[] | undefined;

    if (newMode) setMode(newMode);
    if (newFeatures) setFeatures(newFeatures);
    setError(null);
  }, []);

  const sseEvents = useMemo(() => ({
    mode_changed: handleModeChanged,
  }), [handleModeChanged]);

  useSSE({ events: sseEvents, enabled: !loading });

  // Switch mode via POST /api/mode
  const switchMode = useCallback(async (newMode: DeploymentMode): Promise<boolean> => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE_URL}/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });

      const json = await response.json() as {
        success: boolean;
        data?: {
          mode: DeploymentMode;
          features: string[];
          availableModes: AvailableMode[];
        };
        error?: { message: string };
      };

      if (!json.success) {
        setError(json.error?.message ?? 'Failed to switch mode');
        return false;
      }

      // Update local state immediately (SSE will also confirm)
      if (json.data) {
        setMode(json.data.mode);
        setFeatures(json.data.features);
        setAvailableModes(json.data.availableModes);
      }

      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to switch mode';
      setError(msg);
      return false;
    }
  }, []);

  const hasFeature = useCallback((feature: string): boolean => {
    return features.includes(feature);
  }, [features]);

  const value = useMemo<ModeContextValue>(() => ({
    mode,
    features,
    availableModes,
    loading,
    error,
    isGasTown: mode === 'gastown',
    hasPowerControl: features.includes('power_control'),
    hasFeature,
    switchMode,
  }), [mode, features, availableModes, loading, error, hasFeature, switchMode]);

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
 * Access the mode context. Must be used within a ModeProvider.
 */
export function useModeContext(): ModeContextValue {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error('useModeContext must be used within a ModeProvider');
  }
  return context;
}
