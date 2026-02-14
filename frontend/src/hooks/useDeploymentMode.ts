/**
 * Hook for detecting deployment mode and adapting UI accordingly.
 *
 * Returns information about the current deployment mode:
 * - gastown: Full Gas Town infrastructure
 * - standalone: Single project without GT infrastructure
 * - swarm: Multi-agent standalone mode
 *
 * Delegates to ModeContext for state. Kept for backward compatibility.
 */

import { useModeContext, type DeploymentMode } from '../contexts/ModeContext';

export type { DeploymentMode };

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
 * Now backed by ModeContext - requires ModeProvider ancestor.
 * Provides the same interface as the original hook for backward compatibility.
 */
export function useDeploymentMode(): DeploymentModeInfo {
  const { mode, hasPowerControl, loading, error, isGasTown, hasFeature } = useModeContext();

  return {
    mode,
    hasPowerControl,
    autoStart: mode === 'standalone' && !hasFeature('power_control'),
    isGasTown,
    loading,
    error,
  };
}

export default useDeploymentMode;
