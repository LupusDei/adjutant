/**
 * Genesis Prompt Builder — generates the prompt that tells a newly spawned agent
 * to create their persona via the create_persona MCP tool.
 *
 * Used during the spawn flow when a callsign has no linked persona yet.
 * The agent reads the prompt, allocates trait points informed by their lore
 * and assigned work, then calls create_persona to materialize their identity.
 *
 * @module services/adjutant/genesis-prompt
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TRAIT_DEFINITIONS, POINT_BUDGET, TRAIT_MIN, TRAIT_MAX } from "../../types/personas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to the StarCraft heroes lore file */
const LORE_FILE_PATH = join(__dirname, "..", "..", "data", "starcraft-heroes.md");

/**
 * Extract the lore entry for a specific callsign from the heroes markdown file.
 *
 * Searches for `### {Callsign}` header (case-insensitive) and returns the text
 * until the next `###` header, `## ` faction header, or end of file.
 *
 * @param callsign - The callsign to look up (e.g., "raynor", "Kerrigan")
 * @returns The lore text for the callsign, or empty string if not found
 */
export function extractLoreExcerpt(callsign: string): string {
  let content: string;
  try {
    content = readFileSync(LORE_FILE_PATH, "utf-8");
  } catch {
    return "";
  }

  // Find the ### header for this callsign (case-insensitive)
  const headerPattern = new RegExp(
    `^### ${escapeRegex(callsign)}\\s*$`,
    "im",
  );
  const match = headerPattern.exec(content);
  if (!match) return "";

  // Extract from after the header to the next ### or ## or end
  const startIdx = match.index + match[0].length;
  const rest = content.slice(startIdx);

  // Find the next section header (### or ##)
  const nextHeader = /^#{2,3}\s/m.exec(rest);
  const excerpt = nextHeader
    ? rest.slice(0, nextHeader.index)
    : rest;

  return excerpt.trim();
}

/**
 * Build the genesis prompt for an agent that needs to create their persona.
 *
 * The prompt instructs the agent to:
 * 1. Understand their callsign identity from lore
 * 2. Review the 12 trait dimensions
 * 3. Allocate exactly 100 points (0-20 per trait)
 * 4. Call the create_persona MCP tool
 * 5. Proceed with assigned work
 *
 * @param callsign - The agent's StarCraft callsign
 * @param loreExcerpt - The lore text for this callsign
 * @param assignedWork - Optional description of the work assigned to this agent
 * @returns The complete genesis prompt as a string
 */
export function buildGenesisPrompt(
  callsign: string,
  loreExcerpt: string,
  assignedWork?: string,
): string {
  const sections: string[] = [];

  // Identity declaration
  sections.push(`## Genesis Ritual: Define Your Persona`);
  sections.push(
    `You are **${callsign}**. Before beginning any work, you must define your persona by allocating trait points.`,
  );

  // Lore excerpt
  if (loreExcerpt.length > 0) {
    sections.push(`### Your Lore\n\n${loreExcerpt}`);
  }

  // Trait definitions
  const traitList = TRAIT_DEFINITIONS.map(
    (t) => `- \`${t.key}\` — ${t.label}: ${t.description}`,
  ).join("\n");
  sections.push(
    `### The 12 Traits\n\nAllocate exactly **${POINT_BUDGET} points** across these 12 traits (${TRAIT_MIN}-${TRAIT_MAX} each):\n\n${traitList}`,
  );

  // Allocation guidance
  sections.push(
    `### Allocation Guidance\n\nYour allocation should reflect both your character lore and the work you've been assigned. Higher points in a trait mean stronger behavioral emphasis in that dimension.`,
  );

  if (assignedWork) {
    sections.push(
      `### Your Assigned Work\n\n${assignedWork}\n\nConsider this when allocating your traits — emphasize traits relevant to your task.`,
    );
  }

  // Tool call instruction
  sections.push(
    `### Action Required\n\nCall the **create_persona** MCP tool with:\n- \`callsign\`: "${callsign}"\n- \`name\`: A display name for your persona\n- \`description\`: A brief description of your role and personality\n- \`traits\`: Your 12 trait allocations (must sum to exactly ${POINT_BUDGET})\n\nThen proceed with your assigned work.`,
  );

  return sections.join("\n\n");
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
