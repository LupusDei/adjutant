# Research: CLI Launcher

**Feature**: 002-cli-launcher
**Date**: 2026-01-11

## Research Questions

### Q1: How to detect a valid gastown directory?

**Decision**: Check for `.beads/` directory as primary indicator, with fallback to `gt status --json` validation.

**Rationale**: Based on gastown repository research, the `.beads/` directory is the definitive marker for both "town" (workspace root) and "rig" (project) directories. This is faster than spawning a subprocess and covers all gastown installation types.

**Detection Strategy**:
1. Check for `.beads/` directory (primary indicator)
2. Check for `.git/` directory (secondary - gastown is git-backed)
3. Differentiate town vs rig:
   - `settings/config.json` → rig
   - `daemon.json` → town
4. Fallback: Run `gt status --json` for definitive validation

**Alternatives Considered**:
- Check only for `gt status` command: Rejected - slower (spawns process), fails if gastown not running
- Check for `.gastown/` folder: Rejected - this marker doesn't exist; `.beads/` is the actual marker

**Sources**:
- [gastown README](https://github.com/steveyegge/gastown/blob/main/README.md)
- [gastown CHANGELOG](https://github.com/steveyegge/gastown/blob/main/CHANGELOG.md)

---

### Q2: CLI framework for argument parsing?

**Decision**: Use [commander.js](https://github.com/tj/commander.js) for CLI argument parsing.

**Rationale**: Commander.js is the de facto standard for Node.js CLI applications with:
- Full TypeScript support
- Automatic help generation (`--help`)
- Version handling (`--version`)
- Environment variable support (`.env('PORT')`)
- Chainable API for options and arguments
- 193+ code examples available

**Usage Example**:
```typescript
import { Command, Option } from 'commander';

const program = new Command()
  .name('gt-boy')
  .description('Launch gastown-boy from a gastown directory')
  .version('1.0.0')
  .addOption(new Option('-p, --port <number>', 'frontend port').default(5173).env('GT_BOY_PORT'))
  .addOption(new Option('--backend-port <number>', 'backend port').default(3001).env('GT_BOY_BACKEND_PORT'))
  .action((options) => {
    startGastownBoy(options);
  });

program.parse();
```

**Alternatives Considered**:
- `yargs`: Good alternative, but commander.js has simpler TypeScript integration
- Manual `process.argv` parsing: Rejected - no help generation, error-prone
- `meow`: Lighter weight, but less feature-rich

**Sources**:
- [commander.js GitHub](https://github.com/tj/commander.js)
- [commander.js npm](https://www.npmjs.com/package/commander)

---

### Q3: Cross-platform browser opening?

**Decision**: Use the [open](https://github.com/sindresorhus/open) package (sindresorhus/open).

**Rationale**: The `open` package is:
- Cross-platform (macOS `open`, Windows `start`, Linux `xdg-open`)
- Actively maintained by sindresorhus
- Uses `spawn` instead of `exec` (safer)
- Supports WSL paths
- ESM-native (matches modern TypeScript)

**Usage Example**:
```typescript
import open from 'open';

// Open URL in default browser
await open('http://localhost:5173');

// Optionally specify browser
await open('http://localhost:5173', { app: { name: open.apps.chrome } });
```

**Note**: This package is ESM-only. The CLI project will use ESM module format.

**Alternatives Considered**:
- `opn`: Deprecated, renamed to `open`
- `openurl`: Less maintained, fewer features
- Native `child_process.exec('open ...')`: Not cross-platform

**Sources**:
- [open npm](https://www.npmjs.com/package/open)
- [sindresorhus/open GitHub](https://github.com/sindresorhus/open)

---

### Q4: Graceful shutdown with multiple child processes?

**Decision**: Use SIGINT/SIGTERM signal handlers with tracked child process references.

**Rationale**: Node.js provides native signal handling. The key patterns are:
1. Track all spawned child processes in an array
2. Handle SIGINT (Ctrl+C) and SIGTERM signals
3. Send SIGTERM to all children on shutdown
4. Wait for graceful exit with timeout
5. Force kill (SIGKILL) if timeout exceeded

**Implementation Pattern**:
```typescript
const children: ChildProcess[] = [];

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down...`);
  
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  
  // Force kill after timeout
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(0);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', () => shutdown('exit'));
```

**Windows Note**: SIGINT/SIGTERM work on Windows via Node.js abstraction, but may behave differently. The CLI targets macOS/Linux primarily.

**Alternatives Considered**:
- Node.js 25's `process.addShutdownHandler()`: Too new, requires Node 25.1+
- Let OS handle cleanup: Rejected - may leave orphaned processes
- IPC-based shutdown: Over-engineered for this use case

**Sources**:
- [Node.js Child Process Documentation](https://nodejs.org/api/child_process.html)
- [Node.js Process Documentation](https://nodejs.org/api/process.html)
- [Graceful Shutdown Patterns](https://dev.to/superiqbal7/graceful-shutdown-in-nodejs-handling-stranger-danger-29jo)

---

### Q5: Detecting if servers are already running?

**Decision**: Check port availability before starting, use PID file as secondary check.

**Rationale**: Two-layer approach provides robust detection:
1. **Port check** (primary): Use `net.createServer()` to test if port is available
2. **PID file** (secondary): Write PID to `~/.gt-boy.pid` on start, check on subsequent runs

**Port Check Implementation**:
```typescript
import net from 'net';

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}
```

**Alternatives Considered**:
- `lsof` command: Not cross-platform
- `netstat` parsing: Complex, platform-dependent
- Only PID file: Can become stale if process crashes

---

### Q6: Where should the CLI package live?

**Decision**: New `cli/` directory at repository root, alongside `frontend/` and `backend/`.

**Rationale**: 
- Maintains separation of concerns
- CLI can have its own `package.json` for CLI-specific dependencies
- Allows independent versioning/publishing
- Clear boundary: CLI orchestrates, servers serve

**Structure**:
```
gastown-boy/
├── cli/          # New: gt-boy command
├── frontend/     # React UI (started by CLI)
├── backend/      # Express API (started by CLI)
└── specs/        # Feature specs
```

**Alternatives Considered**:
- Add to `backend/`: Rejected - CLI is not a backend concern
- Monorepo with workspaces: Over-engineered for 3 packages
- Single root package: Mixes concerns, harder to maintain

---

## Summary

All research questions resolved. Key technology choices:
- **Gastown detection**: `.beads/` directory check
- **CLI framework**: commander.js
- **Browser opening**: sindresorhus/open
- **Shutdown**: Native SIGINT/SIGTERM handlers
- **Port detection**: net.createServer() availability check
- **Structure**: Separate `cli/` package
