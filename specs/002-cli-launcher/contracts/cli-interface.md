# CLI Interface Contract: gt-boy

**Feature**: 002-cli-launcher
**Version**: 1.0.0
**Date**: 2026-01-11

## Command Synopsis

```
gt-boy [options]
gt-boy --help
gt-boy --version
```

## Description

Launches the gastown-boy UI from a gastown directory. Starts both the backend API server and frontend development server, then opens the UI in the default browser.

## Options

| Option | Alias | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--port <number>` | `-p` | number | 5173 | Frontend server port |
| `--backend-port <number>` | `-b` | number | 3001 | Backend API server port |
| `--no-browser` | | boolean | false | Skip opening browser automatically |
| `--help` | `-h` | | | Display help message |
| `--version` | `-V` | | | Display version number |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GT_BOY_PORT` | Frontend server port | 5173 |
| `GT_BOY_BACKEND_PORT` | Backend API server port | 3001 |
| `GT_BOY_NO_BROWSER` | Skip browser open (set to "1" or "true") | false |

Environment variables are overridden by command-line options.

## Exit Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | `SUCCESS` | Clean exit (including Ctrl+C shutdown) |
| 1 | `NOT_GASTOWN_DIR` | Not a valid gastown directory |
| 2 | `PORT_IN_USE` | Specified port is already in use |
| 3 | `BACKEND_START_FAILED` | Backend server failed to start |
| 4 | `FRONTEND_START_FAILED` | Frontend server failed to start |
| 5 | `GT_NOT_FOUND` | `gt` command not found in PATH |
| 6 | `ALREADY_RUNNING` | gt-boy already running for this directory |

## Signals

| Signal | Behavior |
|--------|----------|
| `SIGINT` (Ctrl+C) | Graceful shutdown: stop frontend, stop backend, exit 0 |
| `SIGTERM` | Same as SIGINT |

Shutdown timeout is 5 seconds. If servers don't stop gracefully, they are force-killed.

## Output Format

### Startup Messages

```
gt-boy v1.0.0
Starting gastown-boy from /path/to/town...

[backend]  Starting on port 3001...
[backend]  Ready at http://localhost:3001
[frontend] Starting on port 5173...
[frontend] Ready at http://localhost:5173

Opening browser at http://localhost:5173
Press Ctrl+C to stop
```

### Shutdown Messages

```
Shutting down...
[frontend] Stopped
[backend]  Stopped
Goodbye!
```

### Error Messages

```
Error: Not a gastown directory
  Run gt-boy from a directory containing a gastown town or rig.
  Expected to find: .beads/ directory

Error: Port 5173 is already in use
  Try: gt-boy --port 5174
  Or check what's using the port: lsof -i :5173

Error: gt command not found
  Please install gastown and ensure 'gt' is in your PATH.
  See: https://github.com/steveyegge/gastown
```

## Examples

### Basic Usage

```bash
# Start from a gastown directory
cd ~/gt/my-project
gt-boy
```

### Custom Ports

```bash
# Use different ports to avoid conflicts
gt-boy --port 4000 --backend-port 4001
```

### Headless Mode

```bash
# Start servers without opening browser
gt-boy --no-browser
```

### Using Environment Variables

```bash
# Set defaults via environment
export GT_BOY_PORT=4000
gt-boy  # Uses port 4000
```

## Help Output

```
Usage: gt-boy [options]

Launch gastown-boy from a gastown directory

Options:
  -V, --version                output the version number
  -p, --port <number>          frontend server port (default: 5173, env: GT_BOY_PORT)
  -b, --backend-port <number>  backend API server port (default: 3001, env: GT_BOY_BACKEND_PORT)
  --no-browser                 skip opening browser automatically
  -h, --help                   display help for command

Examples:
  $ gt-boy                     # Start with defaults
  $ gt-boy -p 4000             # Use custom frontend port
  $ gt-boy --no-browser        # Don't open browser

Must be run from a gastown directory (contains .beads/).
```
