/**
 * Port-scoped Dolt circuit-breaker file clear (adj-uk9af).
 *
 * bd's client writes one circuit-breaker file PER PORT: `/tmp/beads-dolt-circuit-<port>.json`.
 * `doctor --fix` previously cleared them with a BROAD glob (`beads-dolt-circuit-*.json`),
 * which wiped the breaker state of EVERY other beads project/port on the host — disruptive
 * collateral that would also fire mid live-cutover. This helper clears ONLY the repaired
 * project's pinned-port file, mirroring bd-client's own port-scoped clear.
 *
 * fs access is INJECTED ({@link CircuitClearSeams}) so it is unit-testable and never
 * touches a real /tmp file in a test.
 */

import { join } from "path";

/** Injected filesystem seams for the clear. */
export interface CircuitClearSeams {
  /** Directory the breaker files live in (normally `/tmp`). */
  tmpDir: string;
  /** List directory entries. MAY throw — the clear guards it. */
  readdir: (dir: string) => string[];
  /** Remove a file. MAY throw — the clear treats removal as best-effort. */
  remove: (path: string) => void;
}

/** The exact breaker filename for a port (bd 0.60.0: `beads-dolt-circuit-<port>.json`). */
function circuitFileName(port: number): string {
  return `beads-dolt-circuit-${port}.json`;
}

/**
 * Clear ONLY this port's circuit-breaker file. Returns the paths removed ([] when none).
 * Exact filename match — never a prefix glob — so a sibling port (e.g. 170050) is never
 * touched. Best-effort: a readdir/remove failure resolves to [] / skips, never throws.
 */
export function clearCircuitFileForPort(port: number, seams: CircuitClearSeams): string[] {
  const target = circuitFileName(port);
  let entries: string[];
  try {
    entries = seams.readdir(seams.tmpDir);
  } catch {
    return [];
  }
  const cleared: string[] = [];
  for (const name of entries) {
    if (name !== target) continue;
    const full = join(seams.tmpDir, name);
    try {
      seams.remove(full);
      cleared.push(full);
    } catch {
      /* best-effort */
    }
  }
  return cleared;
}
