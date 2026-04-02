/**
 * MCP Persona Tools for Adjutant.
 *
 * Provides evolve_persona tool that agents call via MCP to adjust
 * their persona trait allocations within controlled bounds.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getPersonaService } from "../persona-service.js";
import { EVOLUTION_MAX_DELTA } from "../../types/personas.js";

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register persona-related MCP tools on the server.
 */
export function registerPersonaTools(server: McpServer): void {
  // --------------------------------------------------------------------------
  // evolve_persona
  // --------------------------------------------------------------------------
  server.tool(
    "evolve_persona",
    "Evolve a persona's traits by applying small adjustments (max +/-2 per trait). Total must remain exactly 100.",
    {
      personaId: z.string().describe("The persona ID to evolve"),
      adjustments: z
        .record(z.string(), z.number().int().min(-EVOLUTION_MAX_DELTA).max(EVOLUTION_MAX_DELTA))
        .describe(
          `Object mapping trait names to delta values (each between -${EVOLUTION_MAX_DELTA} and +${EVOLUTION_MAX_DELTA})`,
        ),
    },
    async ({ personaId, adjustments }) => {
      const service = getPersonaService();
      if (!service) {
        return {
          content: [{ type: "text" as const, text: "Persona service not initialized" }],
          isError: true,
        };
      }

      try {
        const updated = service.evolvePersona(personaId, adjustments);

        if (updated === null) {
          return {
            content: [{ type: "text" as const, text: `Persona '${personaId}' not found` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                personaId: updated.id,
                name: updated.name,
                traits: updated.traits,
                updatedAt: updated.updatedAt,
              }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to evolve persona";
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    },
  );
}
