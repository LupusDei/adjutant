# Executable Acceptance Test Generation - Beads

**Feature**: 031-executable-acceptance-tests
**Generated**: 2026-03-06
**Source**: specs/031-executable-acceptance-tests/tasks.md

## Root Epic

- **ID**: adj-039
- **Title**: Executable Acceptance Test Generation
- **Type**: epic
- **Priority**: 1
- **Description**: Upgrade generator to produce real executable test code instead of TODO stubs. Pattern detector, step registry wiring, DB lifecycle hardening.

## Epics

### Phase 1 — Setup: Types & Pattern Foundation
- **ID**: adj-039.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 2 — Foundational: GWT Pattern Detector
- **ID**: adj-039.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: US1, PoC
- **Tasks**: 4

### Phase 3 — US1: Smart Code Generator (MVP)
- **ID**: adj-039.3
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 5

### Phase 4 — US2: Test DB Lifecycle Hardening
- **ID**: adj-039.4
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 5 — Proof of Concept
- **ID**: adj-039.5
- **Type**: epic
- **Priority**: 1
- **Depends**: US1, US2
- **Tasks**: 3

## Tasks

### Phase 1 — Setup

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Define pattern detector types | `backend/src/acceptance/types.ts` | adj-039.1.1 |
| T002 | Write pattern detector unit tests (TDD) | `backend/tests/unit/pattern-detector.test.ts` | adj-039.1.2 |

### Phase 2 — Foundational: GWT Pattern Detector

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T003 | Build When-clause API pattern detector | `backend/src/acceptance/pattern-detector.ts` | adj-039.2.1 |
| T004 | Build Then-clause assertion detector | `backend/src/acceptance/pattern-detector.ts` | adj-039.2.2 |
| T005 | Build Given-clause precondition detector | `backend/src/acceptance/pattern-detector.ts` | adj-039.2.3 |
| T006 | Make all pattern detector tests pass | `backend/tests/unit/pattern-detector.test.ts` | adj-039.2.4 |

### Phase 3 — US1: Smart Code Generator

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Rewrite generateTestContent with scenario classification | `backend/src/acceptance/test-generator.ts` | adj-039.3.1 |
| T008 | Implement API scenario code emitter | `backend/src/acceptance/test-generator.ts` | adj-039.3.2 |
| T009 | Implement it.skip() for UI/agent scenarios | `backend/src/acceptance/test-generator.ts` | adj-039.3.3 |
| T010 | Wire step registry into generation | `backend/src/acceptance/test-generator.ts` | adj-039.3.4 |
| T011 | Update generator unit tests | `backend/tests/unit/test-generator.test.ts` | adj-039.3.5 |

### Phase 4 — US2: Test DB Lifecycle Hardening

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T012 | Harden TestHarness.destroy() | `backend/src/acceptance/test-harness.ts` | adj-039.4.1 |
| T013 | Add temp directory cleanup verification | `backend/tests/unit/test-harness.test.ts` | adj-039.4.2 |
| T014 | Write lifecycle edge case tests | `backend/tests/unit/test-harness.test.ts` | adj-039.4.3 |

### Phase 5 — Proof of Concept

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T015 | Regenerate 017 acceptance tests | `backend/tests/acceptance/` | adj-039.5.1 |
| T016 | Verify pass/fail/skip results | - | adj-039.5.2 |
| T017 | Fix issues from PoC run | - | adj-039.5.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Setup | 2 | 1 | adj-039.1 |
| 2: Foundational | 4 | 1 | adj-039.2 |
| 3: US1 (MVP) | 5 | 1 | adj-039.3 |
| 4: US2 | 3 | 1 | adj-039.4 |
| 5: PoC | 3 | 1 | adj-039.5 |
| **Total** | **17** | | |

## Dependency Graph

Phase 1: Setup (adj-039.1)
    |
Phase 2: Foundational (adj-039.2) --blocks--> US1
    |
Phase 3: US1 (adj-039.3, MVP)     Phase 4: US2 (adj-039.4)  [parallel]
    |                               |
    +-------+-------+-------+-------+
            |
    Phase 5: PoC (adj-039.5)
