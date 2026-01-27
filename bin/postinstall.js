#!/usr/bin/env node

/**
 * Postinstall script for adjutant
 * Installs dependencies in backend and frontend subdirectories
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(color, message) {
  console.log(`${color}[adjutant]${COLORS.reset} ${message}`);
}

function installDeps(dir, name) {
  const fullPath = join(PROJECT_ROOT, dir);
  const packageJson = join(fullPath, 'package.json');

  if (!existsSync(packageJson)) {
    log(COLORS.yellow, `Skipping ${name} - no package.json found`);
    return;
  }

  log(COLORS.green, `Installing ${name} dependencies...`);
  try {
    // Always run npm install to pick up new dependencies
    // npm install is fast and idempotent when nothing changed
    execSync('npm install', {
      cwd: fullPath,
      stdio: 'inherit',
    });
    log(COLORS.green, `${name} dependencies installed`);
  } catch (error) {
    log(COLORS.yellow, `Warning: Failed to install ${name} dependencies`);
    log(COLORS.yellow, `Run manually: cd ${fullPath} && npm install`);
  }
}

// Only run if not in a CI environment or during npm pack/publish
if (process.env.CI || process.env.npm_command === 'pack' || process.env.npm_command === 'publish') {
  process.exit(0);
}

log(COLORS.green, 'Setting up adjutant...');
installDeps('backend', 'Backend');
installDeps('frontend', 'Frontend');
log(COLORS.green, 'Setup complete! Run: adjutant --help');
