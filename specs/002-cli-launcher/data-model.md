# Data Model: CLI Launcher

**Feature**: 002-cli-launcher
**Date**: 2026-01-11

## Entities

### CLIOptions

Runtime configuration parsed from command-line arguments.

```typescript
/**
 * CLI options parsed from command-line arguments
 */
interface CLIOptions {
  /** Frontend server port (default: 5173) */
  port: number;
  
  /** Backend API server port (default: 3001) */
  backendPort: number;
  
  /** Skip opening browser automatically */
  noBrowser: boolean;
  
  /** Working directory (default: process.cwd()) */
  directory: string;
}

/**
 * Zod schema for CLI options validation
 */
const CLIOptionsSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(5173),
  backendPort: z.number().int().min(1024).max(65535).default(3001),
  noBrowser: z.boolean().default(false),
  directory: z.string().default(process.cwd()),
});
```

### GastownDirectory

Validation result for detecting a gastown installation.

```typescript
/**
 * Gastown directory detection result
 */
interface GastownDirectory {
  /** Whether this is a valid gastown directory */
  isValid: boolean;
  
  /** Type of gastown installation: 'town' (workspace) or 'rig' (project) */
  type: 'town' | 'rig' | null;
  
  /** Absolute path to the directory */
  path: string;
  
  /** Error message if validation failed */
  error?: string;
}

/**
 * Markers that indicate a gastown directory
 */
interface GastownMarkers {
  /** .beads/ directory exists (primary indicator) */
  hasBeads: boolean;
  
  /** .git/ directory exists (git-backed) */
  hasGit: boolean;
  
  /** settings/config.json exists (rig indicator) */
  hasRigConfig: boolean;
  
  /** daemon.json exists (town indicator) */
  hasDaemonConfig: boolean;
}
```

### ServerProcess

Metadata for a spawned child process.

```typescript
/**
 * Server process state
 */
type ServerStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

/**
 * Spawned server process metadata
 */
interface ServerProcess {
  /** Process name for logging */
  name: 'backend' | 'frontend';
  
  /** Node.js ChildProcess reference */
  process: ChildProcess | null;
  
  /** Process ID (if running) */
  pid: number | null;
  
  /** Server port */
  port: number;
  
  /** Current status */
  status: ServerStatus;
  
  /** Error message (if status is 'error') */
  error?: string;
}

/**
 * Manager state for all server processes
 */
interface ProcessManagerState {
  /** Backend server process */
  backend: ServerProcess;
  
  /** Frontend server process */
  frontend: ServerProcess;
  
  /** Whether shutdown has been initiated */
  shuttingDown: boolean;
}
```

### PortCheckResult

Result of checking port availability.

```typescript
/**
 * Port availability check result
 */
interface PortCheckResult {
  /** Port number checked */
  port: number;
  
  /** Whether the port is available */
  available: boolean;
  
  /** Process using the port (if known) */
  usedBy?: string;
}
```

## State Transitions

### Server Lifecycle

```
┌─────────┐    spawn()     ┌──────────┐   ready     ┌─────────┐
│ stopped │ ─────────────► │ starting │ ──────────► │ running │
└─────────┘                └──────────┘             └─────────┘
     ▲                          │                        │
     │                          │ error                  │ SIGTERM
     │                          ▼                        ▼
     │                     ┌─────────┐             ┌──────────┐
     │                     │  error  │             │ stopping │
     │                     └─────────┘             └──────────┘
     │                          │                        │
     └──────────────────────────┴────────────────────────┘
                              cleanup
```

### Shutdown Sequence

```
1. User presses Ctrl+C (SIGINT received)
2. Set shuttingDown = true
3. Send SIGTERM to frontend process
4. Send SIGTERM to backend process
5. Wait up to 5 seconds for graceful exit
6. If timeout: send SIGKILL to any remaining processes
7. Exit CLI with code 0
```

## Validation Rules

### Port Numbers
- Must be between 1024 and 65535 (non-privileged ports)
- Frontend and backend ports must be different
- Ports must be available (not in use)

### Directory
- Must exist and be readable
- Must contain gastown markers (`.beads/` directory)
- Must be either a "town" or "rig" type

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| `E001` | `NOT_GASTOWN_DIR` | Current directory is not a gastown installation |
| `E002` | `PORT_IN_USE` | Specified port is already in use |
| `E003` | `BACKEND_START_FAILED` | Backend server failed to start |
| `E004` | `FRONTEND_START_FAILED` | Frontend server failed to start |
| `E005` | `GT_NOT_FOUND` | `gt` command not found in PATH |
| `E006` | `ALREADY_RUNNING` | gt-boy is already running for this directory |
