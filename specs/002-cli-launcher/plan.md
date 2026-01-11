# Implementation Plan: CLI Launcher

**Branch**: `002-cli-launcher` | **Date**: 2026-01-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-cli-launcher/spec.md`

## Summary

Create a `gt-boy` CLI command that launches the gastown-boy system from a gastown directory. The CLI will start the backend server, frontend dev server, and open the browser - all managed as child processes with graceful shutdown on Ctrl+C.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode per constitution)
**Primary Dependencies**: Node.js child_process, commander.js (CLI parsing), open (browser launch)
**Storage**: N/A (CLI tool with no persistence)
**Testing**: Vitest for unit tests
**Target Platform**: macOS, Linux (Windows support deferred)
**Project Type**: CLI tool (extends existing web application)
**Performance Goals**: Start time <10 seconds, shutdown time <5 seconds
**Constraints**: Must detect gastown directory, manage multiple child processes
**Scale/Scope**: Single user CLI tool

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type Safety First | ✅ Pass | TypeScript strict mode; typed CLI args with commander.js |
| II. Test-First Development | ✅ Pass | Unit tests for CLI logic (process management, validation) |
| III. UI Performance | ✅ N/A | CLI tool, no UI rendering |
| IV. Documentation | ✅ Pass | JSDoc on public functions; --help output |
| V. Simplicity | ✅ Pass | Single entry point spawning existing servers |

**Gate Result**: PASS - Proceed to Phase 0

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
cli/
├── src/
│   ├── index.ts             # CLI entry point (gt-boy command)
│   ├── commands/
│   │   └── start.ts         # Main start command logic
│   ├── services/
│   │   ├── gastown-detector.ts  # Detect valid gastown directory
│   │   ├── process-manager.ts   # Start/stop backend & frontend
│   │   └── port-checker.ts      # Check port availability
│   ├── types/
│   │   └── index.ts         # CLI-specific types
│   └── utils/
│       └── logger.ts        # Terminal output formatting
├── tests/
│   └── unit/
│       ├── gastown-detector.test.ts
│       ├── process-manager.test.ts
│       └── port-checker.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts

# Existing structure (from feature 001)
backend/                     # Started by CLI as child process
frontend/                    # Started by CLI as child process
```

**Structure Decision**: New `cli/` directory alongside existing `frontend/` and `backend/`. The CLI is a separate package that orchestrates the other two. This maintains separation of concerns - the CLI knows how to start servers, but the servers don't know about the CLI.

## Complexity Tracking

> No constitution violations requiring justification.

| Decision | Rationale | Simpler Alternative |
|----------|-----------|---------------------|
| Separate cli/ package | Clean separation from web app | Could add to backend, but CLI is independent concern |
| commander.js for parsing | Standard CLI library, typed | Manual arg parsing would work but less maintainable |
