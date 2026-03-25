/**
 * Quality file template registry.
 *
 * Provides a manifest of quality-gate files (testing rules, code review
 * protocol, CI config, etc.) that `adjutant init` copies into new projects.
 * Templates live in `cli/templates/quality/` and are resolved relative to
 * the package root at runtime.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/** Describes a single quality file that gets installed into a project. */
export interface QualityFile {
  /** Template filename in cli/templates/quality/, e.g. "03-testing.md" */
  templateName: string;
  /** Destination path relative to project root, e.g. ".claude/rules/03-testing.md" */
  destPath: string;
  /** Human-readable description of this file's purpose */
  description: string;
  /** If true, skip copying when the destination already exists (e.g. ci.yml) */
  skipIfExists: boolean;
  /** If true, set the executable bit after copying (e.g. shell scripts) */
  executable: boolean;
}

/** Manifest of all quality files managed by Adjutant. */
export const QUALITY_FILES: QualityFile[] = [
  {
    templateName: "03-testing.md",
    destPath: ".claude/rules/03-testing.md",
    description: "Testing constitution",
    skipIfExists: false,
    executable: false,
  },
  {
    templateName: "08-code-review.md",
    destPath: ".claude/rules/08-code-review.md",
    description: "Code review protocol",
    skipIfExists: false,
    executable: false,
  },
  {
    templateName: "code-review-skill.md",
    destPath: ".claude/skills/code-review/SKILL.md",
    description: "Code review skill for Claude Code",
    skipIfExists: false,
    executable: false,
  },
  {
    templateName: "verify-before-push.sh",
    destPath: "scripts/verify-before-push.sh",
    description: "Pre-push verification script",
    skipIfExists: false,
    executable: true,
  },
  {
    templateName: "ci.yml",
    destPath: ".github/workflows/ci.yml",
    description: "GitHub Actions CI pipeline",
    skipIfExists: true,
    executable: false,
  },
];

/** Resolve the package root from the module location. */
function getPackageRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // When compiled: dist/cli/lib/quality-templates.js -> 3 levels up
  // When running from source (e.g. vitest): cli/lib/quality-templates.ts -> 2 levels up
  if (moduleDir.includes("dist")) {
    return join(moduleDir, "..", "..", "..");
  }
  return join(moduleDir, "..", "..");
}

/**
 * Load a template file's content by its template name.
 *
 * @param templateName - The filename in cli/templates/quality/ (e.g. "03-testing.md")
 * @returns The template file contents as a string
 * @throws If the template file does not exist or cannot be read
 */
export function loadTemplate(templateName: string): string {
  const packageRoot = getPackageRoot();
  const templatePath = join(packageRoot, "cli", "templates", "quality", templateName);
  return readFileSync(templatePath, "utf-8");
}

/**
 * Get all destination paths for quality files.
 *
 * Useful for doctor checks to verify all expected files exist in a project.
 *
 * @returns Array of relative destination paths (e.g. [".claude/rules/03-testing.md", ...])
 */
export function getQualityFilePaths(): string[] {
  return QUALITY_FILES.map((f) => f.destPath);
}
