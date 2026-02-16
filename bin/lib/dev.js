import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { checkNgrok } from './tunnel.js';
import { expandHome } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const COLORS = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

/**
 * Start the development servers
 */
export async function startDev(options) {
  const { gtRoot, tunnel, port, apiPort } = options;

  // Project root is always CWD
  const projectRoot = process.cwd();
  process.env.ADJUTANT_PROJECT_ROOT = projectRoot;
  console.log(`${COLORS.green}Project root: ${projectRoot}${COLORS.reset}`);

  // Gas Town root is optional — only set if explicitly provided
  if (gtRoot) {
    const resolvedGtRoot = expandHome(gtRoot);
    if (!existsSync(resolvedGtRoot)) {
      throw new Error(`Gas Town directory does not exist: ${resolvedGtRoot}`);
    }
    process.env.GT_TOWN_ROOT = resolvedGtRoot;
    const hasTown = existsSync(join(resolvedGtRoot, 'mayor', 'town.json'));
    console.log(`${COLORS.blue}Gas Town: ${resolvedGtRoot}${hasTown ? '' : ' (no mayor/town.json)'}${COLORS.reset}`);
  }

  // Check if ngrok is available
  const ngrokAvailable = tunnel && (await checkNgrok());

  if (tunnel && !ngrokAvailable) {
    console.log(`${COLORS.yellow}ngrok not installed - starting without remote access${COLORS.reset}`);
    console.log('To enable remote access: brew install ngrok && ngrok config add-authtoken <token>\n');
  }

  // Build concurrently command
  const commands = [
    { name: 'backend', command: 'npm', args: ['run', 'dev'], cwd: join(PROJECT_ROOT, 'backend') },
    { name: 'frontend', command: 'npm', args: ['run', 'dev'], cwd: join(PROJECT_ROOT, 'frontend') },
  ];

  if (tunnel && ngrokAvailable) {
    commands.push({
      name: 'ngrok',
      command: 'ngrok',
      args: ['http', String(port)],
      cwd: PROJECT_ROOT,
    });
  }

  const modeText = tunnel && ngrokAvailable ? ' + ngrok tunnel' : '';
  console.log(`${COLORS.green}Starting Adjutant${modeText}${COLORS.reset}\n`);

  // Start all processes
  const processes = commands.map(({ name, command, args, cwd }) => {
    const color = name === 'backend' ? COLORS.blue : name === 'frontend' ? COLORS.green : COLORS.magenta;

    const proc = spawn(command, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    proc.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line) => {
        if (line.trim()) {
          console.log(`${color}[${name}]${COLORS.reset} ${line}`);
        }
      });
    });

    proc.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line) => {
        if (line.trim()) {
          console.error(`${color}[${name}]${COLORS.reset} ${line}`);
        }
      });
    });

    proc.on('error', (error) => {
      console.error(`${color}[${name}]${COLORS.reset} Error: ${error.message}`);
    });

    return { name, proc };
  });

  // Handle graceful shutdown
  const cleanup = () => {
    console.log('\nShutting down...');
    processes.forEach(({ name, proc }) => {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    });
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Track process exits — only shut down if a core process (backend/frontend) dies
  const coreProcesses = new Set(['backend', 'frontend']);

  await new Promise((resolve) => {
    for (const { name, proc } of processes) {
      proc.on('exit', (code) => {
        if (coreProcesses.has(name)) {
          console.log(`[${name}] exited with code ${code}`);
          resolve({ name, code });
        } else {
          // Non-core process (ngrok) — log but don't kill everything
          if (code !== 0) {
            console.log(`${COLORS.yellow}[${name}] exited with code ${code} (non-fatal)${COLORS.reset}`);
          }
        }
      });
    }
  });

  // Kill remaining processes
  cleanup();
}
