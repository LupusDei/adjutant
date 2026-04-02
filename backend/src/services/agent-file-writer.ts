/**
 * Agent File Writer — writes persona prompts as .claude/agents/<name>.md files.
 *
 * Used by spawn routes to deploy persona prompts as native Claude Code agent files,
 * enabling the `--agent <name>` CLI flag instead of paste-buffer injection.
 *
 * @module services/agent-file-writer
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

/**
 * Sanitize persona name to filesystem-safe kebab-case.
 *
 * Rules:
 * - Lowercase the entire string
 * - Convert spaces and underscores to hyphens
 * - Strip all characters that aren't alphanumeric or hyphens
 * - Collapse consecutive hyphens into one
 * - Trim leading/trailing hyphens
 * - Fall back to "agent" if the result is empty
 *
 * @example
 * sanitizePersonaName("QA Lead")    // "qa-lead"
 * sanitizePersonaName("C++_Expert") // "c-expert"
 * sanitizePersonaName("Sentinel")   // "sentinel"
 */
export function sanitizePersonaName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")       // spaces and underscores to hyphens
    .replace(/[^a-z0-9-]/g, "")    // strip non-alphanumeric, non-hyphen
    .replace(/-{2,}/g, "-")        // collapse consecutive hyphens
    .replace(/^-+|-+$/g, "");      // trim leading/trailing hyphens

  return sanitized.length > 0 ? sanitized : "agent";
}

/**
 * Build YAML frontmatter block required by Claude Code's --agent flag.
 *
 * Agent files in .claude/agents/ must start with YAML frontmatter
 * containing at minimum `name` and `description` fields for Claude Code
 * to recognize and load them.
 */
function buildFrontmatter(name: string, description: string): string {
  // Escape any quotes in the description for YAML safety
  const safeDesc = description.replace(/"/g, '\\"');
  return `---\nname: ${name}\ndescription: "${safeDesc}"\n---\n\n`;
}

/**
 * Write persona prompt to .claude/agents/<sanitized-name>.md in the target project.
 *
 * Creates the .claude/agents/ directory if it doesn't exist.
 * Overwrites any existing file at that path (idempotent).
 * Prepends YAML frontmatter required by Claude Code's --agent flag.
 *
 * @param projectPath - Absolute path to the target project directory
 * @param personaName - The persona's display name (will be sanitized)
 * @param promptText - The full persona prompt markdown to write
 * @param description - Short description of the agent (used in frontmatter)
 * @returns The sanitized name used for the file (without .md extension)
 */
export async function writeAgentFile(
  projectPath: string,
  personaName: string,
  promptText: string,
  description = "",
): Promise<string> {
  const name = sanitizePersonaName(personaName);
  const agentsDir = join(projectPath, ".claude", "agents");
  const frontmatter = buildFrontmatter(name, description || `Persona agent: ${personaName}`);

  await mkdir(agentsDir, { recursive: true });
  await writeFile(join(agentsDir, `${name}.md`), frontmatter + promptText, "utf-8");

  return name;
}
