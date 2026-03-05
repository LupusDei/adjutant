/**
 * Acceptance Test CLI — Entry point for `npm run acceptance`.
 *
 * Usage:
 *   npx tsx src/acceptance/cli.ts <spec-dir> [options]
 *
 * Options:
 *   --generate    Generate test files from spec.md (default if no test files exist)
 *   --run         Run acceptance tests (default)
 *   --verbose     Show detailed output
 *
 * Examples:
 *   npx tsx src/acceptance/cli.ts specs/017-agent-proposals --generate
 *   npx tsx src/acceptance/cli.ts specs/017-agent-proposals
 *   npx tsx src/acceptance/cli.ts   (runs all acceptance tests)
 *
 * @module acceptance/cli
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, join } from "path";

import { parseSpec } from "./spec-parser.js";
import { generateTestFiles } from "./test-generator.js";
import type { AcceptanceOptions } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OUTPUT_DIR = resolve(
  import.meta.dirname ?? ".",
  "../../tests/acceptance"
);

const USAGE = `
Usage:
  npx tsx src/acceptance/cli.ts <spec-dir> [options]

Options:
  --generate    Generate test files from spec.md
  --run         Run acceptance tests (default)
  --verbose     Show detailed output
  --help        Show this help message

Examples:
  npx tsx src/acceptance/cli.ts specs/017-agent-proposals --generate
  npx tsx src/acceptance/cli.ts specs/017-agent-proposals --run
  npx tsx src/acceptance/cli.ts   (runs all acceptance tests)
`.trim();

// ============================================================================
// Arg Parsing
// ============================================================================

/**
 * Parse CLI arguments into AcceptanceOptions.
 * Exported for testing.
 */
export function parseArgs(argv: string[]): AcceptanceOptions {
  // Skip node and script path
  const args = argv.slice(2);

  let specDir = "";
  let generate = false;
  let run = false;
  let verbose = false;

  for (const arg of args) {
    if (arg === "--generate") {
      generate = true;
    } else if (arg === "--run") {
      run = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--help") {
      // eslint-disable-next-line no-console
      console.log(USAGE);
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      specDir = arg;
    }
  }

  // Default to --run if neither flag is set
  if (!generate && !run) {
    run = true;
  }

  return { specDir, generate, run, verbose };
}

// ============================================================================
// Generate Mode
// ============================================================================

/**
 * Generate acceptance test files from a spec directory.
 */
async function handleGenerate(
  options: AcceptanceOptions
): Promise<void> {
  const specDir = options.specDir;
  if (!specDir) {
    // eslint-disable-next-line no-console
    console.error("Error: --generate requires a spec directory argument.");
    // eslint-disable-next-line no-console
    console.error("  Example: npx tsx src/acceptance/cli.ts specs/017-agent-proposals --generate");
    process.exit(1);
  }

  const specPath = join(specDir, "spec.md");
  if (!existsSync(specPath)) {
    // eslint-disable-next-line no-console
    console.error(`Error: spec.md not found at ${specPath}`);
    process.exit(1);
  }

  if (options.verbose) {
    // eslint-disable-next-line no-console
    console.log(`Parsing spec: ${specPath}`);
  }

  const parsed = await parseSpec(specPath);

  if (options.verbose) {
    // eslint-disable-next-line no-console
    console.log(
      `Found ${parsed.userStories.length} user stories with ` +
        `${parsed.userStories.reduce((sum, s) => sum + s.scenarios.length, 0)} scenarios`
    );
  }

  const outputDir = DEFAULT_OUTPUT_DIR;
  const files = await generateTestFiles(parsed, { outputDir });

  // eslint-disable-next-line no-console
  console.log(`Generated ${files.length} test file(s):`);
  for (const f of files) {
    // eslint-disable-next-line no-console
    console.log(`  ${f}`);
  }
}

// ============================================================================
// Run Mode
// ============================================================================

/**
 * Run acceptance tests via Vitest CLI.
 */
function handleRun(options: AcceptanceOptions): void {
  const configPath = resolve(
    import.meta.dirname ?? ".",
    "../../vitest.acceptance.config.ts"
  );

  if (!existsSync(configPath)) {
    // eslint-disable-next-line no-console
    console.error(
      `Error: vitest.acceptance.config.ts not found at ${configPath}`
    );
    process.exit(1);
  }

  const cmd = [
    "npx",
    "vitest",
    "run",
    "--config",
    configPath,
  ];

  if (options.verbose) {
    cmd.push("--reporter=verbose");
  }

  if (options.verbose) {
    // eslint-disable-next-line no-console
    console.log(`Running: ${cmd.join(" ")}`);
  }

  try {
    execSync(cmd.join(" "), {
      stdio: "inherit",
      cwd: resolve(import.meta.dirname ?? ".", "../.."),
    });
  } catch {
    // Vitest exits with non-zero if tests fail — that's expected
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (options.generate) {
    await handleGenerate(options);
  }

  if (options.run && !options.generate) {
    handleRun(options);
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Acceptance CLI error:", err);
  process.exit(1);
});
