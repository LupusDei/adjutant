#!/usr/bin/env node

/**
 * Adjutant CLI
 *
 * Bootstrap and validate the Adjutant stack.
 *
 * Commands:
 *   init     Bootstrap a fresh Adjutant installation
 *   doctor   Check system health and prerequisites
 *   --help   Show help
 *   --version Show version
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function printHelp(): void {
  console.log(`
adjutant - Bootstrap and validate the Adjutant stack

Usage:
  adjutant <command> [options]

Commands:
  init       Bootstrap a fresh Adjutant installation
  doctor     Check system health and prerequisites

Options:
  --help     Show this help message
  --version  Show version number

Examples:
  adjutant init          Set up .adjutant/, hooks, .mcp.json
  adjutant init --force  Overwrite existing files
  adjutant doctor        Check all prerequisites
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log(`adjutant v${getVersion()}`);
    process.exit(0);
  }

  switch (command) {
    case "init": {
      const { runInit } = await import("./commands/init.js");
      const force = args.includes("--force") || args.includes("-f");
      await runInit({ force });
      break;
    }
    case "doctor": {
      const { runDoctor } = await import("./commands/doctor.js");
      const exitCode = await runDoctor();
      process.exit(exitCode);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "adjutant --help" for usage.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message ?? err);
  process.exit(1);
});
