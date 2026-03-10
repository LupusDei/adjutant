# Proposal Comments & Revisions - Beads

**Feature**: 040-proposal-comments-revisions
**Generated**: 2026-03-10
**Source**: specs/040-proposal-comments-revisions/tasks.md

## Root Epic

- **ID**: adj-068
- **Title**: Proposal comments & revisions
- **Type**: epic
- **Priority**: 2
- **Description**: Expand the proposal system with commenting, revisions, and discussion workflow integration. Agents and users can comment on proposals. Proposals can be revised (new versions) with full revision history. The discuss_proposal skill auto-creates comments and/or revisions.

## Epics

### Phase 1 — Database & Types
- **ID**: adj-068.1
- **Type**: epic
- **Priority**: 2
- **Tasks**: 2

### Phase 2 — Backend API
- **ID**: adj-068.2
- **Type**: epic
- **Priority**: 2
- **Blocks**: Phase 3, 4, 5
- **Tasks**: 6

### Phase 3 — iOS UI
- **ID**: adj-068.3
- **Type**: epic
- **Priority**: 2
- **Tasks**: 5

### Phase 4 — Skill Integration
- **ID**: adj-068.4
- **Type**: epic
- **Priority**: 2
- **Tasks**: 1

### Phase 5 — Tests
- **ID**: adj-068.5
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

## Tasks

### Phase 1 — Database & Types

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Add proposal_comments and proposal_revisions SQLite migration | backend/src/services/database.ts | adj-068.1.1 |
| T002 | Add ProposalComment, ProposalRevision types and Zod schemas | backend/src/types/proposals.ts | adj-068.1.2 |

### Phase 2 — Backend API

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T003 | Add comment CRUD to proposal-store | backend/src/services/proposal-store.ts | adj-068.2.1 |
| T004 | Add revision CRUD to proposal-store | backend/src/services/proposal-store.ts | adj-068.2.2 |
| T005 | Add comment REST routes | backend/src/routes/proposals.ts | adj-068.2.3 |
| T006 | Add revision REST routes | backend/src/routes/proposals.ts | adj-068.2.4 |
| T007 | Add comment MCP tools | backend/src/services/mcp-tools/proposals.ts | adj-068.2.5 |
| T008 | Add revision MCP tools | backend/src/services/mcp-tools/proposals.ts | adj-068.2.6 |

### Phase 3 — iOS UI

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T009 | Add ProposalComment and ProposalRevision Swift models | ios/AdjutantKit/Sources/AdjutantKit/Models/Proposal.swift | adj-068.3.1 |
| T010 | Add comment/revision API client methods | ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Proposals.swift | adj-068.3.2 |
| T011 | Add comments section to ProposalDetailView | ios/Adjutant/Features/Proposals/ProposalDetailView.swift | adj-068.3.3 |
| T012 | Add revision history section to ProposalDetailView | ios/Adjutant/Features/Proposals/ProposalDetailView.swift | adj-068.3.4 |
| T013 | Update ProposalDetailViewModel for comments and revisions | ios/Adjutant/Features/Proposals/ProposalDetailViewModel.swift | adj-068.3.5 |

### Phase 4 — Skill Integration

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T014 | Update discuss_proposal skill to use comment/revision tools | .claude/skills/discuss-proposal/SKILL.md | adj-068.4.1 |

### Phase 5 — Tests

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T015 | Proposal comment CRUD tests | backend/tests/unit/proposal-comments.test.ts | adj-068.5.1 |
| T016 | Proposal revision CRUD tests | backend/tests/unit/proposal-revisions.test.ts | adj-068.5.2 |
| T017 | Proposal MCP tools tests | backend/tests/unit/proposal-mcp-tools.test.ts | adj-068.5.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Database & Types | 2 | 2 | adj-068.1 |
| 2: Backend API | 6 | 2 | adj-068.2 |
| 3: iOS UI | 5 | 2 | adj-068.3 |
| 4: Skill Integration | 1 | 2 | adj-068.4 |
| 5: Tests | 3 | 2 | adj-068.5 |
| **Total** | **17** | | |

## Dependency Graph

Phase 1: DB & Types (adj-068.1)
    |
Phase 2: Backend API (adj-068.2)
    |
    +-------------------+-------------------+
    |                   |                   |
Phase 3: iOS UI     Phase 4: Skill      Phase 5: Tests
(adj-068.3)         (adj-068.4)         (adj-068.5)
    [parallel]          [parallel]          [parallel]

## Improvements

Improvements (Level 4: adj-068.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
