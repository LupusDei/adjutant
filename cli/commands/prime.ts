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

import { getGlobalAdjutantDir } from "../lib/checks.js";
import { PRIME_MD_CONTENT } from "../lib/prime.js";

export function runPrime(): number {
  const localPath = join(process.cwd(), ".adjutant", "PRIME.md");
  const globalPath = join(getGlobalAdjutantDir(), "PRIME.md");

  if (existsSync(localPath)) {
    process.stdout.write(readFileSync(localPath, "utf-8"));
  } else if (existsSync(globalPath)) {
    process.stdout.write(readFileSync(globalPath, "utf-8"));
  } else {
    process.stdout.write(PRIME_MD_CONTENT);
  }

  return 0;
}
