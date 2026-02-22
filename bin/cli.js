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
      await runInit({ force: options.force ?? false });
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

program.parse();
