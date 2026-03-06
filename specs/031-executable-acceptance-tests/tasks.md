# Tasks: Executable Acceptance Test Generation

**Input**: Design documents from `/specs/031-executable-acceptance-tests/`
**Epic**: `adj-039`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-039.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Setup

**Purpose**: Define types and regex patterns for the pattern detector

- [ ] T001 Define pattern detector types (DetectedApiCall, DetectedAssertion, DetectedPrecondition, ScenarioClassification) in `backend/src/acceptance/types.ts`
- [ ] T002 Write pattern detector unit tests (TDD: red first) covering POST/GET/PATCH extraction, query params, body parsing, assertion detection, precondition detection in `backend/tests/unit/pattern-detector.test.ts`

---

## Phase 2: Foundational — GWT Pattern Detector

**Purpose**: Extract structured API patterns from GWT text — blocks code generator

- [ ] T003 Build When-clause API pattern detector: extract HTTP method, path, query params, request body from natural language in `backend/src/acceptance/pattern-detector.ts`
- [ ] T004 Build Then-clause assertion detector: extract expected response fields, status codes, field values, existence checks in `backend/src/acceptance/pattern-detector.ts`
- [ ] T005 Build Given-clause precondition detector: determine seed data requirements (proposals, messages, agents) and map to harness seed methods in `backend/src/acceptance/pattern-detector.ts`
- [ ] T006 Make all pattern detector tests pass in `backend/tests/unit/pattern-detector.test.ts`

**Checkpoint**: Pattern detector extracts structured data from any GWT text in existing specs

---

## Phase 3: US1 — Smart Code Generator (Priority: P1, MVP)

**Goal**: Generator produces executable test code for API scenarios, skips UI/agent scenarios
**Independent Test**: Generate + run 017-agent-proposals, US1 scenarios pass

- [ ] T007 [US1] Rewrite generateTestContent: classify each scenario (api-testable / step-matched / ui-only / agent-behavior / unknown) and route to appropriate code emitter in `backend/src/acceptance/test-generator.ts`
- [ ] T008 [US1] Implement API scenario code emitter: generate inline supertest calls with harness.post/get/patch + expect assertions using detected patterns in `backend/src/acceptance/test-generator.ts`
- [ ] T009 [US1] Implement it.skip() generation for UI-only and agent-behavior scenarios with reason comments in `backend/src/acceptance/test-generator.ts`
- [ ] T010 [US1] Wire step registry into generation: for scenarios matching registered steps, emit executeStep() calls with harness in `backend/src/acceptance/test-generator.ts`
- [ ] T011 [US1] Update generator unit tests for new code generation patterns in `backend/tests/unit/test-generator.test.ts`

**Checkpoint**: Generator produces real executable tests from any spec with API scenarios

---

## Phase 4: US2 — Test DB Lifecycle Hardening (Priority: P1)

**Goal**: Bulletproof test database setup/teardown with no resource leaks

- [ ] T012 [P] [US2] Audit and harden TestHarness.destroy(): idempotent, safe after partial setup, safe after errors in `backend/src/acceptance/test-harness.ts`
- [ ] T013 [P] [US2] Add temp directory cleanup verification: after test suite runs, assert no orphaned adjutant-harness-* dirs in `backend/tests/unit/test-harness.test.ts`
- [ ] T014 [US2] Write lifecycle edge case tests: destroy after partial setup, destroy called twice, parallel instances in `backend/tests/unit/test-harness.test.ts`

**Checkpoint**: Harness is bulletproof — no leaks under any failure scenario

---

## Phase 5: Proof of Concept

**Purpose**: End-to-end validation against a real spec

- [ ] T015 Regenerate 017-agent-proposals acceptance tests with new generator (delete old, generate fresh) in `backend/tests/acceptance/`
- [ ] T016 Run acceptance tests, verify US1 REST scenarios pass, US3/US4/US5 skipped, report output correct
- [ ] T017 Fix any issues discovered during proof-of-concept run

---

## Dependencies

- Setup (Phase 1) → Foundational (Phase 2) → Smart Generator (Phase 3) → PoC (Phase 5)
- Phase 4 (Harness hardening) can run in parallel with Phases 2-3
- Phase 5 depends on Phase 3 + Phase 4

## Parallel Opportunities

- T001 and T002 can run in parallel
- T012, T013 can run in parallel with Phase 2 and Phase 3 (different files)
- After Phase 3: Phase 4 tests (T014) and Phase 5 can begin
