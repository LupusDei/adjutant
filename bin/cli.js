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
  .description('Retro terminal UI for Gastown multi-agent orchestration')
  .version(pkg.version)
  .argument('[gt-dir]', 'Path to Gastown town directory', '~/gt')
  .option('--no-tunnel', 'Disable ngrok tunnel')
  .option('--port <port>', 'Frontend port', '4200')
  .option('--api-port <port>', 'Backend API port', '4201')
  .action(async (gtDir, options) => {
    try {
      await startDev({
        gtDir,
        tunnel: options.tunnel,
        port: parseInt(options.port, 10),
        apiPort: parseInt(options.apiPort, 10),
      });
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
