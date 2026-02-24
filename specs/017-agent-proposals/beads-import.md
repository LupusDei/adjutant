# Agent Proposals System - Beads

**Feature**: 017-agent-proposals
**Generated**: 2026-02-24
**Source**: specs/017-agent-proposals/tasks.md

## Root Epic

- **ID**: adj-021
- **Title**: Agent Proposals System
- **Type**: epic
- **Priority**: 2
- **Description**: System for idle agents to generate improvement proposals (product/UX and engineering). Includes SQLite storage, REST API, MCP tools, web frontend tab, iOS tab, and agent behavior protocol.

## Epics

### Phase 1 — Foundational: Data Model & Store
- **ID**: adj-021.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — US1+US2: Backend API + MCP Tools
- **ID**: adj-021.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 3, Phase 4
- **Tasks**: 4

### Phase 3 — US3: Frontend Proposals Tab
- **ID**: adj-021.3
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 7

### Phase 4 — US4: iOS Proposals Tab
- **ID**: adj-021.4
- **Type**: epic
- **Priority**: 2
- **Tasks**: 6

### Phase 5 — US5: Agent Proposal Behavior
- **ID**: adj-021.5
- **Type**: epic
- **Priority**: 2
- **Tasks**: 1

### Phase 6 — Polish: Tests & Integration
- **ID**: adj-021.6
- **Type**: epic
- **Priority**: 3
- **Depends**: Phase 1-4
- **Tasks**: 4

## Tasks

### Phase 1 — Foundational

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Create proposals SQLite migration | backend/src/services/migrations/003-proposals.sql | adj-021.1.1 |
| T002 | Create Zod schemas and TypeScript types | backend/src/types/proposals.ts | adj-021.1.2 |
| T003 | Create ProposalStore class | backend/src/services/proposal-store.ts | adj-021.1.3 |

### Phase 2 — US1+US2: Backend API + MCP Tools

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Create proposals REST routes | backend/src/routes/proposals.ts | adj-021.2.1 |
| T005 | Export proposalsRouter | backend/src/routes/index.ts | adj-021.2.2 |
| T006 | Create MCP proposal tools | backend/src/services/mcp-tools/proposals.ts | adj-021.2.3 |
| T007 | Mount router and register MCP tools | backend/src/index.ts | adj-021.2.4 |

### Phase 3 — US3: Frontend Proposals Tab

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Add proposals API methods | frontend/src/services/api.ts | adj-021.3.1 |
| T009 | Create useProposals hook | frontend/src/hooks/useProposals.ts | adj-021.3.2 |
| T010 | Export useProposals | frontend/src/hooks/index.ts | adj-021.3.3 |
| T011 | Create ProposalCard component | frontend/src/components/proposals/ProposalCard.tsx | adj-021.3.4 |
| T012 | Create ProposalsView component | frontend/src/components/proposals/ProposalsView.tsx | adj-021.3.5 |
| T013 | Create component exports | frontend/src/components/proposals/index.ts | adj-021.3.6 |
| T014 | Add proposals tab to App.tsx | frontend/src/App.tsx | adj-021.3.7 |

### Phase 4 — US4: iOS Proposals Tab

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T015 | Create Proposal Swift model | ios/.../Models/Proposal.swift | adj-021.4.1 |
| T016 | Add proposals to APIClient | ios/.../APIClient+Proposals.swift | adj-021.4.2 |
| T017 | Create ProposalsViewModel | ios/.../Proposals/ProposalsViewModel.swift | adj-021.4.3 |
| T018 | Create ProposalCard SwiftUI view | ios/.../Proposals/ProposalCard.swift | adj-021.4.4 |
| T019 | Create ProposalsView | ios/.../Proposals/ProposalsView.swift | adj-021.4.5 |
| T020 | Register Proposals tab | ios/.../Navigation/Coordinator.swift + MainTabView.swift | adj-021.4.6 |

### Phase 5 — US5: Agent Proposal Behavior

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T021 | Document agent proposal protocol | docs/agent-proposal-protocol.md | adj-021.5.1 |

### Phase 6 — Polish: Tests & Integration

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T022 | ProposalStore unit tests | backend/tests/unit/proposal-store.test.ts | adj-021.6.1 |
| T023 | Proposals routes unit tests | backend/tests/unit/proposals-routes.test.ts | adj-021.6.2 |
| T024 | useProposals hook tests | frontend/tests/unit/useProposals.test.ts | adj-021.6.3 |
| T025 | End-to-end verification | (manual) | adj-021.6.4 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundational | 3 | 1 | adj-021.1 |
| 2: API + MCP | 4 | 1 | adj-021.2 |
| 3: Frontend Tab (MVP) | 7 | 1 | adj-021.3 |
| 4: iOS Tab | 6 | 2 | adj-021.4 |
| 5: Agent Behavior | 1 | 2 | adj-021.5 |
| 6: Polish | 4 | 3 | adj-021.6 |
| **Total** | **25** | | |

## Dependency Graph

```
Phase 1: Foundational (adj-021.1)
    |
Phase 2: API + MCP (adj-021.2) --blocks--> Phase 3, Phase 4
    |
Phase 3: Frontend (adj-021.3)   Phase 4: iOS (adj-021.4)   Phase 5: Agent (adj-021.5)  [parallel]
    |                                |
    +-------+-------+-------+-------+
            |
    Phase 6: Polish (adj-021.6)
```

## Improvements

Improvements (Level 4: adj-021.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
