# Implementation Plan: Agent Proposals System

**Branch**: `017-agent-proposals` | **Date**: 2026-02-24
**Epic**: `adj-021` | **Priority**: P2

## Summary

Build a proposal system where idle agents generate improvement suggestions for the project. Requires a new SQLite table, REST API, MCP tools, and a "Proposals" tab on both web and iOS. The data model is simple (single table, enum status/type), and the architecture follows existing patterns (message-store for SQLite, mcp-tools/ for agent tools, component directory for frontend).

## Bead Map

- `adj-021` - Root: Agent Proposals System
  - `adj-021.1` - Foundational: Data model, service, migration
  - `adj-021.2` - US1+US2: Backend API + MCP Tools
    - `adj-021.2.1` - Create REST routes for proposals
    - `adj-021.2.2` - Create MCP tools (create_proposal, list_proposals)
    - `adj-021.2.3` - Register MCP tools and routes in app
  - `adj-021.3` - US3: Frontend Proposals Tab
    - `adj-021.3.1` - Create useProposals hook
    - `adj-021.3.2` - Build ProposalsView component
    - `adj-021.3.3` - Add Proposals tab to App.tsx navigation
  - `adj-021.4` - US4: iOS Proposals Tab
    - `adj-021.4.1` - Create Proposal Swift models
    - `adj-021.4.2` - Add proposals API to APIClient
    - `adj-021.4.3` - Build ProposalsView and ProposalCard
    - `adj-021.4.4` - Register Proposals tab in MainTabView
  - `adj-021.5` - US5: Agent Proposal Behavior
    - `adj-021.5.1` - Document agent proposal protocol in CLAUDE.md / agent protocol
  - `adj-021.6` - Polish: Tests & Integration
    - `adj-021.6.1` - Backend unit tests for proposal-store and routes
    - `adj-021.6.2` - Frontend hook tests
    - `adj-021.6.3` - End-to-end verification

## Technical Context

**Stack**: TypeScript 5.x (strict), React 18, Express, Tailwind CSS, Zod, SQLite (better-sqlite3)
**Storage**: SQLite — new `proposals` table in `~/.adjutant/adjutant.db`
**Testing**: Vitest
**Constraints**: Must follow existing patterns (message-store, mcp-tools, response helpers)

## Architecture Decision

Follow the existing message-store pattern: a dedicated `ProposalStore` class wrapping SQLite prepared statements. This keeps the proposal logic self-contained, testable, and consistent with how messages are stored. MCP tools call the store directly (like messaging tools call messageStore). REST routes also call the store. No separate "service" layer needed — the store IS the service for this simple CRUD entity.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/migrations/003-proposals.sql` | New proposals table |
| `backend/src/services/proposal-store.ts` | New ProposalStore class (SQLite CRUD) |
| `backend/src/routes/proposals.ts` | New REST routes for proposals |
| `backend/src/routes/index.ts` | Export proposalsRouter |
| `backend/src/services/mcp-tools/proposals.ts` | New MCP tools (create_proposal, list_proposals) |
| `backend/src/index.ts` | Mount proposals router + register MCP tools |
| `backend/src/types/proposals.ts` | Zod schemas + TypeScript types |
| `frontend/src/components/proposals/ProposalsView.tsx` | Main proposals tab component |
| `frontend/src/components/proposals/ProposalCard.tsx` | Individual proposal card |
| `frontend/src/components/proposals/index.ts` | Exports |
| `frontend/src/hooks/useProposals.ts` | Data fetching + actions hook |
| `frontend/src/hooks/index.ts` | Export useProposals |
| `frontend/src/App.tsx` | Add "proposals" tab |
| `frontend/src/services/api.ts` | Add proposals API methods |
| `ios/Adjutant/Features/Proposals/ProposalsView.swift` | iOS proposals view |
| `ios/Adjutant/Features/Proposals/ProposalCard.swift` | iOS proposal card |
| `ios/Adjutant/Features/Proposals/ProposalsViewModel.swift` | iOS view model |
| `ios/Adjutant/Core/Networking/Models/Proposal.swift` | Swift Proposal model |
| `ios/Adjutant/Core/Networking/APIClient+Proposals.swift` | API extension |
| `ios/Adjutant/Core/Navigation/Coordinator.swift` | Add proposals tab |
| `ios/Adjutant/Core/Navigation/MainTabView.swift` | Render proposals tab |

## Phase 1: Foundational — Data Model & Store

Create the SQLite migration and ProposalStore class. This is the foundation everything else depends on.

- Migration `003-proposals.sql`: CREATE TABLE proposals with UUID id, author TEXT, title TEXT, description TEXT, type TEXT CHECK(product/engineering), status TEXT CHECK(pending/accepted/dismissed), created_at, updated_at. Index on (status, created_at).
- `ProposalStore` class: insertProposal(), getProposals(filters), getProposal(id), updateProposalStatus(id, status). Follow message-store patterns.
- Zod schemas: CreateProposalSchema, UpdateProposalSchema, ProposalFilterSchema.

## Phase 2: Backend API + MCP Tools

REST routes and MCP tools both consume the ProposalStore. Can be built in parallel.

- REST routes: GET /api/proposals (query params: status, type), POST /api/proposals, GET /api/proposals/:id, PATCH /api/proposals/:id (body: { status })
- MCP tools: `create_proposal` (title, description, type) — uses server-side agent identity, `list_proposals` (optional type filter) — returns all proposals for uniqueness review
- Wire into index.ts: mount router, register tools

## Phase 3: Frontend Proposals Tab (MVP)

New Proposals tab with Pip-Boy styling following existing component patterns.

- `useProposals` hook: fetch proposals, accept/dismiss actions, filter state
- `ProposalCard`: title, author, type badge (green for product, amber for engineering), description preview, date, action buttons
- `ProposalsView`: list of cards, filter bar (All/Product/Engineering), "Show Dismissed" toggle, empty states
- Add to App.tsx TabId union and TABS array

## Phase 4: iOS Proposals Tab

Swift implementation mirroring the web UI.

- Proposal model (Codable struct matching API response)
- APIClient extension for proposals endpoints
- ProposalsViewModel with @Published properties
- ProposalsView with List, swipe actions, filter picker
- Register in AppTab enum and MainTabView

## Phase 5: Agent Proposal Behavior

Document and codify the protocol for agents entering proposal mode.

- Update agent protocol docs with proposal mode behavior
- Define spawn prompts for Product/UX and Staff Engineer teammates
- Include uniqueness-check-first requirement in protocol

## Phase 6: Polish — Tests & Integration

- Backend tests: ProposalStore CRUD, route validation, MCP tool behavior
- Frontend tests: useProposals hook state management
- Integration: verify end-to-end flow from agent MCP → DB → REST → UI

## Parallel Execution

- Phase 2 tasks (REST routes vs MCP tools) can run in parallel
- Phase 3 (Frontend) and Phase 4 (iOS) can run in parallel after Phase 2
- Phase 5 (Agent behavior) can run in parallel with Phases 3-4
- Phase 6 (Tests) depends on Phases 1-4

## Verification Steps

- [ ] POST /api/proposals creates a proposal and returns it with UUID and pending status
- [ ] GET /api/proposals?status=pending returns only pending proposals
- [ ] PATCH /api/proposals/:id with accepted/dismissed updates correctly
- [ ] MCP create_proposal resolves agent identity server-side
- [ ] MCP list_proposals returns proposals for uniqueness checking
- [ ] Frontend Proposals tab shows pending proposals by default
- [ ] Accept/Dismiss buttons work and update UI immediately
- [ ] Dismissed toggle reveals/hides dismissed proposals
- [ ] iOS Proposals tab mirrors web functionality
- [ ] `npm run build` passes with no errors
- [ ] `npm test` passes with all tests green
