/**
 * `adjutant prime` — Output PRIME.md content to stdout.
 *
 * Resolution order:
 *   1. Local `.adjutant/PRIME.md` (repo-specific override)
 *   2. Global `~/.adjutant/PRIME.md` (default)
 *   3. Embedded PRIME_MD_CONTENT (fallback)
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { fileExists, getGlobalAdjutantDir } from "../lib/checks.js";
import { PRIME_MD_CONTENT } from "../lib/prime.js";
import { getQualityFilePaths } from "../lib/quality-templates.js";

export function runPrime(): number {
  const cwd = process.cwd();
  const localPath = join(cwd, ".adjutant", "PRIME.md");
  const globalPath = join(getGlobalAdjutantDir(), "PRIME.md");

  if (existsSync(localPath)) {
    process.stdout.write(readFileSync(localPath, "utf-8"));
  } else if (existsSync(globalPath)) {
    process.stdout.write(readFileSync(globalPath, "utf-8"));
  } else {
    process.stdout.write(PRIME_MD_CONTENT);
  }

  // Warn if quality gate files are missing (informational only — exit code unchanged)
  const allPaths = getQualityFilePaths();
  const missingQuality = allPaths.filter((p) => !fileExists(join(cwd, p)));
  if (missingQuality.length > 0) {
    console.log(`\n# Quality files missing (${missingQuality.length}/${allPaths.length})`);
    console.log(`# Run: adjutant upgrade`);
  }

  return 0;
}
