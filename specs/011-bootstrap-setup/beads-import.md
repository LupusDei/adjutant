# Adjutant Bootstrap & Developer Setup - Beads

**Feature**: 011-bootstrap-setup
**Generated**: 2026-02-22
**Source**: specs/011-bootstrap-setup/tasks.md

## Root Epic

- **ID**: adj-013
- **Title**: Adjutant Bootstrap & Developer Setup
- **Type**: epic
- **Priority**: 1
- **Description**: Global CLI (adjutant init, adjutant doctor) that bootstraps and validates the full adjutant stack. Creates .adjutant/PRIME.md for agent auto-protocol, registers Claude Code hooks, validates prerequisites.

## Epics

### Phase 1 — Foundation: CLI scaffold + PRIME.md + utilities
- **ID**: adj-013.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 5

### Phase 2 — US1: `adjutant init` (MVP)
- **ID**: adj-013.2
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 7

### Phase 3 — US2: `adjutant doctor`
- **ID**: adj-013.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 5

### Phase 4 — Polish: Scripts, help, tests
- **ID**: adj-013.4
- **Type**: epic
- **Priority**: 2
- **Depends**: US1, US2
- **Tasks**: 5

## Tasks

### Phase 1 — Foundation

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | CLI entry point with command routing | `cli/index.ts` | adj-013.1.1 |
| T002 | PRIME.md agent protocol template | `cli/lib/prime.ts` | adj-013.1.2 |
| T003 | Terminal output formatter | `cli/lib/output.ts` | adj-013.1.3 |
| T004 | bin field + tsconfig.cli.json | `package.json`, `tsconfig.cli.json` | adj-013.1.4 |
| T005 | .adjutant/PRIME.md content | `.adjutant/PRIME.md` | adj-013.1.5 |

### Phase 2 — US1: `adjutant init`

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T006 | Shared check functions | `cli/lib/checks.ts` | adj-013.2.1 |
| T007 | .adjutant/ dir + PRIME.md creation | `cli/commands/init.ts` | adj-013.2.2 |
| T008 | .mcp.json creation/validation | `cli/commands/init.ts` | adj-013.2.3 |
| T009 | Claude Code hook registration | `cli/lib/hooks.ts` | adj-013.2.4 |
| T010 | Dependency installation check | `cli/commands/init.ts` | adj-013.2.5 |
| T011 | SQLite database init check | `cli/commands/init.ts` | adj-013.2.6 |
| T012 | Init summary output | `cli/commands/init.ts` | adj-013.2.7 |

### Phase 3 — US2: `adjutant doctor`

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T013 | File/directory existence checks | `cli/commands/doctor.ts` | adj-013.3.1 |
| T014 | Network checks (health, MCP SSE) | `cli/commands/doctor.ts` | adj-013.3.2 |
| T015 | Tool availability checks (bd, node_modules) | `cli/commands/doctor.ts` | adj-013.3.3 |
| T016 | Hook registration check | `cli/commands/doctor.ts` | adj-013.3.4 |
| T017 | Doctor summary + exit code | `cli/commands/doctor.ts` | adj-013.3.5 |

### Phase 4 — Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T018 | npm script aliases (setup, doctor) | `package.json` | adj-013.4.1 |
| T019 | --help and --version flags | `cli/index.ts` | adj-013.4.2 |
| T020 | Init command tests | `backend/tests/unit/cli-init.test.ts` | adj-013.4.3 |
| T021 | Doctor command tests | `backend/tests/unit/cli-doctor.test.ts` | adj-013.4.4 |
| T022 | Hook registration tests | `backend/tests/unit/cli-hooks.test.ts` | adj-013.4.5 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundation | 5 | 1 | adj-013.1 |
| 2: US1 - init (MVP) | 7 | 1 | adj-013.2 |
| 3: US2 - doctor | 5 | 1 | adj-013.3 |
| 4: Polish | 5 | 2 | adj-013.4 |
| **Total** | **22** | | |

## Dependency Graph

```
Phase 1: Foundation (adj-013.1)
    |
    +---> Phase 2: US1 init (adj-013.2, MVP)
    |         |
    |         +---> T006 (shared checks) --blocks--> Phase 3 T013-T016
    |
    +---> Phase 3: US2 doctor (adj-013.3)  [partially parallel with Phase 2]
    |
    +-------+-------+
            |
    Phase 4: Polish (adj-013.4)
```

## Improvements

Improvements (Level 4: adj-013.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
