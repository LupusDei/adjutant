# Implementation Plan: Proposal Comments & Revisions

**Branch**: `040-proposal-comments-revisions` | **Date**: 2026-03-10
**Epic**: `adj-068` | **Priority**: P2

## Summary

Extend the proposal system with two new data types — comments and revisions — stored in new SQLite tables alongside the existing `proposals` table. Add REST endpoints and MCP tools for both. Update the iOS proposal detail view to display comments and revision history. Update the discuss_proposal skill to auto-create comments.

## Bead Map

- `adj-068` - Root: Proposal comments & revisions
  - `adj-068.1` - Database & types (schema + migrations + Zod)
  - `adj-068.2` - Backend API (store, routes, MCP tools)
  - `adj-068.3` - iOS UI (comments + revision history in detail view)
  - `adj-068.4` - Skill integration (discuss_proposal auto-comment)
  - `adj-068.5` - Tests

## Technical Context

**Stack**: TypeScript, Express, SQLite (better-sqlite3), MCP SDK, SwiftUI, Zod
**Storage**: Two new SQLite tables: `proposal_comments`, `proposal_revisions`
**Testing**: Vitest (backend), manual (iOS)
**Constraints**: No frontend web proposal views exist yet — skip frontend React for this epic (iOS only)

## Architecture Decision

**Full snapshot revisions** (not field-level diffs): Each revision stores the complete proposal content (title, description, type). Simpler than diffing, no merge conflicts, easy to display any version. The `proposals` table itself always reflects the latest version — revisions are stored in a separate table for history.

**Flat comments** (not threaded): Comments are a flat list per proposal, ordered by creation time. Threading adds complexity without clear value for the current use case (agent reviews are standalone assessments, not conversations).

**Revision flow**: When `revise_proposal` is called, it: (1) inserts a row into `proposal_revisions` with the CURRENT proposal content (snapshot before change), (2) updates the `proposals` table with the new content, (3) bumps `updated_at`. This means the `proposals` table is always current, and `proposal_revisions` contains the history.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/database.ts` | Add migration for `proposal_comments` and `proposal_revisions` tables |
| `backend/src/types/proposals.ts` | Add `ProposalComment`, `ProposalRevision` types + Zod schemas |
| `backend/src/services/proposal-store.ts` | Add comment and revision CRUD methods |
| `backend/src/routes/proposals.ts` | Add `GET/POST /api/proposals/:id/comments`, `GET/POST /api/proposals/:id/revisions` |
| `backend/src/services/mcp-tools/proposals.ts` | Add `comment_on_proposal`, `revise_proposal`, `list_proposal_comments`, `list_revisions` MCP tools |
| `ios/AdjutantKit/Sources/AdjutantKit/Models/Proposal.swift` | Add `ProposalComment`, `ProposalRevision` models |
| `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Proposals.swift` | Add comment/revision API methods |
| `ios/Adjutant/Features/Proposals/ProposalDetailView.swift` | Add comments section and revision history |
| `ios/Adjutant/Features/Proposals/ProposalDetailViewModel.swift` | Add comment/revision loading |
| `.claude/skills/discuss-proposal/SKILL.md` | Update skill to auto-create comment after review |

## Phase 1: Database & Types

Add SQLite migration with two new tables. Define TypeScript types and Zod schemas for comments and revisions.

**Tables**:
```sql
CREATE TABLE proposal_comments (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_proposal_comments_proposal ON proposal_comments(proposal_id, created_at);

CREATE TABLE proposal_revisions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  revision_number INTEGER NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_proposal_revisions_proposal ON proposal_revisions(proposal_id, revision_number);
```

## Phase 2: Backend API

Extend proposal-store.ts with comment and revision methods. Add REST routes. Add MCP tools.

**Key design**: `revise_proposal` snapshots the current version into `proposal_revisions` BEFORE updating the `proposals` row. The revision_number auto-increments per proposal.

## Phase 3: iOS UI

Add comments section and revision history to ProposalDetailView. Add API client methods for fetching/posting comments and revisions.

## Phase 4: Skill Integration

Update the discuss_proposal skill instructions to call `comment_on_proposal` after completing a review.

## Phase 5: Tests

Backend tests for: comment CRUD, revision CRUD, revision ordering, get_proposal returns latest content, MCP tool integration.

## Parallel Execution

- Phase 1 (DB + types) must complete first — everything depends on it
- Phase 2 (backend API) depends on Phase 1
- Phase 3 (iOS) depends on Phase 2 (needs API endpoints)
- Phase 4 (skill) depends on Phase 2 (needs MCP tools)
- Phase 5 (tests) depends on Phase 2
- Phases 3, 4, 5 can run in parallel after Phase 2

## Verification Steps

- [ ] `POST /api/proposals/:id/comments` creates a comment, `GET` returns it
- [ ] `POST /api/proposals/:id/revisions` updates proposal content and stores history
- [ ] `get_proposal` MCP tool returns latest revision content
- [ ] iOS detail view shows comments and revision history
- [ ] discuss_proposal skill auto-creates comment
- [ ] All tests pass
