# Tasks: Agent Proposals System

**Input**: Design documents from `/specs/017-agent-proposals/`
**Epic**: `adj-021`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-021.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Foundational

**Purpose**: Data model, types, and storage layer — everything else depends on this.

- [ ] T001 Create proposals SQLite migration in `backend/src/services/migrations/003-proposals.sql`
- [ ] T002 Create Zod schemas and TypeScript types in `backend/src/types/proposals.ts`
- [ ] T003 Create ProposalStore class in `backend/src/services/proposal-store.ts`

**Checkpoint**: ProposalStore can insert, query, and update proposals in SQLite

---

## Phase 2: US1+US2 — Backend API + MCP Tools

**Goal**: REST endpoints for frontend/iOS and MCP tools for agents
**Independent Test**: curl POST/GET/PATCH proposals, MCP tool calls succeed

- [ ] T004 [P] [US1] Create proposals REST routes in `backend/src/routes/proposals.ts`
- [ ] T005 [P] [US1] Export proposalsRouter from `backend/src/routes/index.ts`
- [ ] T006 [P] [US2] Create MCP proposal tools in `backend/src/services/mcp-tools/proposals.ts`
- [ ] T007 [US1+US2] Mount proposals router and register MCP tools in `backend/src/index.ts`

**Checkpoint**: API and MCP tools functional, tested via curl/MCP client

---

## Phase 3: US3 — Frontend Proposals Tab (MVP)

**Goal**: Proposals tab in web UI with accept/dismiss/filter
**Independent Test**: Open Proposals tab, see proposals, accept/dismiss, filter by type

- [ ] T008 [US3] Add proposals API methods to `frontend/src/services/api.ts`
- [ ] T009 [US3] Create useProposals hook in `frontend/src/hooks/useProposals.ts`
- [ ] T010 [US3] Export useProposals from `frontend/src/hooks/index.ts`
- [ ] T011 [P] [US3] Create ProposalCard component in `frontend/src/components/proposals/ProposalCard.tsx`
- [ ] T012 [US3] Create ProposalsView component in `frontend/src/components/proposals/ProposalsView.tsx`
- [ ] T013 [US3] Create component exports in `frontend/src/components/proposals/index.ts`
- [ ] T014 [US3] Add "proposals" tab to App.tsx (TabId, TABS array, section render)

**Checkpoint**: Proposals tab fully functional in web UI

---

## Phase 4: US4 — iOS Proposals Tab

**Goal**: Proposals tab in iOS app mirroring web functionality
**Independent Test**: Open Proposals tab on iOS, see proposals, accept/dismiss

- [ ] T015 [P] [US4] Create Proposal Swift model in `ios/Adjutant/Core/Networking/Models/Proposal.swift`
- [ ] T016 [US4] Add proposals methods to APIClient in `ios/Adjutant/Core/Networking/APIClient+Proposals.swift`
- [ ] T017 [US4] Create ProposalsViewModel in `ios/Adjutant/Features/Proposals/ProposalsViewModel.swift`
- [ ] T018 [P] [US4] Create ProposalCard SwiftUI view in `ios/Adjutant/Features/Proposals/ProposalCard.swift`
- [ ] T019 [US4] Create ProposalsView in `ios/Adjutant/Features/Proposals/ProposalsView.swift`
- [ ] T020 [US4] Register Proposals tab in `ios/Adjutant/Core/Navigation/Coordinator.swift` and `MainTabView.swift`

**Checkpoint**: iOS Proposals tab functional

---

## Phase 5: US5 — Agent Proposal Behavior

**Goal**: Document and codify agent proposal mode protocol
**Independent Test**: Agent enters proposal mode, spawns teammates, proposals appear

- [ ] T021 [US5] Document agent proposal protocol (spawn prompts, uniqueness check, proposal mode trigger)

**Checkpoint**: Agent behavior documented and ready for implementation

---

## Phase 6: Polish — Tests & Integration

**Purpose**: Verification and test coverage

- [ ] T022 [P] Backend unit tests for ProposalStore in `backend/tests/unit/proposal-store.test.ts`
- [ ] T023 [P] Backend unit tests for proposals routes in `backend/tests/unit/proposals-routes.test.ts`
- [ ] T024 [P] Frontend unit tests for useProposals hook in `frontend/tests/unit/useProposals.test.ts`
- [ ] T025 End-to-end verification: agent MCP → DB → REST → UI

---

## Dependencies

- Phase 1 (Foundational) → blocks all other phases
- Phase 2 (API + MCP) → blocks Phase 3 (Frontend), Phase 4 (iOS)
- Phase 3 and Phase 4 can run in parallel after Phase 2
- Phase 5 can run in parallel with Phases 3-4 (documentation only)
- Phase 6 depends on Phases 1-4

## Parallel Opportunities

- T004, T005, T006 can run in parallel within Phase 2 (different files)
- T011 can run in parallel with T009 (component vs hook, no deps)
- T015, T018 can run in parallel with other iOS tasks (model/card are independent)
- Phase 3 and Phase 4 are fully parallel after Phase 2
- T022, T023, T024 can all run in parallel (different test files)
