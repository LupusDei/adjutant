# Implementation Plan: Adjutant Bootstrap & Developer Setup

**Branch**: `011-bootstrap-setup` | **Date**: 2026-02-22
**Epic**: `adj-013` | **Priority**: P1

## Summary

Build a global CLI (`adjutant init`, `adjutant doctor`) that bootstraps and validates the full adjutant stack. The CLI creates `.adjutant/PRIME.md` (agent protocol), registers Claude Code hooks for auto-injection, validates `.mcp.json`, and checks all prerequisites. Written in TypeScript, installable via `npm install -g .`.

## Bead Map

- `adj-013` - Root: Adjutant Bootstrap & Developer Setup
  - `adj-013.1` - Foundation: CLI scaffold + PRIME.md + utilities
    - `adj-013.1.1` - CLI entry point with command routing
    - `adj-013.1.2` - PRIME.md agent protocol template
    - `adj-013.1.3` - Terminal output formatter
    - `adj-013.1.4` - bin field + tsconfig.cli.json
    - `adj-013.1.5` - .adjutant/PRIME.md content
  - `adj-013.2` - US1: adjutant init (MVP bootstrap)
    - `adj-013.2.1` - Shared check functions
    - `adj-013.2.2` - .adjutant/ dir + PRIME.md creation
    - `adj-013.2.3` - .mcp.json creation/validation
    - `adj-013.2.4` - Claude Code hook registration
    - `adj-013.2.5` - Dependency installation check
    - `adj-013.2.6` - SQLite database init check
    - `adj-013.2.7` - Init summary output
  - `adj-013.3` - US2: adjutant doctor (health check)
    - `adj-013.3.1` - File/directory existence checks
    - `adj-013.3.2` - Network checks (health, MCP SSE)
    - `adj-013.3.3` - Tool availability checks
    - `adj-013.3.4` - Hook registration check
    - `adj-013.3.5` - Doctor summary + exit code
  - `adj-013.4` - Polish: npm scripts, help, tests
    - `adj-013.4.1` - npm script aliases
    - `adj-013.4.2` - --help and --version flags
    - `adj-013.4.3` - Init command tests
    - `adj-013.4.4` - Doctor command tests
    - `adj-013.4.5` - Hook registration tests

## Technical Context

**Stack**: TypeScript (Node.js), no external CLI framework (simple arg parsing)
**Storage**: Reads/writes `~/.claude/settings.json` (JSON), creates `.adjutant/PRIME.md` (markdown)
**Testing**: Vitest for unit tests of each check/init step
**Constraints**: Must work on macOS and Linux. Must be idempotent. Must not clobber user config.

## Architecture Decision

**Simple arg parsing over commander.js**: The CLI has only 2 commands (`init`, `doctor`) with minimal flags (`--force`, `--verbose`). A switch statement on `process.argv[2]` is sufficient. No need for a dependency.

**TypeScript compiled to JS**: The `bin/adjutant` entry point uses `#!/usr/bin/env node` and points to the compiled `dist/cli/index.js`. The `npm install -g .` flow compiles first via `prepublishOnly`.

**Hook command**: `cat .adjutant/PRIME.md 2>/dev/null || true` — Simple, no binary dependency, silent no-op when file doesn't exist.

## Files Changed

| File | Change |
|------|--------|
| `cli/index.ts` | NEW — CLI entry point, command router |
| `cli/commands/init.ts` | NEW — Bootstrap command implementation |
| `cli/commands/doctor.ts` | NEW — Health check command implementation |
| `cli/lib/hooks.ts` | NEW — Claude Code hook registration (JSON merge) |
| `cli/lib/prime.ts` | NEW — PRIME.md template content + writer |
| `cli/lib/checks.ts` | NEW — Reusable check functions (shared by init + doctor) |
| `cli/lib/output.ts` | NEW — Terminal output formatting (colors, pass/fail/warn) |
| `.adjutant/PRIME.md` | NEW — Agent communication protocol (git-tracked template) |
| `package.json` | ADD `bin` field, `setup`/`doctor` scripts |
| `tsconfig.cli.json` | NEW — Separate tsconfig for CLI compilation |
| `backend/tests/unit/cli-init.test.ts` | NEW — Init command tests |
| `backend/tests/unit/cli-doctor.test.ts` | NEW — Doctor command tests |

## Phase 1: Foundation

Create the CLI scaffold, PRIME.md content, and output utilities. This unblocks both the init and doctor commands.

- CLI entry point with simple command routing
- PRIME.md template content (agent protocol document)
- Terminal output formatting (PASS/FAIL/WARN with colors)
- `package.json` bin field for global install

## Phase 2: US1 — `adjutant init` (MVP)

The bootstrap command that creates/validates all prerequisites:

1. Check and create `.adjutant/` directory
2. Write `.adjutant/PRIME.md` from template (skip if exists unless `--force`)
3. Check and create `.mcp.json` at project root
4. Register Claude Code hooks in `~/.claude/settings.json` (safe JSON merge)
5. Check and install backend/frontend dependencies
6. Initialize SQLite database (run backend database init)
7. Print summary of what was created vs already existed

Hook registration is the trickiest part — must parse existing JSON, check if hooks already exist, merge new entries, and write back without clobbering.

## Phase 3: US2 — `adjutant doctor`

Health check that validates the running system:

| Check | Method | Pass | Fail |
|-------|--------|------|------|
| `.adjutant/PRIME.md` exists | `fs.existsSync` | PASS | FAIL: run `adjutant init` |
| `.mcp.json` exists and valid | Parse JSON, check `mcpServers.adjutant` | PASS | FAIL |
| `bd` CLI installed | `which bd` | PASS | WARN: beads not available |
| Claude Code hooks registered | Parse `~/.claude/settings.json` | PASS | WARN: run `adjutant init` |
| Backend server reachable | `fetch http://localhost:4201/health` | PASS | FAIL: run `npm run dev` |
| MCP SSE endpoint responds | `fetch http://localhost:4201/mcp/sse` (HEAD) | PASS | FAIL |
| SQLite database exists | `fs.existsSync ~/.adjutant/adjutant.db` | PASS | WARN: start backend first |
| Dependencies installed | Check `node_modules/` dirs | PASS | FAIL: run `npm run install:all` |
| API keys configured | Check `~/.gastown/api-keys.json` | INFO (optional) | INFO: open mode |
| `.claude/skills/adjutant-agent/` | Check skill files exist | PASS | WARN |

Exit code: 0 if all critical checks pass, 1 if any FAIL.

## Phase 4: Polish

- `npm run setup` and `npm run doctor` script aliases in package.json
- `adjutant --help` output
- `adjutant --version` from package.json version
- Tests for init and doctor commands

## Parallel Execution

- Phase 1 (Foundation) must complete first
- Phase 2 (init) and Phase 3 (doctor) can run in parallel after Phase 1 — they share `cli/lib/checks.ts` but touch different command files
- Phase 4 (polish) depends on both Phase 2 and Phase 3

## Verification Steps

- [ ] `npm install -g .` succeeds and `adjutant --help` works
- [ ] Fresh directory: `adjutant init` creates all artifacts
- [ ] `adjutant init` again: no overwrites, reports "already configured"
- [ ] `adjutant doctor` with server running: all PASS
- [ ] `adjutant doctor` with server stopped: reports FAIL for server checks
- [ ] New Claude Code session: PRIME.md content appears in context
- [ ] Context compaction: PRIME.md re-injected
