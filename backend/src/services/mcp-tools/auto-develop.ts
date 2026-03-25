/**
 * MCP tools for auto-develop toggle and vision context management.
 *
 * Provides enable_auto_develop, disable_auto_develop, and provide_vision_update
 * tools that agents use to control the auto-develop loop for their project.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getAgentBySession, getProjectContextBySession } from "../mcp-server.js";
import {
  enableAutoDevelop,
  disableAutoDevelop,
  setVisionContext,
  clearAutoDevelopPause,
} from "../projects-service.js";
import { getEventBus } from "../event-bus.js";
import { logInfo } from "../../utils/index.js";

export function registerAutoDevelopTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // enable_auto_develop
  // ---------------------------------------------------------------------------
  server.tool(
    "enable_auto_develop",
    {
      visionContext: z.string().max(10000).optional().describe("Optional vision/direction context to guide proposal generation"),
    },
    async ({ visionContext }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot enable auto-develop" }) }],
        };
      }

      const result = enableAutoDevelop(projectContext.projectId);
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error?.message ?? "Failed to enable auto-develop" }) }],
        };
      }

      // Set vision context if provided
      if (visionContext !== undefined) {
        const visionResult = setVisionContext(projectContext.projectId, visionContext);
        if (!visionResult.success) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: visionResult.error?.message ?? "Failed to set vision context" }) }],
          };
        }
      }

      // Emit event
      const enabledEvent: { projectId: string; projectName: string; visionContext?: string } = {
        projectId: projectContext.projectId,
        projectName: projectContext.projectName,
      };
      if (visionContext !== undefined) {
        enabledEvent.visionContext = visionContext;
      }
      getEventBus().emit("project:auto_develop_enabled", enabledEvent);

      logInfo("enable_auto_develop", { agentId, projectId: projectContext.projectId, hasVision: !!visionContext });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            projectId: projectContext.projectId,
            projectName: projectContext.projectName,
            autoDevelop: true,
            visionContext: visionContext ?? null,
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // disable_auto_develop
  // ---------------------------------------------------------------------------
  server.tool(
    "disable_auto_develop",
    {},
    async (_params, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot disable auto-develop" }) }],
        };
      }

      const result = disableAutoDevelop(projectContext.projectId);
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error?.message ?? "Failed to disable auto-develop" }) }],
        };
      }

      getEventBus().emit("project:auto_develop_disabled", {
        projectId: projectContext.projectId,
        projectName: projectContext.projectName,
      });

      logInfo("disable_auto_develop", { agentId, projectId: projectContext.projectId });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            projectId: projectContext.projectId,
            projectName: projectContext.projectName,
            autoDevelop: false,
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // provide_vision_update
  // ---------------------------------------------------------------------------
  server.tool(
    "provide_vision_update",
    {
      visionContext: z.string().min(1).max(10000).describe("Updated vision/direction for the project"),
    },
    async ({ visionContext }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      const projectContext = extra.sessionId ? getProjectContextBySession(extra.sessionId) : undefined;
      if (!projectContext) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No project context — cannot update vision" }) }],
        };
      }

      // Set the new vision context
      const visionResult = setVisionContext(projectContext.projectId, visionContext);
      if (!visionResult.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: visionResult.error?.message ?? "Failed to set vision context" }) }],
        };
      }

      // Clear pause — unpauses the auto-develop loop
      clearAutoDevelopPause(projectContext.projectId);

      // Emit enabled event to signal the loop to resume
      getEventBus().emit("project:auto_develop_enabled", {
        projectId: projectContext.projectId,
        projectName: projectContext.projectName,
        visionContext,
      });

      logInfo("provide_vision_update", { agentId, projectId: projectContext.projectId });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            projectId: projectContext.projectId,
            projectName: projectContext.projectName,
            visionContext,
            pauseCleared: true,
          }),
        }],
      };
    },
  );
}
