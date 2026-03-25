# Tasks: Code Quality & Testing Guarantees

**Input**: Design documents from `/specs/045-code-quality-testing-guarantees/`
**Epic**: `adj-120`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-120.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Build & Script Infrastructure

**Purpose**: Root-level scripts, lint-in-build, and coverage thresholds — foundation for all enforcement

- [ ] T001 [US1] Add root-level `test`, `lint`, `test:coverage`, and `test:integration` scripts to `package.json` that orchestrate backend + frontend
- [ ] T002 [P] [US1] Update `backend/package.json` build script to run lint before tsc: `"build": "npm run lint && tsc"`
- [ ] T003 [P] [US1] Update `frontend/package.json` build script to run lint before vite build: `"build": "npm run lint && vite build"`
- [ ] T004 [P] [US1] Add coverage thresholds to `backend/vitest.config.ts`: lines 80%, branches 70%, functions 60%
- [ ] T005 [P] [US1] Add coverage thresholds to `frontend/vitest.config.ts`: lines 80%, branches 70%, functions 60%
- [ ] T006 [US1] Write tests verifying: root `npm test` runs both suites; `npm run build` fails on lint errors; coverage threshold enforcement works in `backend/tests/unit/build-infrastructure.test.ts`

**Checkpoint**: `npm test`, `npm run build`, and `npm run test:coverage` all work correctly from project root

---

## Phase 2: Git Hook Enforcement

**Purpose**: Pre-push gate that blocks pushing broken code

- [ ] T007 [US2] Create `.git/hooks/pre-push` script that runs `npm run lint && npm test`, with `wip/*` branch bypass in `.git/hooks/pre-push`
- [ ] T008 [US2] Document hook installation in project README or CLAUDE.md — hooks are not tracked by git, so agents need to know how to install them
- [ ] T009 [US2] Write test for hook logic: verify lint+test gate runs, verify WIP bypass works in `backend/tests/unit/pre-push-hook.test.ts`

**Checkpoint**: `git push` blocked on lint/test failures; `wip/*` branches bypass

---

## Phase 3: Testing Constitution & Agent Rules

**Purpose**: Mechanical testing instructions every agent follows

- [ ] T010 [US4] Rewrite `.claude/rules/03-testing.md` with comprehensive mechanical testing instructions: exact file paths, minimum test counts per entity type, naming conventions, coverage commands, TDD step-by-step with examples
- [ ] T011 [P] [US4] Create `.claude/rules/08-code-review.md` defining the code review protocol: when reviews happen, what they check, how findings are reported
- [ ] T012 [P] [US4] Update the team agent spawn prompt block (in PRIME.md / Adjutant Agent Protocol) to include the full testing verification checklist and coverage requirements
- [ ] T013 [US4] Update the `squad-execute` skill to include testing requirements in all squad member spawn prompts — engineers must write tests, QA must verify coverage in `.claude/skills/squad-execute/SKILL.md`

**Checkpoint**: Every agent spawn prompt includes mechanical testing instructions

---

## Phase 4: Automated Code Review

**Purpose**: Structured code review skill that catches quality issues before merge

- [ ] T014 [US3] Create `/code-review` skill at `.claude/skills/code-review/SKILL.md` — reads git diff, analyzes changed files for: test coverage, code quality, architectural conformance, security issues, and produces structured findings
- [ ] T015 [US3] Integrate code review into squad-execute completion flow — after all engineers complete, code reviewer agent runs before merge in `.claude/skills/squad-execute/SKILL.md`
- [ ] T016 [US3] Write tests for code review skill: verify it catches missing tests, lint issues, and security concerns in `backend/tests/unit/code-review-skill.test.ts`

**Checkpoint**: Code review skill produces actionable findings on test diffs

---

## Phase 5: Integration Test Infrastructure

**Purpose**: Cross-service integration tests that catch boundary bugs

- [ ] T017 [US5] Create integration test harness: test Express server startup, test SQLite database, request helpers in `backend/tests/integration/helpers/test-harness.ts`
- [ ] T018 [US5] Create vitest config for integration tests with longer timeouts and real I/O settings in `backend/vitest.integration.config.ts`
- [ ] T019 [P] [US5] Write REST API integration tests: message endpoints, agent endpoints, beads endpoints in `backend/tests/integration/api-routes.test.ts`
- [ ] T020 [P] [US5] Write MCP tool integration tests: messaging tools → message store, status tools → event store in `backend/tests/integration/mcp-tools.test.ts`
- [ ] T021 [P] [US5] Write WebSocket integration tests: connect, authenticate, send/receive messages, broadcast in `backend/tests/integration/ws-chat.test.ts`
- [ ] T022 [US5] Add `test:integration` script to `backend/package.json` using the integration vitest config

**Checkpoint**: Integration tests catch at least one boundary issue that unit tests miss

---

## Phase 6: CI Pipeline Hardening

**Purpose**: CI runs the full quality gate — nothing ships without passing

- [ ] T023 [US6] Update `.github/workflows/ci.yml`: remove `continue-on-error` from lint, add `npm test` step, add `npm run test:coverage` step
- [ ] T024 [P] [US6] Add coverage artifact upload to CI — store coverage reports as GitHub Actions artifacts in `.github/workflows/ci.yml`
- [ ] T025 [US6] Verify CI catches failures: push a branch with lint error and failing test, confirm CI blocks

**Checkpoint**: CI fails on lint errors, test failures, and coverage drops

---

## Dependencies

- Phase 1 (Build infra) → blocks all other phases (scripts must exist before hooks/CI can use them)
- Phase 2, 3, 4, 5, 6 can run in parallel after Phase 1
- Within Phase 5: T017 + T018 block T019-T022 (harness must exist before integration tests)
- T022 depends on T019-T021 (script references integration tests that must exist)

## Parallel Opportunities

- T002, T003, T004, T005 can all run in parallel (different files)
- T010, T011, T012 can run in parallel (different files)
- T019, T020, T021 can run in parallel (different test files)
- T023, T024 can run in parallel (different sections of CI config — but be careful of merge conflicts)
- After Phase 1 completes, Phases 2-6 are fully parallelizable across 5 agents
