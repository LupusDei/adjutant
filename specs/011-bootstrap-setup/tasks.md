# Tasks: Adjutant Bootstrap & Developer Setup

**Input**: Design documents from `/specs/011-bootstrap-setup/`
**Epic**: `adj-013`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-xxx.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, US3)

## Phase 1: Foundation

**Purpose**: CLI scaffold, PRIME.md template, shared utilities

- [ ] T001 Create CLI entry point with command routing in `cli/index.ts`
- [ ] T002 [P] Create PRIME.md agent protocol template in `cli/lib/prime.ts`
- [ ] T003 [P] Create terminal output formatter (PASS/FAIL/WARN colors) in `cli/lib/output.ts`
- [ ] T004 Add `bin` field and `tsconfig.cli.json` for CLI compilation in `package.json`, `tsconfig.cli.json`
- [ ] T005 Create `.adjutant/PRIME.md` with agent communication protocol in `.adjutant/PRIME.md`

**Checkpoint**: `adjutant --help` works after `npm install -g .`

---

## Phase 2: US1 — `adjutant init` (Priority: P1, MVP)

**Goal**: Bootstrap command that creates all prerequisites from scratch
**Independent Test**: Delete `.adjutant/`, `.mcp.json`, run `adjutant init`, verify recreation

- [ ] T006 [US1] Create shared check functions (file exists, JSON valid, command available) in `cli/lib/checks.ts`
- [ ] T007 [US1] Implement `.adjutant/` directory and PRIME.md creation in `cli/commands/init.ts`
- [ ] T008 [US1] Implement `.mcp.json` creation/validation in `cli/commands/init.ts`
- [ ] T009 [US1] Implement Claude Code hook registration (safe JSON merge) in `cli/lib/hooks.ts`
- [ ] T010 [US1] Implement dependency installation check in `cli/commands/init.ts`
- [ ] T011 [US1] Implement SQLite database initialization check in `cli/commands/init.ts`
- [ ] T012 [US1] Add init summary output (created/skipped/failed counts) in `cli/commands/init.ts`

**Checkpoint**: `adjutant init` bootstraps a fresh clone end-to-end

---

## Phase 3: US2 — `adjutant doctor` (Priority: P1)

**Goal**: Health check that validates the running system
**Independent Test**: Stop backend, run `adjutant doctor`, verify failure report

- [ ] T013 [US2] Implement file/directory existence checks in `cli/commands/doctor.ts`
- [ ] T014 [P] [US2] Implement network checks (backend health, MCP SSE) in `cli/commands/doctor.ts`
- [ ] T015 [P] [US2] Implement tool availability checks (bd CLI, node_modules) in `cli/commands/doctor.ts`
- [ ] T016 [US2] Implement hook registration check in `cli/commands/doctor.ts`
- [ ] T017 [US2] Add doctor summary with exit code logic in `cli/commands/doctor.ts`

**Checkpoint**: `adjutant doctor` reports accurate pass/fail for all checks

---

## Phase 4: Polish & Cross-Cutting

- [ ] T018 [P] Add `npm run setup` and `npm run doctor` script aliases in `package.json`
- [ ] T019 [P] Add `adjutant --help` and `adjutant --version` output in `cli/index.ts`
- [ ] T020 Write unit tests for init command in `backend/tests/unit/cli-init.test.ts`
- [ ] T021 [P] Write unit tests for doctor command in `backend/tests/unit/cli-doctor.test.ts`
- [ ] T022 Write unit tests for hook registration in `backend/tests/unit/cli-hooks.test.ts`

---

## Dependencies

- Foundation (Phase 1) → blocks all other phases
- US1 (Phase 2) and US2 (Phase 3) can run in parallel after Foundation
- T006 (shared checks) blocks T013-T016 (doctor uses same check functions)
- Polish (Phase 4) depends on US1 + US2 complete

## Parallel Opportunities

- Tasks marked [P] within a phase can run simultaneously
- After Foundation, US1 (init) and US2 (doctor) can run in parallel on different files
- T020, T021, T022 can all run in parallel
