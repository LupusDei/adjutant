# 049 — Auto-Develop V2: Tasks

## Phase 1: Infrastructure & Types

- [ ] T001 [US1,US3,US4] Add DB migration: `escalation_count` INTEGER DEFAULT 0 and `last_escalation_at` TEXT on `auto_develop_cycles`; add `proposal_id` TEXT on beads (or junction table `proposal_epics`) in `backend/src/services/database.ts`
- [ ] T002 [P] [US4] Add `proposal:completed` and `ideate:research_complete` event types to EventMap in `backend/src/services/event-bus.ts`; add corresponding timeline event mappings in `backend/src/routes/events.ts`
- [ ] T003 [P] [US2,US3] Define `IdeateSubState`, `EscalationState`, `ResearchFindings` types in `backend/src/types/auto-develop.ts`; extend `AutoDevelopPhase` with sub-state support

## Phase 2: Thorough VALIDATE (US1)

- [ ] T004 [US1] Rewrite `buildValidateReason()` in `backend/src/services/adjutant/behaviors/auto-develop-loop.ts` to include the epic's spec acceptance criteria (read from spec.md or proposal description) and instruct coordinator to spawn QA Sentinels with explicit checklist
- [ ] T005 [US1] Create QA Sentinel spawn prompt template in `backend/src/services/adjutant/behaviors/auto-develop-loop.ts` — includes acceptance criteria, instructions to run the app, check end-to-end usability, create bug beads for failures
- [ ] T006 [US1] Add VALIDATE advancement gating: before advancing from VALIDATE, check for open P0/P1 bug beads under the epic; if any exist, stay in VALIDATE (or return to EXECUTE) in `backend/src/services/mcp-tools/auto-develop.ts`
- [ ] T007 [US1] Write tests for VALIDATE behavior: test that prompt includes acceptance criteria, test that advancement is blocked when P0/P1 bugs exist, test happy path advancement in `backend/tests/unit/auto-develop-validate.test.ts`

## Phase 3: Research-Backed IDEATE (US2)

- [ ] T008 [US2] Implement `buildResearchReason()` in `backend/src/services/adjutant/behaviors/auto-develop-loop.ts` — constructs prompt with project vision, README excerpt, inspiration sources, instructions to WebSearch and analyze codebase
- [ ] T009 [US2] Add research findings context to `buildIdeateReason()` — when research results are available (stored in cycle meta), include them as context for proposal generation
- [ ] T010 [US2] Write tests for research-backed ideation: test research prompt includes vision context, test ideation prompt includes research findings in `backend/tests/unit/auto-develop-ideate.test.ts`

## Phase 4: Never-Idle Loop (US3)

- [ ] T011 [US3] Implement IDEATE sub-state machine in `backend/src/services/adjutant/behaviors/auto-develop-loop.ts`: `ideate` → `ideate:research` → `ideate:refine` → `ideate:escalate`; track sub-state in AdjutantState meta
- [ ] T012 [US3] Build escalation message template: structured MCP message to user with what was tried, what's exhausted, what kind of direction would help; include different research angles per attempt
- [ ] T013 [US3] Add escalation tracking to `auto_develop_cycles` via `auto-develop-store.ts`: increment `escalation_count`, set `last_escalation_at`, configurable timeout (default 1hr), pause after 3 strikes
- [ ] T014 [US3] Write tests for never-idle behavior: test sub-state transitions, test escalation counting, test pause after 3 strikes, test resume on user vision update in `backend/tests/unit/auto-develop-never-idle.test.ts`

## Phase 5: Proposal Lifecycle (US4, US5)

- [ ] T015 [US4] Emit `proposal:completed` event when epic linked to proposal is closed: add hook in `close_bead` MCP tool (`backend/src/services/mcp-tools/beads.ts`) that checks for proposal linkage and emits event
- [ ] T016 [US5] Auto-complete stale proposals: add `bead:updated` event listener in `backend/src/services/adjutant/behaviors/auto-develop-loop.ts` that checks if all beads linked to a proposal are closed; if so, update proposal status to "completed"
- [ ] T017 [P] [US4] Add timeline rendering for `proposal:completed` events in frontend (`frontend/src/components/`) and iOS (`ios/Adjutant/`) — distinct icon/color
- [ ] T018 [US4,US5] Write tests for proposal lifecycle: test event emission on epic close, test auto-complete on all beads closed, test stale proposal detection in `backend/tests/unit/proposal-lifecycle.test.ts`

## Phase 6: Execution & Loop Fixes (US6, US7, US8)

- [ ] T019 [P] [US6] Enhance `buildExecuteReason()` in `backend/src/services/adjutant/behaviors/auto-develop-loop.ts` to analyze epic dependencies and instruct coordinator to assign independent epics to separate agents
- [ ] T020 [P] [US7] Add work-existence check before cycle creation in auto-develop-loop `act()`: if no pending proposals AND no open beads AND no accepted proposals, enter never-idle research instead of creating empty cycle
- [ ] T021 [P] [US7] Make `idle-proposal-nudge.ts` auto-develop-aware: skip nudging agents whose project has auto-develop enabled (check project settings before scheduling nudge)
- [ ] T022 [P] [US8] Fix cycle counter sync: count only proposals created during current cycle (filter by `created_at >= cycle.started_at`); add `proposal:scored` event handler for real-time counter updates
- [ ] T023 [US6,US7,US8] Write tests for execution and loop fixes: parallel assignment logic, empty cycle prevention, idle-nudge auto-develop check, counter accuracy in `backend/tests/unit/auto-develop-execution.test.ts`
