/**
 * MCP Persona Tools for Adjutant.
 *
 * Provides the create_persona tool that agents call during their genesis ritual
 * to self-generate a persona with trait allocations.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentBySession } from "../mcp-server.js";
import { getEventBus } from "../event-bus.js";
import { logInfo, logWarn } from "../../utils/index.js";
import type { PersonaService } from "../persona-service.js";
import {
  TraitValuesSchema,
  POINT_BUDGET,
  TRAIT_MIN,
  TRAIT_MAX,
  sumTraits,
  type TraitValues,
} from "../../types/personas.js";

// ============================================================================
// Helpers
// ============================================================================

function resolveAgent(extra: { sessionId?: string }): string | undefined {
  if (!extra.sessionId) return undefined;
  return getAgentBySession(extra.sessionId);
}

function jsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register persona MCP tools on the given server.
 */
export function registerPersonaTools(
  server: McpServer,
  personaService: PersonaService,
): void {
  // --------------------------------------------------------------------------
  // create_persona
  // --------------------------------------------------------------------------
  server.tool(
    "create_persona",
    "Create your persona with trait allocations during genesis. Allocate exactly 100 points across 12 traits (0-20 each).",
    {
      callsign: z.string().describe("Your callsign (agent name)"),
      name: z
        .string()
        .min(1)
        .max(64)
        .describe("Display name for your persona"),
      description: z
        .string()
        .max(500)
        .default("")
        .describe("Brief description of your persona's role and personality"),
      traits: z.object({
        architecture_focus: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        product_design: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        uiux_focus: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        qa_scalability: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        qa_correctness: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        testing_unit: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        testing_acceptance: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        modular_architecture: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        business_objectives: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        technical_depth: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        code_review: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
        documentation: z.number().int().min(TRAIT_MIN).max(TRAIT_MAX),
      }).describe("Trait allocations (12 traits, 0-20 each, must sum to exactly 100)"),
    },
    async ({ callsign, name, description, traits }, extra) => {
      const agentId = resolveAgent(extra);
      if (!agentId) {
        return errorResult("Unknown agent: session not found");
      }

      // Validate exact sum of 100
      const total = sumTraits(traits as TraitValues);
      if (total !== POINT_BUDGET) {
        return errorResult(
          `Total trait points must equal exactly ${POINT_BUDGET}, got ${total}`,
        );
      }

      try {
        // Validate traits via Zod schema
        TraitValuesSchema.parse(traits);

        // Create the persona with source='self-generated'
        const persona = personaService.createPersona({
          name,
          description,
          traits: traits as TraitValues,
        });

        // Update source to 'self-generated' (createPersona defaults to hand-crafted via migration)
        // We set source via direct DB update through the service
        personaService.updatePersonaSource?.(persona.id, "self-generated");

        // Link callsign to persona
        personaService.linkCallsignPersona(callsign, persona.id);

        // Emit persona:created event
        getEventBus().emit("persona:created", {
          personaId: persona.id,
          personaName: persona.name,
          callsign,
          source: "self-generated",
        });

        logInfo("create_persona: persona created via genesis", {
          agentId,
          callsign,
          personaId: persona.id,
          personaName: persona.name,
        });

        return jsonResult({
          success: true,
          personaId: persona.id,
          personaName: persona.name,
          callsign,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Race condition guard (adj-158.6.2): If creation failed, check if
        // another agent already created a persona for this callsign concurrently
        const existingPersona = personaService.getPersonaByCallsign(callsign);
        if (existingPersona) {
          logInfo("create_persona: callsign already has persona (race condition)", {
            agentId,
            callsign,
            existingPersonaId: existingPersona.id,
          });
          return jsonResult({
            success: true,
            personaId: existingPersona.id,
            personaName: existingPersona.name,
            callsign,
            note: "Persona already existed for this callsign",
          });
        }

        logWarn("create_persona: failed", { agentId, callsign, error: message });
        return errorResult(message);
      }
    },
  );
}
