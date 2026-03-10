# Tasks: Proposal Comments & Revisions

**Input**: Design documents from `/specs/040-proposal-comments-revisions/`
**Epic**: `adj-068`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-068.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1=Comments, US2=Revisions, US3=Skill Integration)

## Phase 1: Database & Types

**Purpose**: Schema migration + TypeScript types + Zod schemas for comments and revisions

- [ ] T001 [US1,US2] Add SQLite migration for `proposal_comments` and `proposal_revisions` tables in `backend/src/services/database.ts`
- [ ] T002 [P] [US1,US2] Add `ProposalComment`, `ProposalRevision` types, Zod schemas, and row types in `backend/src/types/proposals.ts`

**Checkpoint**: Types and tables exist

---

## Phase 2: Backend API

**Purpose**: Store methods, REST routes, and MCP tools for comments and revisions

- [ ] T003 [US1] Add `insertComment`, `getComments` methods to proposal-store in `backend/src/services/proposal-store.ts`
- [ ] T004 [US2] Add `insertRevision`, `getRevisions`, `reviseProposal` methods to proposal-store in `backend/src/services/proposal-store.ts`
- [ ] T005 [US1] Add `POST /api/proposals/:id/comments` and `GET /api/proposals/:id/comments` routes in `backend/src/routes/proposals.ts`
- [ ] T006 [US2] Add `POST /api/proposals/:id/revisions` and `GET /api/proposals/:id/revisions` routes in `backend/src/routes/proposals.ts`
- [ ] T007 [US1] Add `comment_on_proposal` and `list_proposal_comments` MCP tools in `backend/src/services/mcp-tools/proposals.ts`
- [ ] T008 [US2] Add `revise_proposal` and `list_revisions` MCP tools in `backend/src/services/mcp-tools/proposals.ts`

**Checkpoint**: Backend API fully functional — comments and revisions work via REST and MCP

---

## Phase 3: iOS UI

**Purpose**: Display comments and revision history in proposal detail view

- [ ] T009 [P] [US1,US2] Add `ProposalComment` and `ProposalRevision` Swift models in `ios/AdjutantKit/Sources/AdjutantKit/Models/Proposal.swift`
- [ ] T010 [P] [US1,US2] Add API client methods (`fetchComments`, `postComment`, `fetchRevisions`) in `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Proposals.swift`
- [ ] T011 [US1] Add comments section to proposal detail view in `ios/Adjutant/Features/Proposals/ProposalDetailView.swift`
- [ ] T012 [US2] Add revision history section to proposal detail view in `ios/Adjutant/Features/Proposals/ProposalDetailView.swift`
- [ ] T013 [US1,US2] Update ProposalDetailViewModel to load comments and revisions in `ios/Adjutant/Features/Proposals/ProposalDetailViewModel.swift`

**Checkpoint**: iOS proposal detail shows comments and revision history

---

## Phase 4: Skill Integration

**Purpose**: Update discuss_proposal skill to use new comment/revision tools

- [ ] T014 [US3] Update discuss_proposal skill instructions to call `comment_on_proposal` for review findings and/or `revise_proposal` when improvements are identified in `.claude/skills/discuss-proposal/SKILL.md`

**Checkpoint**: discuss_proposal skill records reviews as comments and can create revisions

---

## Phase 5: Tests

**Purpose**: Backend test coverage for comments and revisions

- [ ] T015 [P] [US1] Tests for proposal comment CRUD (insert, list, 404 for bad proposal) in `backend/tests/unit/proposal-comments.test.ts`
- [ ] T016 [P] [US2] Tests for proposal revision CRUD (insert, list, latest-wins, revision numbering) in `backend/tests/unit/proposal-revisions.test.ts`
- [ ] T017 [P] [US1,US2] Tests for MCP tools (comment_on_proposal, revise_proposal, list_revisions) in `backend/tests/unit/proposal-mcp-tools.test.ts`

---

## Dependencies

- Phase 1 (T001, T002) → blocks all other phases
- Phase 2 (T003-T008) → depends on Phase 1, blocks Phase 3-5
- T003 and T004 are sequential (both edit proposal-store.ts)
- T005 and T006 are sequential (both edit proposals routes)
- T007 and T008 are sequential (both edit proposals MCP tools)
- Phase 3 (T009-T013) → depends on Phase 2
- Phase 4 (T014) → depends on Phase 2
- Phase 5 (T015-T017) → depends on Phase 2
- Phases 3, 4, 5 can run in parallel

## Parallel Opportunities

- T001 and T002 can run in parallel (different files)
- After Phase 2: Phases 3, 4, 5 can run in parallel (different codebases)
- T009 and T010 can run in parallel (different iOS files)
- T015, T016, T017 can run in parallel (different test files)
