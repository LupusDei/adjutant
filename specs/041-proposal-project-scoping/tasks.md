# Tasks: Proposal Project Scoping

**Input**: Design documents from `/specs/041-proposal-project-scoping/`
**Epic**: `adj-072`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-072.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1=Frontend, US2=iOS, US3=MCP Enforcement, US4=Skill)

## Phase 1: Backend MCP Enforcement

**Purpose**: Auto-scope proposal creation and listing to agent's project via MCP context

- [ ] T001 [US3] Auto-set project from agent session context in `create_proposal` MCP tool, ignore client-supplied project. Default `list_proposals` to agent's project when no filter specified. In `backend/src/services/mcp-tools/proposals.ts`
- [ ] T002 [US3] Auto-scope `discuss_proposal` and `comment_on_proposal` to validate proposal belongs to agent's project. In `backend/src/services/mcp-tools/proposals.ts`

**Checkpoint**: MCP tools enforce project scoping server-side

---

## Phase 2: Frontend Filtering

**Purpose**: Wire active project into proposal list fetching

- [ ] T003 [US1] Add project parameter to `useProposals` hook and pass to API call. In `frontend/src/hooks/useProposals.ts`
- [ ] T004 [US1] Read `selectedProject` from `ProjectContext` in ProposalsView and pass to useProposals. In `frontend/src/components/proposals/ProposalsView.tsx`

**Checkpoint**: Frontend proposal list filters by active project

---

## Phase 3: iOS Filtering

**Purpose**: Wire active project into iOS proposal list

- [ ] T005 [US2] Add project parameter to `fetchProposals` API client method. In `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Proposals.swift`
- [ ] T006 [US2] Pass active project to ProposalsViewModel fetch calls. In `ios/Adjutant/Features/Proposals/ProposalsViewModel.swift`

**Checkpoint**: iOS proposal list filters by active project

---

## Phase 4: Skill Update

**Purpose**: Prevent cross-project proposal execution

- [ ] T007 [US4] Update execute_proposal skill to check proposal.project matches agent's current project before execution. Decline gracefully via send_message if mismatch. In `.claude/skills/execute-proposal/SKILL.md`

**Checkpoint**: Cross-project proposal execution is declined

---

## Phase 5: Tests

**Purpose**: Backend test coverage for project scoping

- [ ] T008 [P] [US3] Tests for MCP create_proposal auto-scoping and list_proposals project defaulting. In `backend/tests/unit/proposal-project-scoping.test.ts`
- [ ] T009 [P] [US3] Tests for cross-project validation in discuss/comment tools. In `backend/tests/unit/proposal-project-scoping.test.ts`

---

## Dependencies

- Phase 1 (T001, T002) → blocks all other phases
- T001 and T002 are sequential (both edit proposals MCP tools)
- Phase 2 (T003-T004) → depends on Phase 1
- Phase 3 (T005-T006) → depends on Phase 1
- Phase 4 (T007) → depends on Phase 1
- Phase 5 (T008-T009) → depends on Phase 1
- Phases 2, 3, 4, 5 can run in parallel

## Parallel Opportunities

- After Phase 1: Phases 2, 3, 4, 5 can run in parallel (different codebases/files)
- T003 and T004 are sequential (T004 depends on T003's hook changes)
- T005 and T006 are sequential (T006 depends on T005's API method)
- T008 and T009 can run in parallel (different test cases in same file)
