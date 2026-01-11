# CLI Launcher - Beads

**Feature**: 002-cli-launcher
**Generated**: 2026-01-11
**Source**: specs/002-cli-launcher/tasks.md

## Root Epic

- **Title**: CLI Launcher
- **Type**: epic
- **Priority**: 1
- **Description**: Create a `gt-boy` CLI command that launches the gastown-boy system from a gastown directory. The CLI starts the backend server, frontend dev server, and opens the browser - all managed as child processes with graceful shutdown on Ctrl+C.

## Epics

### Setup: Initialize CLI Package

- **Type**: epic
- **Priority**: 1
- **Description**: Initialize the CLI package structure with TypeScript, ESM, and testing configuration
- **Tasks**: 4

### Foundational: Core Types and Utilities

- **Type**: epic
- **Priority**: 1
- **Description**: Core types and utilities that ALL user stories depend on. No user story work can begin until this phase is complete.
- **Blocks**: US1, US2, US3
- **Tasks**: 3

### US1: Start Gastown-Boy

- **Type**: epic
- **Priority**: 1
- **Description**: Run `gt-boy` from a gastown directory to start backend, frontend, and open browser
- **MVP**: true
- **Tasks**: 11

### US2: Graceful Shutdown

- **Type**: epic
- **Priority**: 2
- **Description**: Ctrl+C cleanly stops both servers within 5 seconds
- **Tasks**: 6

### US3: Custom Port Configuration

- **Type**: epic
- **Priority**: 3
- **Description**: Specify custom ports with `--port` and `--backend-port` flags
- **Tasks**: 7

### Polish: Cross-Cutting Concerns

- **Type**: epic
- **Priority**: 4
- **Description**: Improvements that affect multiple user stories including flags, documentation, and validation
- **Depends**: US1, US2, US3
- **Tasks**: 7

## Tasks

### Setup

| Title | Path |
|-------|------|
| Create cli/ directory structure per plan.md | cli/ |
| Initialize package.json with ESM and dependencies | cli/package.json |
| Configure TypeScript strict mode | cli/tsconfig.json |
| Configure Vitest for unit testing | cli/vitest.config.ts |

### Foundational

| Title | Path |
|-------|------|
| Define CLI types (CLIOptions, ServerStatus, ErrorCodes) | cli/src/types/index.ts |
| Implement Logger utility with colored output | cli/src/utils/logger.ts |
| Create CLI entry point skeleton with commander.js | cli/src/index.ts |

### US1: Start Gastown-Boy

| Title | Path |
|-------|------|
| Unit test for gastown directory detection | cli/tests/unit/gastown-detector.test.ts |
| Unit test for process spawning (mock child_process) | cli/tests/unit/process-manager.test.ts |
| Implement GastownDirectory detection service | cli/src/services/gastown-detector.ts |
| Implement ProcessManager with spawn logic | cli/src/services/process-manager.ts |
| Implement start command action handler | cli/src/commands/start.ts |
| Wire up CLI entry point to start command | cli/src/index.ts |
| Add error handling for non-gastown directory | cli/src/commands/start.ts |
| Add error handling for backend start failure | cli/src/services/process-manager.ts |
| Add error handling for frontend start failure | cli/src/services/process-manager.ts |
| Implement browser opening with open package | cli/src/commands/start.ts |
| Add startup progress logging (prefixed output) | cli/src/services/process-manager.ts |

### US2: Graceful Shutdown

| Title | Path |
|-------|------|
| Unit test for shutdown logic | cli/tests/unit/process-manager.test.ts |
| Add SIGINT/SIGTERM signal handlers | cli/src/index.ts |
| Implement shutdown() method in ProcessManager | cli/src/services/process-manager.ts |
| Add graceful shutdown with 5s timeout | cli/src/services/process-manager.ts |
| Add force kill (SIGKILL) after timeout | cli/src/services/process-manager.ts |
| Add shutdown progress logging | cli/src/services/process-manager.ts |

### US3: Custom Port Configuration

| Title | Path |
|-------|------|
| Unit test for port availability checking | cli/tests/unit/port-checker.test.ts |
| Implement PortChecker service | cli/src/services/port-checker.ts |
| Add --port option to CLI with env var support | cli/src/index.ts |
| Add --backend-port option to CLI with env var support | cli/src/index.ts |
| Validate ports are different and available | cli/src/commands/start.ts |
| Add port conflict error messages | cli/src/commands/start.ts |
| Pass custom ports to server processes | cli/src/services/process-manager.ts |

### Polish

| Title | Path |
|-------|------|
| Add --no-browser flag for headless operation | cli/src/index.ts |
| Add --version flag with package.json version | cli/src/index.ts |
| Add --help output with examples | cli/src/index.ts |
| Implement duplicate instance detection (already running) | cli/src/commands/start.ts |
| Add JSDoc documentation to all public functions | cli/src/ |
| Run build and verify gt-boy command works via npm link | - |
| Validate against quickstart.md scenarios | - |

## Summary

| Phase | Tasks | Priority |
|-------|-------|----------|
| Setup | 4 | 1 |
| Foundational | 3 | 1 |
| US1 (MVP) | 11 | 1 |
| US2 | 6 | 2 |
| US3 | 7 | 3 |
| Polish | 7 | 4 |
| **Total** | **38** | |

## MVP Scope

- Setup: 4 tasks
- Foundational: 3 tasks
- US1: 11 tasks
- **Total**: 18 tasks

## Dependency Graph

```
Setup (P1)
    │
    ▼
Foundational (P1) ──blocks──► US1, US2, US3
    │
    ▼
US1: Start (P1, MVP) ◄── MVP STOP POINT
    │
    ▼
US2: Shutdown (P2)
    │
    ▼
US3: Custom Ports (P3)
    │
    ▼
Polish (P4) ◄── depends on US1, US2, US3
```

## Notes

- TDD required per constitution: write tests first, verify they fail before implementation
- Each user story is independently testable after completion
- ESM imports require `.js` extensions in TypeScript
- Foundational phase BLOCKS all user stories - must complete first
- US2 extends ProcessManager from US1; US3 extends CLI options from US1
- Polish phase depends on all user stories being complete
