/**
 * Prompt Generator — generates persona-specific system prompts from trait values.
 *
 * This is a minimal stub for spawn integration (Phase 4).
 * The full implementation (Phase 3, adj-033.3) will replace this with
 * tiered prompt generation based on trait intensity levels.
 */

import type { Persona } from "../types/personas.js";
import { TRAIT_DEFINITIONS } from "../types/personas.js";

/**
 * Generate a persona prompt from trait values.
 *
 * Produces a structured prompt that describes the persona's behavioral
 * characteristics based on its trait allocations. Traits with 0 points
 * are omitted. Higher-value traits get stronger emphasis.
 *
 * @param persona - The persona to generate a prompt for
 * @returns A string prompt suitable for --prompt CLI injection
 */
export function generatePersonaPrompt(persona: Persona): string {
  const lines: string[] = [];

  lines.push(`You are ${persona.name}.`);

  if (persona.description) {
    lines.push(persona.description);
  }

  lines.push("");
  lines.push("Your behavioral characteristics:");

  // Sort traits by value descending, skip zero-value traits
  const activeTraits = TRAIT_DEFINITIONS
    .filter((def) => persona.traits[def.key] > 0)
    .sort((a, b) => persona.traits[b.key] - persona.traits[a.key]);

  for (const def of activeTraits) {
    const value = persona.traits[def.key];
    const intensity = value >= 15 ? "HIGH" : value >= 8 ? "MEDIUM" : "LOW";
    lines.push(`- ${def.label} [${intensity}]: ${def.description}`);
  }

  if (activeTraits.length === 0) {
    lines.push("- No specific specializations defined.");
  }

  return lines.join("\n");
}
