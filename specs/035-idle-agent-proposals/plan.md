# Implementation Plan: Idle Agent Proposal Generation

**Branch**: `035-idle-agent-proposals` | **Date**: 2026-03-09
**Epic**: `adj-057` | **Priority**: P2

## Summary

Add a new Adjutant coordinator behavior (`idle-proposal-nudge`) that reacts to `agent:status_changed` events. When an agent goes idle, it schedules a 5-minute delayed check via the existing `stimulusEngine.scheduleCheck()`. When the check fires, if the agent is still idle, it sends a proposal-generation nudge with existing proposal context and enforces a 12-proposal pending cap. No new cron jobs — purely event-driven.

## Bead Map

- `adj-057` - Root: Idle Agent Proposal Generation
  - `adj-057.1` - Phase 1: Core Behavior
    - `adj-057.1.1` - T001: Tests for idle detection + nudge trigger via scheduleCheck
    - `adj-057.1.2` - T002: Implement createIdleProposalNudge behavior
    - `adj-057.1.3` - T003: Tests for proposal context in nudge message
    - `adj-057.1.4` - T004: Implement buildNudgeMessage with proposal context
    - `adj-057.1.5` - T005: Tests for 12-proposal pending cap
    - `adj-057.1.6` - T006: Implement pending cap improve-only mode
  - `adj-057.2` - Phase 2: Registration & Integration
    - `adj-057.2.1` - T007: Register behavior in index.ts
    - `adj-057.2.2` - T008: Edge case tests - disconnect, debounce reset, cancel on non-idle

## Technical Context

**Stack**: TypeScript, Node.js, Express
**Storage**: SQLite (proposals table, adjutant_meta table for debounce)
**Testing**: Vitest with mocked dependencies
**Constraints**: No new cron jobs; behavior must be event-driven via stimulus engine

## Architecture Decision

Implement as a new behavior file triggered by `agent:status_changed`. The key design choice is using `stimulusEngine.scheduleCheck()` instead of a cron schedule:

1. **Triggers on `agent:status_changed`** — reacts when an agent reports idle
2. **Calls `stimulusEngine.scheduleCheck(300000, reason)`** — 5-minute delayed check
3. **Callback re-checks agent status** — if still idle + not debounced + connected, sends nudge
4. **Uses ProposalStore** to count pending proposals and build context
5. **Uses CommunicationManager.messageAgent()** to deliver the nudge
6. **Uses AdjutantState metadata** for per-agent debounce (same pattern as self-improver)

**Why scheduleCheck instead of cron?** The coordinator already has a stimulus engine with `scheduleCheck()` for delayed evaluations. Using it avoids adding cron overhead and is more precise — the 5-minute window starts exactly when the agent goes idle, not on a fixed interval. The check ID can also be stored for potential cancellation if the agent leaves idle before the timer fires.

**Why messageAgent() instead of nudge_agent?** messageAgent() inserts a persistent message into SQLite that the agent receives via MCP `read_messages`. nudge_agent() injects into tmux, which is more intrusive and appropriate for urgent coordinator actions, not routine nudges.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts` | **NEW** — Core behavior implementation |
| `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts` | **NEW** — Unit tests |
| `backend/src/index.ts` | Register new behavior in behavior registry (~3 lines) |

## Phase 1: Core Behavior (adj-057.1)

Create the `idle-proposal-nudge` behavior with:
- Event handler for `agent:status_changed` that schedules 5-minute check when status = "idle"
- Callback that re-checks status, skips if no longer idle or disconnected
- Debounce per-agent via AdjutantState metadata
- Pending proposal count check (12 cap)
- Message construction with existing proposal context
- Decision logging

## Phase 2: Registration & Integration (adj-057.2)

- Register `createIdleProposalNudge()` in behavior registry in index.ts
- Pass `stimulusEngine` and `proposalStore` as dependencies
- Edge case tests: disconnected agent skip, debounce reset after non-idle transition, status change before timer fires

## Verification Steps

- [ ] `npm run build` passes with new behavior file
- [ ] `npm test` passes — all new tests green
- [ ] No new `schedule:` entries in any behavior registration
- [ ] Behavior triggers only on `agent:status_changed`, not on cron
