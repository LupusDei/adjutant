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
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve, join, basename } from "path";

import { parseSpec, parseSpecContent } from "./spec-parser.js";
import { generateTestFiles, generateFileName } from "./test-generator.js";
import { scanSpecCoverage, formatCoverageReport } from "./reporter.js";
import type { AcceptanceOptions, DiscoveredSpec } from "./types.js";

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
  --all         Process all specs in the specs/ directory
  --run         Run acceptance tests (default)
  --report      Show spec coverage report (which specs have tests)
  --overwrite   Overwrite existing test files during --generate
  --verbose     Show detailed output
  --help        Show this help message

Examples:
  npx tsx src/acceptance/cli.ts specs/017-agent-proposals --generate
  npx tsx src/acceptance/cli.ts specs/017-agent-proposals --run
  npx tsx src/acceptance/cli.ts --all --generate   (generate for all specs)
  npx tsx src/acceptance/cli.ts --report
  npx tsx src/acceptance/cli.ts   (runs all acceptance tests)
`.trim();

const SPECS_DIR = resolve(import.meta.dirname ?? ".", "../../specs");

// ============================================================================
// Spec Discovery
// ============================================================================

/**
 * Discover all spec directories that contain spec.md with parseable GWT scenarios.
 * Exported for testing.
 *
 * @param specsDir - Root directory to scan for spec subdirectories
 * @returns Array of discovered specs with parsed results
 */
export function discoverSpecs(specsDir: string): DiscoveredSpec[] {
  if (!existsSync(specsDir)) {
    return [];
  }

  const entries = readdirSync(specsDir);
  const results: DiscoveredSpec[] = [];

  for (const entry of entries) {
    const dirPath = join(specsDir, entry);

    // Skip non-directories
    if (!statSync(dirPath).isDirectory()) {
      continue;
    }

    const specPath = join(dirPath, "spec.md");
    if (!existsSync(specPath)) {
      continue;
    }

    const content = readFileSync(specPath, "utf-8");
    const parsed = parseSpecContent(content, specPath);

    // Skip specs with no user stories that have scenarios
    if (parsed.userStories.length === 0) {
      continue;
    }

    // Check that at least one story has scenarios
    const hasScenarios = parsed.userStories.some(s => s.scenarios.length > 0);
    if (!hasScenarios) {
      continue;
    }

    results.push({
      dirName: basename(dirPath),
      dirPath,
      parsed,
    });
  }

  return results;
}

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
  let report = false;
  let verbose = false;
  let overwrite = false;
  let all = false;

  for (const arg of args) {
    if (arg === "--generate") {
      generate = true;
    } else if (arg === "--run") {
      run = true;
    } else if (arg === "--report") {
      report = true;
    } else if (arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--help") {
      // eslint-disable-next-line no-console
      console.log(USAGE);
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      specDir = arg;
    }
  }

  // Default to --run if no action flag is set
  if (!generate && !run && !report) {
    run = true;
  }

  return { specDir, generate, run, report, verbose, overwrite, all };
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
  const files = await generateTestFiles(parsed, { outputDir, overwrite: options.overwrite ?? false });

  // eslint-disable-next-line no-console
  console.log(`Generated ${files.length} test file(s):`);
  for (const f of files) {
    // eslint-disable-next-line no-console
    console.log(`  ${f}`);
  }
}

// ============================================================================
// Generate All Mode
// ============================================================================

/**
 * Generate acceptance test files for all specs in the specs/ directory.
 */
async function handleGenerateAll(
  options: AcceptanceOptions
): Promise<void> {
  const specsDir = SPECS_DIR;

  if (options.verbose) {
    // eslint-disable-next-line no-console
    console.log(`Scanning specs directory: ${specsDir}`);
  }

  const discovered = discoverSpecs(specsDir);
  const outputDir = DEFAULT_OUTPUT_DIR;
  let totalFiles = 0;
  let totalSpecs = 0;
  let skippedSpecs = 0;

  // Count total spec dirs (including those without GWT)
  if (existsSync(specsDir)) {
    const allEntries = readdirSync(specsDir);
    for (const entry of allEntries) {
      const dirPath = join(specsDir, entry);
      if (statSync(dirPath).isDirectory() && existsSync(join(dirPath, "spec.md"))) {
        totalSpecs++;
      }
    }
  }

  skippedSpecs = totalSpecs - discovered.length;

  for (const spec of discovered) {
    if (options.verbose) {
      // eslint-disable-next-line no-console
      console.log(`Processing: ${spec.dirName}`);
    }

    const files = await generateTestFiles(spec.parsed, {
      outputDir,
      overwrite: options.overwrite ?? false,
    });
    totalFiles += files.length;

    for (const f of files) {
      if (options.verbose) {
        // eslint-disable-next-line no-console
        console.log(`  ${f}`);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Generated ${totalFiles} test files from ${discovered.length} specs` +
    (skippedSpecs > 0 ? ` (${skippedSpecs} specs had no GWT scenarios)` : "")
  );
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

  // If a specific spec dir was provided, target just that spec's test file
  if (options.specDir) {
    const specPath = join(options.specDir, "spec.md");
    if (existsSync(specPath)) {
      // Parse the spec to get the feature name for accurate file targeting
      const parsed = parseSpecContent(
        readFileSync(specPath, "utf-8"),
        specPath
      );
      const testFile = generateFileName(parsed.featureName);
      cmd.push(testFile);
    }
  }

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
// Report Mode
// ============================================================================

/**
 * Show a spec coverage report: which specs have tests and their status.
 */
function handleReport(): void {
  const specsDir = resolve(import.meta.dirname ?? ".", "../../specs");
  const testsDir = resolve(
    import.meta.dirname ?? ".",
    "../../tests/acceptance"
  );

  const entries = scanSpecCoverage(specsDir, testsDir);
  const output = formatCoverageReport(entries);

  // eslint-disable-next-line no-console
  console.log(output);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (options.generate) {
    if (options.all) {
      await handleGenerateAll(options);
    } else {
      await handleGenerate(options);
    }
  }

  if (options.report) {
    handleReport();
  }

  if (options.run) {
    handleRun(options);
  }
}

// Only run main when this file is the entry point (not when imported for testing)
const isEntryPoint =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isEntryPoint) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Acceptance CLI error:", err);
    process.exit(1);
  });
}
