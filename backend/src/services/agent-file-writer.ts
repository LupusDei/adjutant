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
 * Write persona prompt to .claude/agents/<sanitized-name>.md in the target project.
 *
 * Creates the .claude/agents/ directory if it doesn't exist.
 * Overwrites any existing file at that path (idempotent).
 *
 * @param projectPath - Absolute path to the target project directory
 * @param personaName - The persona's display name (will be sanitized)
 * @param promptText - The full persona prompt markdown to write
 * @returns The sanitized name used for the file (without .md extension)
 */
export async function writeAgentFile(
  projectPath: string,
  personaName: string,
  promptText: string,
): Promise<string> {
  const name = sanitizePersonaName(personaName);
  const agentsDir = join(projectPath, ".claude", "agents");

  await mkdir(agentsDir, { recursive: true });
  await writeFile(join(agentsDir, `${name}.md`), promptText, "utf-8");

  return name;
}
