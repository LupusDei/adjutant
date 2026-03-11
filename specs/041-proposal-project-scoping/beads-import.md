# Proposal Project Scoping - Beads

**Feature**: 041-proposal-project-scoping
**Generated**: 2026-03-11
**Source**: specs/041-proposal-project-scoping/tasks.md

## Root Epic

- **ID**: adj-072
- **Title**: Proposal project scoping
- **Type**: epic
- **Priority**: 1
- **Description**: Enforce project scoping for proposals across all layers. MCP tools auto-scope to agent's project. Frontend and iOS filter by active project. Execute_proposal skill validates project match.

## Epics

### Phase 1 — Backend MCP Enforcement
- **ID**: adj-072.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 2 — Frontend Filtering
- **ID**: adj-072.2
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 3 — iOS Filtering
- **ID**: adj-072.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 4 — Skill Update
- **ID**: adj-072.4
- **Type**: epic
- **Priority**: 2
- **Tasks**: 1

### Phase 5 — Tests
- **ID**: adj-072.5
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

## Tasks

### Phase 1 — Backend MCP Enforcement

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Auto-scope create_proposal and list_proposals to agent project | backend/src/services/mcp-tools/proposals.ts | adj-072.1.1 |
| T002 | Validate proposal project in discuss/comment MCP tools | backend/src/services/mcp-tools/proposals.ts | adj-072.1.2 |

### Phase 2 — Frontend Filtering

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T003 | Add project param to useProposals hook and API call | frontend/src/hooks/useProposals.ts | adj-072.2.1 |
| T004 | Wire selectedProject from ProjectContext into ProposalsView | frontend/src/components/proposals/ProposalsView.tsx | adj-072.2.2 |

### Phase 3 — iOS Filtering

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T005 | Add project param to fetchProposals API client | ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Proposals.swift | adj-072.3.1 |
| T006 | Pass active project to ProposalsViewModel | ios/Adjutant/Features/Proposals/ProposalsViewModel.swift | adj-072.3.2 |

### Phase 4 — Skill Update

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Add cross-project check to execute_proposal skill | .claude/skills/execute-proposal/SKILL.md | adj-072.4.1 |

### Phase 5 — Tests

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Tests for MCP auto-scoping and project defaulting | backend/tests/unit/proposal-project-scoping.test.ts | adj-072.5.1 |
| T009 | Tests for cross-project validation | backend/tests/unit/proposal-project-scoping.test.ts | adj-072.5.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Backend MCP | 2 | 1 | adj-072.1 |
| 2: Frontend | 2 | 1 | adj-072.2 |
| 3: iOS | 2 | 1 | adj-072.3 |
| 4: Skill | 1 | 2 | adj-072.4 |
| 5: Tests | 2 | 1 | adj-072.5 |
| **Total** | **9** | | |

## Dependency Graph

Phase 1: Backend MCP (adj-072.1)
    |
    +----------+----------+----------+
    |          |          |          |
Phase 2    Phase 3    Phase 4    Phase 5
(adj-072.2)(adj-072.3)(adj-072.4)(adj-072.5)
  [parallel]  [parallel]  [parallel]  [parallel]
