/**
 * Hook for detecting deployment mode and adapting UI accordingly.
 *
 * Returns information about the current deployment mode:
 * - gastown: Full Gas Town infrastructure
 * - standalone: Single project without GT infrastructure
 * - swarm: Multi-agent standalone mode
 */

import { useState, useEffect, useCallback } from 'react';

export type DeploymentMode = 'gastown' | 'standalone' | 'swarm' | 'unknown';

export interface DeploymentModeInfo {
  /** Current deployment mode */
  mode: DeploymentMode;
  /** Whether power control is available */
  hasPowerControl: boolean;
  /** Whether the system auto-starts */
  autoStart: boolean;
  /** Whether this is a Gas Town deployment */
  isGasTown: boolean;
  /** Whether we're still loading mode info */
  loading: boolean;
  /** Any error that occurred */
  error: string | null;
}

/**
 * Hook to detect and track deployment mode.
 *
 * Uses the /api/power/capabilities endpoint to determine
 * what features are available in the current deployment.
 */
export function useDeploymentMode(): DeploymentModeInfo {
  const [mode, setMode] = useState<DeploymentMode>('unknown');
  const [hasPowerControl, setHasPowerControl] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCapabilities = useCallback(async () => {
    try {
      // Try to get power capabilities from the API
      const response = await fetch('/api/power/capabilities');
      if (!response.ok) {
        // If endpoint doesn't exist, assume Gas Town (legacy mode)
        setMode('gastown');
        setHasPowerControl(true);
        setAutoStart(false);
        return;
      }

      const data = await response.json() as {
        success: boolean;
        data?: {
          canControl: boolean;
          autoStart: boolean;
        };
      };

      if (data.success && data.data) {
        const { canControl, autoStart: isAutoStart } = data.data;
        setHasPowerControl(canControl);
        setAutoStart(isAutoStart);

        // Determine mode based on capabilities
        if (canControl) {
          setMode('gastown');
        } else if (isAutoStart) {
          setMode('standalone');
        } else {
          setMode('swarm');
        }
      }
    } catch (err) {
      // On error, assume Gas Town mode for backward compatibility
      console.warn('Failed to detect deployment mode, assuming gastown:', err);
      setMode('gastown');
      setHasPowerControl(true);
      setError(err instanceof Error ? err.message : 'Failed to detect mode');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCapabilities();
  }, [fetchCapabilities]);

  return {
    mode,
    hasPowerControl,
    autoStart,
    isGasTown: mode === 'gastown',
    loading,
    error,
  };
}

export default useDeploymentMode;
