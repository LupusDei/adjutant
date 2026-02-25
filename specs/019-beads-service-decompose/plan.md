# Implementation Plan: Decompose beads-service.ts

**Branch**: `019-beads-service-decompose` | **Date**: 2026-02-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/019-beads-service-decompose/spec.md`

## Summary

Decompose the monolithic `backend/src/services/beads-service.ts` (1,395 lines, 20+ exported functions) into 4 focused sub-modules under `backend/src/services/beads/`. Each module owns a single responsibility: CLI access (repository), data filtering, dependency graph logic, and sorting. A barrel `index.ts` re-exports everything to preserve the existing import API. Zero breaking changes to routes or consumers.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: Express, Zod, bd-client (CLI wrapper), Node.js EventEmitter
**Storage**: SQLite (beads databases via bd CLI) — no direct DB access, all through bd-client
**Testing**: Vitest — 87+ existing tests across 4 test files
**Target Platform**: Node.js backend server
**Project Type**: Web application (backend only for this feature)
**Performance Goals**: No regression — identical response times for all API endpoints
**Constraints**: Zero breaking changes to existing imports, routes, or test logic
**Scale/Scope**: 1 file (1,395 lines) → 5 files (~200-400 lines each)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type Safety First | PASS | All modules remain strict TypeScript. No new `as` casts. Zod validation stays in place. |
| II. Test-First Development | PASS | Existing tests preserved. New sub-module tests written TDD-style. |
| III. UI Performance | N/A | Backend-only refactoring. No UI changes. |
| IV. Documentation | PASS | JSDoc preserved on all moved functions. Module-level docs added. |
| V. Simplicity | PASS | Decomposition follows natural responsibility boundaries already implicit in the code. No new abstractions — just separation. |

All gates pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/019-beads-service-decompose/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (module dependency map)
├── quickstart.md        # Phase 1 output (migration guide)
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
backend/src/services/
├── beads/                       # NEW: decomposed modules
│   ├── index.ts                 # Barrel: re-exports all public functions + types
│   ├── beads-repository.ts      # CLI access: execBd calls, prefix map, multi-DB orchestration
│   ├── beads-filter.ts          # Pure functions: status/type/wisp filtering, deduplication
│   ├── beads-dependency.ts      # Graph: edge extraction, epic progress, auto-complete
│   ├── beads-sorter.ts          # Pure functions: priority/date/status sorting
│   └── types.ts                 # Shared types: BeadInfo, BeadDetail, options interfaces
├── beads-service.ts             # DELETED after migration complete
└── bd-client.ts                 # Unchanged: low-level CLI wrapper

backend/tests/unit/
├── beads/                       # NEW: per-module test files
│   ├── beads-repository.test.ts # Repository tests (mock bd-client)
│   ├── beads-filter.test.ts     # Filter tests (pure functions, no mocks)
│   ├── beads-dependency.test.ts # Dependency tests (pure functions, no mocks)
│   └── beads-sorter.test.ts     # Sorter tests (pure functions, no mocks)
├── beads-service.test.ts        # UPDATED: import paths only
├── beads-graph.test.ts          # UPDATED: import paths only
├── beads-graph-route.test.ts    # Unchanged (tests routes, not service internals)
└── beads-routes.test.ts         # Unchanged (tests routes, not service internals)
```

**Structure Decision**: Web application backend. The new `beads/` directory sits alongside the existing `bd-client.ts` under `backend/src/services/`. This follows the existing pattern of service directories (e.g., `mcp-tools/` already uses this structure).
