# Implementation Plan: Acceptance Test Fixture Framework

**Branch**: `030-acceptance-test-fixtures` | **Date**: 2026-03-04
**Epic**: `adj-035` | **Priority**: P1

## Summary

Build a CLI-driven acceptance testing framework that parses Given/When/Then scenarios from spec.md files, auto-generates Vitest test files with a real-services harness (Express + SQLite), and reports pass/fail per acceptance criterion. The framework lives alongside existing unit tests and reuses the project's established patterns (supertest, freshTestDir, dynamic imports).

## Bead Map

- `adj-035` - Root: Acceptance Test Fixture Framework
  - `adj-035.1` - Setup: Types & project scaffold
    - `adj-035.1.1` - Define acceptance framework types
    - `adj-035.1.2` - Create directory structure and package.json scripts
  - `adj-035.2` - Foundational: Spec Parser
    - `adj-035.2.1` - Build markdown parser for GWT extraction
    - `adj-035.2.2` - Extract functional requirement IDs (FR-xxx)
    - `adj-035.2.3` - Write spec parser unit tests
  - `adj-035.3` - US1: Test Fixture Harness (MVP)
    - `adj-035.3.1` - Create test harness with Express + SQLite lifecycle
    - `adj-035.3.2` - Add API client wrapper (supertest integration)
    - `adj-035.3.3` - Add precondition helpers (seed data, create agent)
    - `adj-035.3.4` - Write harness unit tests
  - `adj-035.4` - US2: Test File Generator
    - `adj-035.4.1` - Build code generator (parsed scenarios → .test.ts)
    - `adj-035.4.2` - Create step definition registry
    - `adj-035.4.3` - Write generator unit tests
  - `adj-035.5` - US3: CLI Runner & Reporting
    - `adj-035.5.1` - Create CLI entry point (parse, generate, run)
    - `adj-035.5.2` - Build pass/fail reporter with scenario-level output
    - `adj-035.5.3` - Write CLI integration tests

## Technical Context

**Stack**: TypeScript 5.x, Vitest, Express, supertest, better-sqlite3
**Storage**: Temporary SQLite per test (existing `freshTestDir` pattern)
**Testing**: Vitest (same framework as production tests)
**Constraints**: Must coexist with existing `backend/tests/unit/` tests without interference

## Architecture Decision

**Why auto-generated test files over a runtime Cucumber-style interpreter?**

1. **IDE support**: Generated .test.ts files get full TypeScript intellisense, type checking, and debugging
2. **Familiar patterns**: Developers see standard Vitest describe/it blocks, not a custom DSL
3. **Incremental adoption**: Generate stubs, implement step-by-step — no all-or-nothing migration
4. **Build safety**: Generated files go through `npm run build` type-checking like all other code

**Where does the framework live?**

All framework code in `backend/src/acceptance/` — separate from production code but sharing the same build pipeline. Generated tests land in `backend/tests/acceptance/` alongside existing `backend/tests/unit/`.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/acceptance/types.ts` | Framework types (Scenario, UserStory, StepDef, etc.) |
| `backend/src/acceptance/spec-parser.ts` | Markdown parser: spec.md → structured scenarios |
| `backend/src/acceptance/test-harness.ts` | Reusable Express + SQLite test fixture |
| `backend/src/acceptance/test-generator.ts` | Code generator: scenarios → .test.ts files |
| `backend/src/acceptance/step-registry.ts` | Step definition registry (Given/When/Then matching) |
| `backend/src/acceptance/steps/` | Built-in step definitions for common patterns |
| `backend/src/acceptance/cli.ts` | CLI entry point for generate + run + report |
| `backend/src/acceptance/reporter.ts` | Pass/fail reporter with scenario grouping |
| `backend/tests/acceptance/` | Generated acceptance test files |
| `backend/tests/unit/spec-parser.test.ts` | Parser unit tests |
| `backend/tests/unit/test-harness.test.ts` | Harness unit tests |
| `backend/tests/unit/test-generator.test.ts` | Generator unit tests |
| `backend/package.json` | Add `acceptance` and `acceptance:generate` scripts |
| `backend/vitest.config.ts` | Add acceptance test config (or separate config file) |

## Phase 1: Setup

Define the type system and project structure. Types for parsed scenarios, step definitions, harness configuration. Create the `backend/src/acceptance/` directory. Add npm scripts.

## Phase 2: Foundational — Spec Parser

Build the core markdown parser. It reads spec.md, finds `**Acceptance Scenarios**:` sections, parses numbered GWT lists, and returns structured data. Also extracts FR-xxx requirement IDs and maps them to user stories. This blocks all other phases since the generator and CLI depend on parsed output.

**Parsing strategy**: Line-by-line state machine. States: `SEEKING_STORY` → `IN_STORY` → `IN_SCENARIOS` → `IN_SCENARIO`. Bold keyword markers (`**Given**`, `**When**`, `**Then**`) are the delimiters. Multi-line scenarios (common in existing specs) are handled by accumulating until the next numbered item or section header.

## Phase 3: US1 — Test Fixture Harness (MVP)

Create a `TestHarness` class that encapsulates the existing test patterns:
- `freshTestDir()` for temp directory
- `setupDb()` for SQLite with migrations
- Express app creation with all production routes mounted
- supertest `request` object ready to use
- Cleanup in a single `destroy()` call

Precondition helpers: `harness.seedMessage(...)`, `harness.seedAgent(...)`, `harness.seedBead(...)`. These call the real service layer, not raw SQL.

## Phase 4: US2 — Test File Generator

Code generator that takes parsed scenarios and emits .test.ts source code. Each User Story becomes a `describe` block. Each scenario becomes an `it` block with:
- GWT comments as documentation
- Step registry lookups for implemented steps
- `// TODO: implement step definition` for unmatched steps
- Proper imports (harness, step registry, vitest globals)

Step definition registry: `defineGiven(pattern, fn)`, `defineWhen(pattern, fn)`, `defineThen(pattern, fn)`. Pattern matching via exact string or regex. Built-in steps for common Adjutant patterns (agent connected, message sent, bead created).

## Phase 5: US3 — CLI Runner & Reporting

CLI entry point: `npx tsx backend/src/acceptance/cli.ts <spec-dir> [--generate]`
- `--generate`: Parse spec.md, generate test files
- Default: Run existing acceptance tests via Vitest programmatic API
- Reporter: Table output grouped by User Story, showing pass/fail/pending per scenario

npm scripts:
- `npm run acceptance:generate -- specs/017-agent-proposals` — generate test files
- `npm run acceptance -- specs/017-agent-proposals` — run acceptance tests
- `npm run acceptance` — run all acceptance tests

## Parallel Execution

- After Phase 2 (parser), Phase 3 (harness) and Phase 4 (generator) can run in parallel — they share types but don't depend on each other's implementation
- Phase 5 (CLI) depends on all prior phases

## Verification Steps

- [ ] `npm run build` passes with all new files
- [ ] `npm test` passes (existing tests unaffected)
- [ ] Parser correctly extracts scenarios from `specs/017-agent-proposals/spec.md`
- [ ] Generator produces valid TypeScript that passes type-checking
- [ ] Harness creates isolated Express+SQLite instances per test
- [ ] `npm run acceptance:generate -- specs/017-agent-proposals` produces test files
- [ ] `npm run acceptance -- specs/017-agent-proposals` runs and reports pass/fail
