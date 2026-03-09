# Implementation Plan: Idle Agent Proposal Generation

**Branch**: `035-idle-agent-proposals` | **Date**: 2026-03-09
**Epic**: `adj-2hwz` | **Priority**: P2

## Summary

Add a new Adjutant coordinator behavior (`idle-proposal-nudge`) that detects agents idle for 10+ minutes and messages them to generate improvement proposals. The nudge includes existing proposal context for deduplication and enforces a 12-proposal pending cap. This behavior integrates into the existing behavior registry and uses existing infrastructure (CommunicationManager, ProposalStore, AdjutantState).

## Bead Map

- `adj-2hwz` - Root: Idle Agent Proposal Generation
  - `adj-1kyh` - Phase 1: Core Behavior
    - `adj-9cb8` - T001: Tests for idle detection + nudge trigger
    - `adj-wkxm` - T002: Implement createIdleProposalNudge behavior
    - `adj-yf8j` - T003: Tests for proposal context in nudge message
    - `adj-in4g` - T004: Implement buildNudgeMessage with proposal context
    - `adj-9fz0` - T005: Tests for 12-proposal pending cap
    - `adj-evu0` - T006: Implement pending cap improve-only mode
  - `adj-ec47` - Phase 2: Registration & Integration
    - `adj-873k` - T007: Register behavior in index.ts
    - `adj-ju2o` - T008: Edge case tests - disconnect, debounce reset

## Technical Context

**Stack**: TypeScript, Node.js, Express
**Storage**: SQLite (proposals table, adjutant_meta table for debounce)
**Testing**: Vitest with mocked dependencies
**Constraints**: Behavior must be fast (sync `shouldAct`, async `act`); no external API calls

## Architecture Decision

Implement as a single new behavior file following the established pattern (agent-lifecycle, self-improver). The behavior:

1. **Triggers on `agent:status_changed`** — reacts when an agent reports idle
2. **Also runs on schedule** (`*/2 * * * *`, every 2 minutes) — catches agents that went idle before the behavior was registered
3. **Uses ProposalStore** to count pending proposals and build context
4. **Uses CommunicationManager.messageAgent()** to deliver the nudge
5. **Uses AdjutantState metadata** for per-agent debounce (same pattern as self-improver)

**Why not a new stimulus engine trigger?** The behavior registry is simpler and already handles the event→shouldAct→act pipeline. The stimulus engine is for waking the adjutant agent itself, not for nudging other agents.

**Why messageAgent() instead of nudge_agent MCP tool?** messageAgent() inserts a persistent message into SQLite that the agent receives via MCP `read_messages`. nudge_agent() injects into tmux, which is more intrusive and appropriate for urgent coordinator actions, not routine nudges.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts` | **NEW** — Core behavior implementation |
| `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts` | **NEW** — Unit tests |
| `backend/src/index.ts` | Register new behavior in behavior registry (1 line) |
| `backend/src/services/adjutant/behaviors/index.ts` | Re-export (if barrel file exists) |

## Phase 1: Core Behavior (MVP)

Create the `idle-proposal-nudge` behavior with:
- Idle detection via AgentProfile scan
- Debounce per-agent via AdjutantState metadata
- Pending proposal count check (12 cap)
- Message construction with existing proposal context
- Registration in index.ts

This is the complete feature — no phases needed beyond implementation + tests.

## Phase 2: Tests & Polish

- Unit tests covering all shouldAct/act paths
- Edge cases: disconnected agent, debounce, cap boundary (11 vs 12)
- Integration with existing test patterns

## Parallel Execution

Phase 1 and Phase 2 can be developed TDD-style (test first, then implement), but are logically sequential. A single agent should handle both.

## Verification Steps

- [ ] `npm run build` passes with new behavior file
- [ ] `npm test` passes — all new tests green
- [ ] Manual: set an agent to idle, wait 2+ minutes, verify nudge message appears in messages table
- [ ] Manual: create 12 pending proposals, trigger nudge, verify "improve only" instruction
