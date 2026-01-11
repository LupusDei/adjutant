# Tasks: CLI Launcher

**Input**: Design documents from `/specs/002-cli-launcher/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Included per project constitution (TDD for services)

**Organization**: Tasks grouped by user story for independent implementation and testing

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Initialize the CLI package structure

- [ ] T001 Create cli/ directory structure per plan.md in cli/
- [ ] T002 Initialize package.json with ESM and dependencies in cli/package.json
- [ ] T003 [P] Configure TypeScript strict mode in cli/tsconfig.json
- [ ] T004 [P] Configure Vitest for unit testing in cli/vitest.config.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types and utilities that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Define CLI types (CLIOptions, ServerStatus, ErrorCodes) in cli/src/types/index.ts
- [ ] T006 [P] Implement Logger utility with colored output in cli/src/utils/logger.ts
- [ ] T007 [P] Create CLI entry point skeleton with commander.js in cli/src/index.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Start Gastown-Boy (Priority: P1) 🎯 MVP

**Goal**: Run `gt-boy` from a gastown directory to start backend, frontend, and open browser

**Independent Test**: Run `gt-boy` from a directory with `.beads/`, verify servers start and browser opens

### Tests for User Story 1 (TDD per constitution)

- [ ] T008 [P] [US1] Unit test for gastown directory detection in cli/tests/unit/gastown-detector.test.ts
- [ ] T009 [P] [US1] Unit test for process spawning (mock child_process) in cli/tests/unit/process-manager.test.ts

### Implementation for User Story 1

- [ ] T010 [US1] Implement GastownDirectory detection service in cli/src/services/gastown-detector.ts
- [ ] T011 [US1] Implement ProcessManager with spawn logic in cli/src/services/process-manager.ts
- [ ] T012 [US1] Implement start command action handler in cli/src/commands/start.ts
- [ ] T013 [US1] Wire up CLI entry point to start command in cli/src/index.ts
- [ ] T014 [US1] Add error handling for non-gastown directory in cli/src/commands/start.ts
- [ ] T015 [US1] Add error handling for backend start failure in cli/src/services/process-manager.ts
- [ ] T016 [US1] Add error handling for frontend start failure in cli/src/services/process-manager.ts
- [ ] T017 [US1] Implement browser opening with open package in cli/src/commands/start.ts
- [ ] T018 [US1] Add startup progress logging (prefixed output) in cli/src/services/process-manager.ts

**Checkpoint**: User Story 1 complete - can run `gt-boy` and launch the system

---

## Phase 4: User Story 2 - Graceful Shutdown (Priority: P2)

**Goal**: Ctrl+C cleanly stops both servers within 5 seconds

**Independent Test**: Run `gt-boy`, press Ctrl+C, verify both servers stop and terminal returns

### Tests for User Story 2 (TDD per constitution)

- [ ] T019 [P] [US2] Unit test for shutdown logic in cli/tests/unit/process-manager.test.ts

### Implementation for User Story 2

- [ ] T020 [US2] Add SIGINT/SIGTERM signal handlers in cli/src/index.ts
- [ ] T021 [US2] Implement shutdown() method in ProcessManager in cli/src/services/process-manager.ts
- [ ] T022 [US2] Add graceful shutdown with 5s timeout in cli/src/services/process-manager.ts
- [ ] T023 [US2] Add force kill (SIGKILL) after timeout in cli/src/services/process-manager.ts
- [ ] T024 [US2] Add shutdown progress logging in cli/src/services/process-manager.ts

**Checkpoint**: User Story 2 complete - graceful shutdown works

---

## Phase 5: User Story 3 - Custom Port Configuration (Priority: P3)

**Goal**: Specify custom ports with `--port` and `--backend-port` flags

**Independent Test**: Run `gt-boy --port 4000`, verify UI accessible on port 4000

### Tests for User Story 3 (TDD per constitution)

- [ ] T025 [P] [US3] Unit test for port availability checking in cli/tests/unit/port-checker.test.ts

### Implementation for User Story 3

- [ ] T026 [US3] Implement PortChecker service in cli/src/services/port-checker.ts
- [ ] T027 [US3] Add --port option to CLI with env var support in cli/src/index.ts
- [ ] T028 [US3] Add --backend-port option to CLI with env var support in cli/src/index.ts
- [ ] T029 [US3] Validate ports are different and available in cli/src/commands/start.ts
- [ ] T030 [US3] Add port conflict error messages in cli/src/commands/start.ts
- [ ] T031 [US3] Pass custom ports to server processes in cli/src/services/process-manager.ts

**Checkpoint**: User Story 3 complete - custom ports work

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T032 [P] Add --no-browser flag for headless operation in cli/src/index.ts
- [ ] T033 [P] Add --version flag with package.json version in cli/src/index.ts
- [ ] T034 [P] Add --help output with examples in cli/src/index.ts
- [ ] T035 Implement duplicate instance detection (already running) in cli/src/commands/start.ts
- [ ] T036 Add JSDoc documentation to all public functions in cli/src/
- [ ] T037 Run build and verify gt-boy command works via npm link
- [ ] T038 Validate against quickstart.md scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - US1 → US2 → US3 (sequential by priority)
  - US2 extends ProcessManager from US1
  - US3 extends CLI options from US1
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
    │
    ▼
Phase 2 (Foundational)
    │
    ▼
Phase 3 (US1: Start) ◄── MVP STOP POINT
    │
    ▼
Phase 4 (US2: Shutdown)
    │
    ▼
Phase 5 (US3: Custom Ports)
    │
    ▼
Phase 6 (Polish)
```

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD)
- Services before commands
- Core implementation before error handling
- Story complete before moving to next priority

### Parallel Opportunities

**Phase 1 (Setup)**:
```
Task: T003 "Configure TypeScript strict mode"
Task: T004 "Configure Vitest for unit testing"
```

**Phase 2 (Foundational)**:
```
Task: T006 "Implement Logger utility"
Task: T007 "Create CLI entry point skeleton"
```

**Phase 3 (US1 Tests)**:
```
Task: T008 "Unit test for gastown directory detection"
Task: T009 "Unit test for process spawning"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test `gt-boy` from a gastown directory
5. Deploy/demo if ready - core functionality works!

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → **MVP!** (can launch gt-boy)
3. Add User Story 2 → Test independently → Clean shutdown
4. Add User Story 3 → Test independently → Custom ports
5. Polish phase → Production ready

### Estimated Task Counts

| Phase | Task Count | Parallel Opportunities |
|-------|------------|------------------------|
| Phase 1: Setup | 4 | 2 |
| Phase 2: Foundational | 3 | 2 |
| Phase 3: US1 | 12 | 2 |
| Phase 4: US2 | 6 | 1 |
| Phase 5: US3 | 7 | 1 |
| Phase 6: Polish | 7 | 3 |
| **Total** | **39** | **11** |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story (US1, US2, US3)
- Each user story is independently testable after completion
- TDD required per constitution: write tests first, verify they fail
- ESM imports require `.js` extensions in TypeScript
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
