#!/usr/bin/env node

import { program } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { startDev } from './lib/dev.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('adjutant')
  .description('Terminal UI for project management and multi-agent orchestration')
  .version(pkg.version);

// Default command: start dev servers
program
  .command('dev', { isDefault: true })
  .description('Start development servers')
  .option('--gt-root <path>', 'Path to Gas Town directory (enables Gas Town mode switching)')
  .option('--no-tunnel', 'Disable ngrok tunnel')
  .option('--port <port>', 'Frontend port', '4200')
  .option('--api-port <port>', 'Backend API port', '4201')
  .action(async (options) => {
    try {
      await startDev({
        gtRoot: options.gtRoot,
        tunnel: options.tunnel,
        port: parseInt(options.port, 10),
        apiPort: parseInt(options.apiPort, 10),
      });
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Init command: bootstrap the Adjutant stack
program
  .command('init')
  .description('Bootstrap a fresh Adjutant installation')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (options) => {
    try {
      const { runInit } = await import('../dist/cli/commands/init.js');
      const exitCode = await runInit({ force: options.force ?? false });
      process.exit(exitCode);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('CLI not built. Run: npx tsc -p tsconfig.cli.json');
        process.exit(1);
      }
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Prime command: output PRIME.md content to stdout
program
  .command('prime')
  .description('Output PRIME.md agent protocol to stdout (used by plugin hooks)')
  .action(async () => {
    try {
      const { runPrime } = await import('../dist/cli/commands/prime.js');
      const exitCode = runPrime();
      process.exit(exitCode);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('CLI not built. Run: npx tsc -p tsconfig.cli.json');
        process.exit(1);
      }
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Doctor command: check system health
program
  .command('doctor')
  .description('Check system health and prerequisites')
  .action(async () => {
    try {
      const { runDoctor } = await import('../dist/cli/commands/doctor.js');
      const exitCode = await runDoctor();
      process.exit(exitCode);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('CLI not built. Run: npx tsc -p tsconfig.cli.json');
        process.exit(1);
      }
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Upgrade command: repair and upgrade local files
program
  .command('upgrade')
  .description('Repair and upgrade local Adjutant files (PRIME.md, .mcp.json, plugin)')
  .action(async () => {
    try {
      const { runUpgrade } = await import('../dist/cli/commands/upgrade.js');
      const exitCode = await runUpgrade();
      process.exit(exitCode);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('CLI not built. Run: npx tsc -p tsconfig.cli.json');
        process.exit(1);
      }
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Unhook command: remove Adjutant plugin hooks from Claude Code
program
  .command('unhook')
  .description('Remove Adjutant plugin hooks from Claude Code')
  .action(async () => {
    try {
      const { runUnhook } = await import('../dist/cli/commands/unhook.js');
      const exitCode = await runUnhook();
      process.exit(exitCode);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('CLI not built. Run: npx tsc -p tsconfig.cli.json');
        process.exit(1);
      }
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
