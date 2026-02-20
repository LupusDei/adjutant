/**
 * SwarmStatusProvider - StatusProvider implementation for swarm deployments.
 *
 * Provides simple status for swarm mode:
 * - Always "running" power state (no power control)
 * - No infrastructure agents
 * - No rig hierarchy
 * - Simple agent list from beads
 */

import { basename } from "path";
import { resolveWorkspaceRoot, loadWorkspaceConfig } from "../workspace/index.js";
import { getAgents } from "../agents-service.js";
import type { CrewMember } from "../../types/index.js";
import type {
  StatusProvider,
  StatusResult,
  SystemStatus,
  PowerCapabilities,
  PowerTransitionResult,
} from "./status-provider.js";

// ============================================================================
// SwarmStatusProvider
// ============================================================================

/**
 * StatusProvider implementation for swarm deployments.
 *
 * In swarm mode:
 * - Power state is always "running" (no gt binary to control)
 * - No power control capabilities
 * - No infrastructure agents
 * - No rig hierarchy
 */
export class SwarmStatusProvider implements StatusProvider {
  readonly name = "swarm";

  getPowerCapabilities(): PowerCapabilities {
    return {
      canControl: false,
      autoStart: true,
    };
  }

  hasPowerControl(): boolean {
    return false;
  }

  async getStatus(): Promise<StatusResult<SystemStatus>> {
    try {
      const workspaceRoot = resolveWorkspaceRoot();
      const config = await loadWorkspaceConfig();
      const workspaceName = config.name ?? basename(workspaceRoot);

      // Get agents from beads
      const agentsResult = await getAgents();
      const crewMembers: CrewMember[] = agentsResult.success && agentsResult.data ? agentsResult.data : [];

      // In swarm mode, count user's unread mail
      // For now, assume 0 since we don't have a specific user mailbox
      const unreadMail = 0;

      const status: SystemStatus = {
        // Always running in swarm mode
        powerState: "running",
        powerCapabilities: this.getPowerCapabilities(),
        workspace: {
          name: workspaceName,
          root: workspaceRoot,
        },
        operator: {
          name: config.owner?.name ?? "User",
          email: config.owner?.email ?? "",
          unreadMail,
        },
        // No rigs in swarm mode
        rigs: [],
        agents: crewMembers,
        fetchedAt: new Date().toISOString(),
      };

      return { success: true, data: status };
    } catch (err) {
      return {
        success: false,
        error: {
          code: "STATUS_ERROR",
          message: err instanceof Error ? err.message : "Failed to get status",
        },
      };
    }
  }

  async powerUp(): Promise<StatusResult<PowerTransitionResult>> {
    return {
      success: false,
      error: {
        code: "NOT_SUPPORTED",
        message: "Power control is not available in swarm mode",
      },
    };
  }

  async powerDown(): Promise<StatusResult<PowerTransitionResult>> {
    return {
      success: false,
      error: {
        code: "NOT_SUPPORTED",
        message: "Power control is not available in swarm mode",
      },
    };
  }
}
