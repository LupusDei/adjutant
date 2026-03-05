# Tasks: Acceptance Test Fixture Framework

**Input**: Design documents from `/specs/030-acceptance-test-fixtures/`
**Epic**: `adj-035`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-035.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Setup

**Purpose**: Define types and project structure for the acceptance framework

- [ ] T001 Define acceptance framework types (Scenario, UserStory, StepDefinition, HarnessConfig, ParseResult) in `backend/src/acceptance/types.ts`
- [ ] T002 [P] Create directory structure (`backend/src/acceptance/`, `backend/src/acceptance/steps/`, `backend/tests/acceptance/`) and add npm scripts to `backend/package.json`

---

## Phase 2: Foundational — Spec Parser

**Purpose**: Parse spec.md files into structured GWT scenario data — blocks all downstream phases

- [ ] T003 Build markdown spec parser: extract User Stories with title/priority and acceptance scenarios with Given/When/Then text in `backend/src/acceptance/spec-parser.ts`
- [ ] T004 Add FR-xxx requirement ID extraction and user story association to spec parser in `backend/src/acceptance/spec-parser.ts`
- [ ] T005 Write spec parser unit tests (valid specs, malformed input, empty specs, multi-line scenarios) in `backend/tests/unit/spec-parser.test.ts`

**Checkpoint**: Parser returns structured scenario data from any existing spec.md

---

## Phase 3: US1 — Test Fixture Harness (Priority: P1, MVP)

**Goal**: Reusable test harness that spins up real Express + SQLite for API-level acceptance tests
**Independent Test**: Import harness, create instance, make HTTP request, verify response

- [ ] T006 [US1] Create TestHarness class with Express app + SQLite lifecycle (setup/teardown, port isolation, temp dir) in `backend/src/acceptance/test-harness.ts`
- [ ] T007 [US1] Add supertest API client wrapper to TestHarness (request object, typed response helpers) in `backend/src/acceptance/test-harness.ts`
- [ ] T008 [US1] Add precondition seed helpers (seedMessage, seedAgent, seedProposal, seedBead) to TestHarness in `backend/src/acceptance/test-harness.ts`
- [ ] T009 [US1] Write harness unit tests (lifecycle, isolation, seed helpers, concurrent instances) in `backend/tests/unit/test-harness.test.ts`

**Checkpoint**: US1 independently functional — harness can run real API tests

---

## Phase 4: US2 — Test File Generator (Priority: P1)

**Goal**: Auto-generate Vitest .test.ts files from parsed spec scenarios
**Independent Test**: Generate test file from parsed spec, verify it type-checks and runs

- [ ] T010 [P] [US2] Build code generator: parsed scenarios → .test.ts source with describe/it blocks, GWT comments, and harness imports in `backend/src/acceptance/test-generator.ts`
- [ ] T011 [US2] Create step definition registry with defineGiven/defineWhen/defineThen and pattern matching in `backend/src/acceptance/step-registry.ts`
- [ ] T012 [P] [US2] Create built-in step definitions for common Adjutant patterns (agent connected, message sent/received, bead exists/closed) in `backend/src/acceptance/steps/common-steps.ts`
- [ ] T013 [US2] Write generator and step registry unit tests in `backend/tests/unit/test-generator.test.ts`

**Checkpoint**: US2 independently functional — can generate runnable test files from any spec

---

## Phase 5: US3 — CLI Runner & Reporting (Priority: P2)

**Goal**: Single CLI command to parse, generate, run, and report
**Independent Test**: Run CLI against a spec dir, see pass/fail output

- [ ] T014 [US3] Create CLI entry point with parse/generate/run modes in `backend/src/acceptance/cli.ts`
- [ ] T015 [US3] Build scenario-level pass/fail reporter with User Story grouping in `backend/src/acceptance/reporter.ts`
- [ ] T016 [US3] Write CLI integration tests (generate mode, run mode, report output) in `backend/tests/unit/acceptance-cli.test.ts`

---

## Dependencies

- Setup (Phase 1) → Foundational (Phase 2) → blocks all user stories
- Phase 3 (Harness) and Phase 4 (Generator) can run in parallel after Phase 2
- Phase 5 (CLI) depends on Phase 3 + Phase 4

## Parallel Opportunities

- T001 and T002 can run in parallel (different files)
- After Phase 2 checkpoint: Phase 3 and Phase 4 are independent tracks
- T010 and T012 can run in parallel (different files, no deps)
