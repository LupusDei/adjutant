# Implementation Plan: Proposal Project Scoping

**Branch**: `041-proposal-project-scoping` | **Date**: 2026-03-11
**Epic**: `adj-072` | **Priority**: P1

## Summary

Enforce project scoping for proposals across all layers. The backend already has the `project` field, SQL filtering, and MCP project context — this epic wires them together. Frontend and iOS filter by active project. MCP tools auto-scope to agent's project. The execute_proposal skill validates project match.

## Bead Map

- `adj-072` - Root: Proposal project scoping
  - `adj-072.1` - Backend: MCP tool auto-scoping
  - `adj-072.2` - Frontend: project-filtered proposal list
  - `adj-072.3` - iOS: project-filtered proposal list
  - `adj-072.4` - Skill: execute_proposal cross-project check
  - `adj-072.5` - Tests

## Technical Context

**Stack**: TypeScript, Express, SQLite, MCP SDK, React, SwiftUI, Zod
**Existing infrastructure** (already built):
- `proposals` table has `project TEXT NOT NULL` column with index
- `ProposalFilterSchema` supports optional `project` filter
- `proposal-store.getProposals()` builds dynamic `WHERE project = ?`
- `mcp-server.ts` has `getProjectContextBySession(sessionId)` returning agent's project
- `ProjectContext.tsx` tracks `selectedProject` in frontend
- iOS has project selection in `SwarmProjectDetailView`

**What's missing**: Wiring these together.

## Architecture Decision

**Server-side enforcement for MCP**: The `project` field on `create_proposal` becomes server-resolved (like `author`), not client-supplied. This prevents agents from creating proposals for wrong projects. The client-supplied `project` param is ignored in favor of the agent's `projectContext`.

**Client-side filtering**: Frontend and iOS pass `project` query param when fetching proposals. The backend already supports this — just need to wire the active project into the API call.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/mcp-tools/proposals.ts` | Auto-set project from agent context in create_proposal; default project filter in list_proposals |
| `frontend/src/hooks/useProposals.ts` | Accept project param, pass to API |
| `frontend/src/components/proposals/ProposalsView.tsx` | Read selectedProject from ProjectContext, pass to useProposals |
| `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Proposals.swift` | Add project param to fetchProposals |
| `ios/Adjutant/Features/Proposals/ProposalsViewModel.swift` | Pass active project to API calls |
| `.claude/skills/execute-proposal/SKILL.md` | Add project match validation before execution |
| `backend/tests/unit/proposal-mcp-tools.test.ts` | Add tests for auto-scoping |

## Phase 1: Backend MCP Enforcement

Auto-set project from agent's session context in `create_proposal`. Default `list_proposals` to agent's project when no filter specified. Uses existing `getProjectContextBySession()`.

## Phase 2: Frontend Filtering

Wire `selectedProject` from `ProjectContext` into `useProposals` hook and API calls. When project changes, proposal list refetches with new project filter.

## Phase 3: iOS Filtering

Wire active project into `ProposalsViewModel.fetchProposals()` API call. Similar to frontend change.

## Phase 4: Skill Update

Update `execute_proposal` skill to check if the proposal's project matches the agent's current project. If mismatch, decline via `send_message` without changing proposal status.

## Phase 5: Tests

Backend tests for MCP auto-scoping and project filtering behavior.

## Parallel Execution

- Phase 1 (backend MCP) must complete first — everything depends on it
- Phases 2, 3, 4, 5 can run in parallel after Phase 1
