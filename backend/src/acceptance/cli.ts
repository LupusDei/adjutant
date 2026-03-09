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
  --sync        Regenerate preserving manual edits (use with --generate)
  --watch       Watch spec.md files and auto-regenerate/re-run on change
  --verbose     Show detailed output
  --help        Show this help message

Examples:
  npx tsx src/acceptance/cli.ts specs/017-agent-proposals --generate
  npx tsx src/acceptance/cli.ts specs/017-agent-proposals --run
  npx tsx src/acceptance/cli.ts --all --generate   (generate for all specs)
  npx tsx src/acceptance/cli.ts --report
  npx tsx src/acceptance/cli.ts --watch            (watch all specs)
  npx tsx src/acceptance/cli.ts specs/017 --watch  (watch one spec)
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
  let sync = false;
  let watch = false;

  for (const arg of args) {
    if (arg === "--generate") {
      generate = true;
    } else if (arg === "--run") {
      run = true;
    } else if (arg === "--report") {
      report = true;
    } else if (arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--sync") {
      sync = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--watch") {
      watch = true;
    } else if (arg === "--help") {
      // eslint-disable-next-line no-console
      console.log(USAGE);
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      specDir = arg;
    }
  }

  // Default to --run if no action flag is set
  if (!generate && !run && !report && !watch) {
    run = true;
  }

  return { specDir, generate, run, report, verbose, overwrite, all, sync, watch };
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
  const files = await generateTestFiles(parsed, {
    outputDir,
    overwrite: options.overwrite ?? false,
    sync: options.sync ?? false,
  });

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
      sync: options.sync ?? false,
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
// Debounce Utility
// ============================================================================

/**
 * Create a debounced version of a function that delays invocation until
 * after `delayMs` milliseconds have elapsed since the last call.
 * The returned function also has a `.cancel()` method.
 *
 * @param fn - Function to debounce
 * @param delayMs - Delay in milliseconds
 * @returns Debounced function with cancel method
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic debounce needs flexible args
export function createDebounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

// ============================================================================
// Watch Mode
// ============================================================================

/**
 * Debounce delay for watch mode file change events (milliseconds).
 */
const WATCH_DEBOUNCE_MS = 500;

/**
 * Handle a single spec change: regenerate (with sync) and re-run tests.
 */
async function processSpecChange(
  specDir: string,
  specName: string,
  options: AcceptanceOptions
): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\n--- spec changed: ${specName} ---\n`);

  try {
    // Re-generate with sync mode to preserve manual edits
    const specPath = join(specDir, "spec.md");
    const parsed = await parseSpec(specPath);
    const outputDir = DEFAULT_OUTPUT_DIR;

    await generateTestFiles(parsed, {
      outputDir,
      overwrite: false,
      sync: true,
    });

    // eslint-disable-next-line no-console
    console.log(`Regenerated test files for ${specName}`);

    // Re-run tests for this spec
    handleRun({ ...options, specDir, run: true });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error(`Error processing spec change for ${specName}:`, err);
  }
}

/**
 * Watch spec.md files for changes and auto-regenerate/re-run tests.
 * Uses Node's built-in fs.watch() with recursive option.
 */
async function handleWatch(options: AcceptanceOptions): Promise<void> {
  const { watch: fsWatch } = await import("fs");

  // Determine what to watch
  const watchDir = options.specDir
    ? resolve(options.specDir)
    : SPECS_DIR;

  if (!existsSync(watchDir)) {
    // eslint-disable-next-line no-console
    console.error(`Error: watch directory not found: ${watchDir}`);
    process.exit(1);
  }

  // Initial run: generate + run tests
  // eslint-disable-next-line no-console
  console.log("Running initial generate + test pass...\n");

  if (options.specDir) {
    // Single spec
    await handleGenerate({ ...options, generate: true, sync: true });
    handleRun({ ...options, run: true });
  } else {
    // All specs
    await handleGenerateAll({ ...options, generate: true, sync: true, all: true });
    handleRun({ ...options, run: true });
  }

  // eslint-disable-next-line no-console
  console.log("\nWatching for spec changes...\n");

  // Per-spec debounce map so concurrent edits to different specs don't collide
  const debouncers = new Map<string, ReturnType<typeof createDebounce>>();

  const watcher = fsWatch(watchDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;

    // Only react to spec.md file changes
    if (!filename.endsWith("spec.md")) return;

    // Extract the spec directory name from the filename
    // filename is relative to watchDir, e.g. "017-agent-proposals/spec.md"
    // or just "spec.md" if watching a single spec dir
    const parts = filename.split("/");
    let specName: string;
    let specFullDir: string;

    if (parts.length >= 2) {
      // Watching specs/ root — filename is like "017-agent-proposals/spec.md"
      specName = parts[0]!;
      specFullDir = join(watchDir, specName);
    } else {
      // Watching a single spec dir — filename is "spec.md"
      specName = basename(watchDir);
      specFullDir = watchDir;
    }

    // Get or create a debouncer for this spec
    if (!debouncers.has(specName)) {
      debouncers.set(
        specName,
        createDebounce(() => {
          void processSpecChange(specFullDir, specName, options);
        }, WATCH_DEBOUNCE_MS)
      );
    }

    debouncers.get(specName)!();
  });

  // Clean exit on SIGINT
  process.on("SIGINT", () => {
    // eslint-disable-next-line no-console
    console.log("\nStopping watch mode...");
    watcher.close();
    for (const d of debouncers.values()) {
      d.cancel();
    }
    process.exit(0);
  });

  // Keep the process alive
  await new Promise(() => {
    // Never resolves — process stays alive until SIGINT
  });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (options.watch) {
    await handleWatch(options);
    return;
  }

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
