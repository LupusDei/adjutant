# Implementation Plan: Idle Agent Proposal Generation

**Branch**: `035-idle-agent-proposals` | **Date**: 2026-03-09
**Epic**: `adj-057` | **Priority**: P2

## Summary

Add a new Adjutant coordinator behavior (`idle-proposal-nudge`) that reacts to `agent:status_changed` events. When an agent goes idle, it builds proposal context (existing pending/dismissed proposals, cap status) and schedules a 5-minute delayed coordinator wake via `stimulusEngine.scheduleCheck()`. The coordinator agent then decides how to nudge the idle agent. The behavior never messages agents directly — it only schedules reminders for the coordinator.

## Bead Map

- `adj-057` - Root: Idle Agent Proposal Generation
  - `adj-057.1` - Phase 1: Core Behavior
    - `adj-057.1.1` - T001: Tests for idle detection + scheduleCheck trigger
    - `adj-057.1.2` - T002: Implement createIdleProposalNudge behavior
    - `adj-057.1.3` - T003: Tests for proposal context in scheduleCheck reason
    - `adj-057.1.4` - T004: Implement buildScheduleReason with proposal context
    - `adj-057.1.5` - T005: Tests for 12-proposal pending cap in reason string
    - `adj-057.1.6` - T006: Implement pending cap in reason string
  - `adj-057.2` - Phase 2: Registration & Integration
    - `adj-057.2.1` - T007: Register behavior in index.ts
    - `adj-057.2.2` - T008: Edge case tests

## Technical Context

**Stack**: TypeScript, Node.js, Express
**Storage**: SQLite (proposals table, adjutant_meta table for debounce)
**Testing**: Vitest with mocked dependencies
**Constraints**: No new cron jobs; behavior never messages agents directly; coordinator-mediated only

## Architecture Decision

**Coordinator-mediated flow** — the behavior schedules a wake, not a direct message:

1. **Triggers on `agent:status_changed`** — reacts when an agent reports idle
2. **Builds context** — queries ProposalStore for pending/dismissed proposals, checks cap
3. **Calls `stimulusEngine.scheduleCheck(300000, reason)`** — 5-minute delayed coordinator wake
4. **Reason string** contains everything the coordinator needs: idle agent ID, proposal summaries, cap status, instructions
5. **Coordinator wakes** — reads situation prompt, decides to message the idle agent via `send_message` or `nudge_agent`

**Why coordinator-mediated?** Consistent with how all other agent interactions work. The stimulus engine wakes the coordinator; the coordinator is the decision-maker. Direct `comm.messageAgent()` would bypass the coordinator's judgment.

**Why build context in the behavior?** The behavior runs in-process and has synchronous access to ProposalStore and AdjutantState. Building context here means the coordinator's situation prompt arrives fully loaded — no additional queries needed.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts` | **NEW** — Core behavior: idle detection, debounce, context building, scheduleCheck |
| `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts` | **NEW** — Unit tests for all paths |
| `backend/src/index.ts` | Register new behavior, pass stimulusEngine + proposalStore (~3 lines) |

## Phase 1: Core Behavior (adj-057.1)

Create the `idle-proposal-nudge` behavior with:
- Event handler for `agent:status_changed` — only acts when status = "idle"
- Guard: skip disconnected agents, skip if already debounced
- `buildScheduleReason()` — queries ProposalStore, formats pending/dismissed summaries, checks 12-proposal cap
- Calls `stimulusEngine.scheduleCheck(300000, reason)` with the built context
- Debounce per-agent via AdjutantState metadata (stores scheduleCheck ID)
- Decision logging

**Key function signature:**
```typescript
export function createIdleProposalNudge(
  stimulusEngine: StimulusEngine,
  proposalStore: ProposalStore,
): AdjutantBehavior
```

## Phase 2: Registration & Integration (adj-057.2)

- Register in index.ts alongside existing behaviors
- Pass `stimulusEngine` and `proposalStore` as dependencies
- Edge case tests: disconnected skip, debounce reset on non-idle transition, agent leaves idle before timer

## Verification Steps

- [ ] `npm run build` passes with new behavior file
- [ ] `npm test` passes — all new tests green
- [ ] No new `schedule:` entries in any behavior registration
- [ ] Behavior triggers only on `agent:status_changed`, not on cron
- [ ] Behavior never calls `comm.messageAgent()` or `comm.sendImportant()` — only `stimulusEngine.scheduleCheck()`
