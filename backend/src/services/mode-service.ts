/**
 * Mode service for Adjutant.
 *
 * Manages runtime deployment mode switching between gastown, standalone, and swarm.
 * Validates mode transitions and swaps workspace/topology/transport providers.
 */

import { getWorkspace, resetWorkspace, getDeploymentMode, type DeploymentMode } from "./workspace/index.js";
import { resetTopology } from "./topology/index.js";
import { resetTransport } from "./transport/index.js";
import { isGasTownEnvironment, isGasTownAvailable } from "./workspace/gastown-provider.js";
import { getEventBus } from "./event-bus.js";
import { logInfo } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export interface ModeInfo {
  /** Current deployment mode */
  mode: DeploymentMode;
  /** Features available in this mode */
  features: string[];
  /** Available modes that can be switched to */
  availableModes: Array<{
    mode: DeploymentMode;
    available: boolean;
    reason?: string;
  }>;
}

export interface ModeServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Feature Maps
// ============================================================================

const MODE_FEATURES: Record<DeploymentMode, string[]> = {
  gastown: [
    "power_control",
    "rigs",
    "epics",
    "crew_hierarchy",
    "mail",
    "dashboard",
    "refinery",
    "witness",
    "websocket",
    "sse",
  ],
  standalone: [
    "chat",
    "beads",
    "websocket",
    "sse",
  ],
  swarm: [
    "chat",
    "crew_flat",
    "beads",
    "mail",
    "websocket",
    "sse",
  ],
};

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get current mode info including features and available transitions.
 */
export function getModeInfo(): ModeInfo {
  const currentMode = getDeploymentMode();
  const gtAvailable = isGasTownAvailable();

  return {
    mode: currentMode,
    features: MODE_FEATURES[currentMode] ?? [],
    availableModes: [
      {
        mode: "gastown",
        available: gtAvailable,
        ...(!gtAvailable && { reason: "Gas Town infrastructure not detected (no mayor/town.json)" }),
      },
      {
        mode: "standalone",
        available: true,
      },
      {
        mode: "swarm",
        available: true,
      },
    ],
  };
}

/**
 * Switch to a new deployment mode at runtime.
 * Validates the transition and swaps all provider singletons.
 */
export function switchMode(newMode: DeploymentMode): ModeServiceResult<ModeInfo> {
  const currentMode = getDeploymentMode();

  // No-op if already in the target mode
  if (currentMode === newMode) {
    return {
      success: true,
      data: getModeInfo(),
    };
  }

  // Validate transition
  if (newMode === "gastown" && !isGasTownAvailable()) {
    return {
      success: false,
      error: {
        code: "MODE_UNAVAILABLE",
        message: "Cannot switch to Gas Town mode: infrastructure not detected (no mayor/town.json)",
      },
    };
  }

  const validModes: DeploymentMode[] = ["gastown", "standalone", "swarm"];
  if (!validModes.includes(newMode)) {
    return {
      success: false,
      error: {
        code: "INVALID_MODE",
        message: `Invalid mode: ${newMode}. Valid modes: ${validModes.join(", ")}`,
      },
    };
  }

  // Set env var so providers pick up the new mode on re-creation
  process.env["ADJUTANT_MODE"] = newMode;

  // Reset all provider singletons so they re-detect on next access
  resetWorkspace();
  resetTopology();
  resetTransport();

  // Force re-initialization by accessing the workspace
  getWorkspace();

  logInfo("mode switched", { from: currentMode, to: newMode });

  const modeInfo = getModeInfo();

  // Emit mode:changed event for SSE/WebSocket consumers
  getEventBus().emit("mode:changed", {
    mode: newMode,
    features: modeInfo.features,
    reason: `Switched from ${currentMode}`,
  });

  return {
    success: true,
    data: modeInfo,
  };
}
