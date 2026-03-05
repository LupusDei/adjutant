# Acceptance Test Fixture Framework - Beads

**Feature**: 030-acceptance-test-fixtures
**Generated**: 2026-03-04
**Source**: specs/030-acceptance-test-fixtures/tasks.md

## Root Epic

- **ID**: adj-035
- **Title**: Acceptance Test Fixture Framework
- **Type**: epic
- **Priority**: 1
- **Description**: Parse GWT acceptance criteria from spec.md, auto-generate Vitest test files, provide real-services test harness, and report pass/fail per scenario.

## Epics

### Phase 1 — Setup: Types & Project Scaffold
- **ID**: adj-035.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 2 — Foundational: Spec Parser
- **ID**: adj-035.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: US1, US2, US3
- **Tasks**: 3

### Phase 3 — US1: Test Fixture Harness (MVP)
- **ID**: adj-035.3
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 4

### Phase 4 — US2: Test File Generator
- **ID**: adj-035.4
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 5 — US3: CLI Runner & Reporting
- **ID**: adj-035.5
- **Type**: epic
- **Priority**: 2
- **Depends**: US1, US2
- **Tasks**: 3

## Tasks

### Phase 1 — Setup

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Define acceptance framework types | `backend/src/acceptance/types.ts` | adj-035.1.1 |
| T002 | Create directory structure and npm scripts | `backend/package.json` | adj-035.1.2 |

### Phase 2 — Foundational: Spec Parser

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T003 | Build markdown spec parser for GWT extraction | `backend/src/acceptance/spec-parser.ts` | adj-035.2.1 |
| T004 | Add FR-xxx requirement ID extraction | `backend/src/acceptance/spec-parser.ts` | adj-035.2.2 |
| T005 | Write spec parser unit tests | `backend/tests/unit/spec-parser.test.ts` | adj-035.2.3 |

### Phase 3 — US1: Test Fixture Harness

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T006 | Create TestHarness class with Express + SQLite lifecycle | `backend/src/acceptance/test-harness.ts` | adj-035.3.1 |
| T007 | Add supertest API client wrapper | `backend/src/acceptance/test-harness.ts` | adj-035.3.2 |
| T008 | Add precondition seed helpers | `backend/src/acceptance/test-harness.ts` | adj-035.3.3 |
| T009 | Write harness unit tests | `backend/tests/unit/test-harness.test.ts` | adj-035.3.4 |

### Phase 4 — US2: Test File Generator

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T010 | Build code generator (scenarios → .test.ts) | `backend/src/acceptance/test-generator.ts` | adj-035.4.1 |
| T011 | Create step definition registry | `backend/src/acceptance/step-registry.ts` | adj-035.4.2 |
| T012 | Create built-in step definitions | `backend/src/acceptance/steps/common-steps.ts` | adj-035.4.3 |
| T013 | Write generator and step registry tests | `backend/tests/unit/test-generator.test.ts` | adj-035.4.4 |

### Phase 5 — US3: CLI Runner & Reporting

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T014 | Create CLI entry point | `backend/src/acceptance/cli.ts` | adj-035.5.1 |
| T015 | Build scenario-level pass/fail reporter | `backend/src/acceptance/reporter.ts` | adj-035.5.2 |
| T016 | Write CLI integration tests | `backend/tests/unit/acceptance-cli.test.ts` | adj-035.5.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Setup | 2 | 1 | adj-035.1 |
| 2: Foundational | 3 | 1 | adj-035.2 |
| 3: US1 (MVP) | 4 | 1 | adj-035.3 |
| 4: US2 | 4 | 1 | adj-035.4 |
| 5: US3 | 3 | 2 | adj-035.5 |
| **Total** | **16** | | |

## Dependency Graph

Phase 1: Setup (adj-035.1)
    |
Phase 2: Foundational (adj-035.2) --blocks--> US1, US2, US3
    |
Phase 3: US1 (adj-035.3, MVP)  Phase 4: US2 (adj-035.4)  [parallel]
    |                               |
    +-------+-------+-------+-------+
            |
    Phase 5: US3 (adj-035.5)

## Improvements

Improvements (Level 4: adj-035.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
