# Implementation Plan: Persistent Cron Scheduler

**Branch**: `046-persistent-cron-scheduler` | **Date**: 2026-03-25
**Epic**: `adj-121` | **Priority**: P2

## Summary

Add a persistent recurring schedule system to the Adjutant StimulusEngine. A new
`cron_schedules` SQLite table stores recurring jobs that survive restarts. The
StimulusEngine gains a 4th wake source that loads schedules from DB, computes next
fire times, and registers timers. New MCP tools and REST endpoints provide CRUD.

## Bead Map

- `adj-121` - Root: Persistent Cron Scheduler
  - `adj-121.1` - Phase 1: Migration & Schedule Store
    - `adj-121.1.1` - SQLite migration for cron_schedules table
    - `adj-121.1.2` - CronScheduleStore service (CRUD + next-fire computation)
  - `adj-121.2` - Phase 2: StimulusEngine Integration
    - `adj-121.2.1` - Add recurring wake source to StimulusEngine
    - `adj-121.2.2` - Include recurring schedules in getPendingSchedule + situation prompt
  - `adj-121.3` - Phase 3: MCP Tools
    - `adj-121.3.1` - create_schedule + list_schedules MCP tools
    - `adj-121.3.2` - cancel_schedule + pause_schedule + resume_schedule MCP tools
  - `adj-121.4` - Phase 4: REST API & Polish
    - `adj-121.4.1` - GET /api/schedules + DELETE /api/schedules/:id routes
    - `adj-121.4.2` - Startup reload + overdue fire logic

## Technical Context

**Stack**: TypeScript, better-sqlite3, Express, MCP SDK, Zod
**Storage**: SQLite `adjutant.db` (existing), new `cron_schedules` table
**Testing**: Vitest (TDD mandatory)
**Constraints**: UTC only for v1, reuse `cronToIntervalMs()` for interval computation

## Architecture Decision

**Separate CronScheduleStore service** rather than embedding persistence in StimulusEngine.

Rationale:
- StimulusEngine is a pure in-memory reactive engine — adding DB concerns would violate SRP
- A dedicated `CronScheduleStore` handles all SQLite operations and exposes a clean API
- StimulusEngine calls into the store for load/update, but the DB layer is isolated
- This mirrors the pattern used by MessageStore, ProposalStore, EventStore

**Cron → next fire time**: Use `cronToIntervalMs()` to get the interval, then compute
`nextFireAt = lastFiredAt + intervalMs` (or `now + intervalMs` for new schedules).
This avoids adding a cron-parser dependency. Limitation: no "at 9am on Tuesdays" —
only repeating intervals. Acceptable for v1.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/migrations/024-cron-schedules.sql` | New migration: cron_schedules table |
| `backend/src/services/adjutant/cron-schedule-store.ts` | New service: CRUD + next-fire computation |
| `backend/src/services/adjutant/stimulus-engine.ts` | Add recurring wake source, extend PendingSchedule |
| `backend/src/services/mcp-tools/coordination.ts` | Add 5 new MCP tools |
| `backend/src/routes/schedules.ts` | New route file: GET + DELETE |
| `backend/src/routes/index.ts` | Register schedules router |
| `backend/src/services/adjutant/stimulus-engine.ts` | Extend buildSituationPrompt for recurring |
| `backend/tests/unit/adjutant/cron-schedule-store.test.ts` | New test file |
| `backend/tests/unit/adjutant/stimulus-engine-recurring.test.ts` | New test file |
| `backend/tests/unit/mcp-tools/coordination-schedules.test.ts` | New test file |

## Phase 1: Migration & Schedule Store

Create the `cron_schedules` table and a `CronScheduleStore` service that wraps all
SQLite operations. The store provides: `create`, `getById`, `listAll`, `listEnabled`,
`update`, `delete`, `incrementFireCount`, `disable`.

Next-fire computation: `nextFireAt = now + cronToIntervalMs(cronExpr)`.
After each fire: `nextFireAt = lastFiredAt + cronToIntervalMs(cronExpr)`.

## Phase 2: StimulusEngine Integration

Extend `StimulusEngine` with:
- `loadRecurringSchedules(store: CronScheduleStore)` — called on startup
- Internal `recurringTimers` map for active recurring schedule timers
- New WakeReason type: `"recurring"`
- `getPendingSchedule()` extended to include `recurringSchedules` array
- `buildSituationPrompt()` shows recurring schedules in a new section

On fire: increment `fire_count`, update `last_fired_at` and `next_fire_at` in DB,
re-register timer for next occurrence. If `max_fires` reached, disable instead.

## Phase 3: MCP Tools

Add 5 tools to `coordination.ts` (same access control as existing tools):
- `create_schedule` — validate cron, create in store, register timer
- `list_schedules` — return all schedules from store
- `cancel_schedule` — delete from store, clear timer
- `pause_schedule` — set enabled=0, clear timer
- `resume_schedule` — set enabled=1, compute next fire, register timer

## Phase 4: REST API & Polish

- `GET /api/schedules` — list all schedules (public, no auth needed — same as other routes)
- `DELETE /api/schedules/:id` — remove schedule, clear timer
- Startup reload: `initAdjutantCore` calls `stimulusEngine.loadRecurringSchedules(store)` after migrations

## Parallel Execution

- Phase 1 is sequential (store needed by everything)
- Phase 2 depends on Phase 1
- Phase 3 and Phase 4 can run in parallel after Phase 2

## Verification Steps

- [ ] Create schedule via MCP → verify row in SQLite
- [ ] Restart backend → verify schedule reloads and fires
- [ ] Create schedule with maxFires=2 → verify auto-disable after 2 fires
- [ ] Pause/resume via MCP → verify timer cleared/re-registered
- [ ] GET /api/schedules returns all schedules
- [ ] DELETE /api/schedules/:id removes schedule
- [ ] Situation prompt shows recurring schedules section
- [ ] All new code has TDD tests
