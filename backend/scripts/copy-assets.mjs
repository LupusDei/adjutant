/**
 * Copy non-TypeScript runtime assets from src/ into dist/ (adj-sh3pg).
 *
 * `tsc` emits only .js/.d.ts. Anything the server reads at runtime relative to
 * its own module path therefore vanished from the production build:
 *
 *   - src/services/migrations/*.sql  -> `npm start` applied ZERO migrations. A
 *     fresh DB came up with only the `migrations` + `sqlite_sequence` tables and
 *     the first real query threw "no such table: messages", so the server
 *     flapped and agents crash-looped.
 *   - src/data/starcraft-heroes.md   -> agent lore silently resolved to "".
 *
 * This copies EVERY non-.ts file rather than a hardcoded list of directories, so
 * a future asset added somewhere new ships automatically instead of failing in
 * production only.
 *
 * Run as part of `npm run build`, after `tsc`.
 *
 * @module scripts/copy-assets
 */

import { readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Files tsc already handles; everything else is a runtime asset we must ship. */
function isCompiledSource(filename) {
  return filename.endsWith(".ts");
}

/**
 * Recursively copy every non-TypeScript file from `srcDir` into `outDir`,
 * preserving the relative directory structure.
 *
 * Structure matters: the runtime resolves assets with
 * `join(__dirname, "migrations")`, so `src/services/migrations/001.sql` MUST
 * land at `dist/services/migrations/001.sql`.
 *
 * @param {{ srcDir: string, outDir: string }} options
 * @returns {{ copied: number, files: string[] }} count and relative paths copied
 * @throws {Error} if `srcDir` does not exist — a silent no-op is what caused
 *   this bug in the first place.
 */
export function copyAssets({ srcDir, outDir }) {
  if (!statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`copy-assets: source directory not found: ${srcDir}`);
  }

  const files = [];

  const walk = (currentSrc) => {
    for (const entry of readdirSync(currentSrc, { withFileTypes: true })) {
      const fullSrc = join(currentSrc, entry.name);

      if (entry.isDirectory()) {
        walk(fullSrc);
        continue;
      }
      if (!entry.isFile() || isCompiledSource(entry.name)) continue;

      const rel = relative(srcDir, fullSrc);
      const fullOut = join(outDir, rel);
      mkdirSync(dirname(fullOut), { recursive: true });
      // copyFileSync overwrites, so a stale asset from a previous build can't survive.
      copyFileSync(fullSrc, fullOut);
      files.push(rel);
    }
  };

  walk(srcDir);

  return { copied: files.length, files };
}

// CLI entry: `node scripts/copy-assets.mjs`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const srcDir = join(BACKEND_ROOT, "src");
  const outDir = join(BACKEND_ROOT, "dist");

  const { copied } = copyAssets({ srcDir, outDir });

  // Copying nothing means the build is broken (or every asset was deleted).
  // Fail the build here rather than at 3am on a fresh production database.
  if (copied === 0) {
    console.error("copy-assets: copied 0 assets — expected migrations and lore files.");
    process.exit(1);
  }

  console.log(`copy-assets: copied ${copied} runtime asset(s) into dist/`);
}
