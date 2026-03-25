# Feature Specification: Persistent Cron Scheduler

**Feature Branch**: `046-persistent-cron-scheduler`
**Created**: 2026-03-25
**Status**: Draft
**Proposal**: `56ce4ef7-b78f-4d68-8fde-121f123d2989`

## User Scenarios & Testing

### User Story 1 - Coordinator Creates Recurring Schedule (Priority: P1)

The coordinator creates a recurring schedule via MCP tool so that periodic tasks
(health checks, proposal reviews, capacity sweeps) survive backend restarts and
fire automatically without manual re-scheduling.

**Why this priority**: Core value — without persistence and recurrence, the coordinator
must manually re-schedule after every wake, which is the primary gap.

**Independent Test**: Create a schedule via `create_schedule`, restart the backend,
verify the schedule fires at the next computed time.

**Acceptance Scenarios**:

1. **Given** no schedules exist, **When** coordinator calls `create_schedule({ cron: "*/15 * * * *", reason: "Health check" })`, **Then** a schedule is persisted to SQLite and the next fire time is computed and a timer is registered.
2. **Given** a schedule exists with `next_fire_at` in the past (server was down), **When** backend starts up, **Then** the schedule fires immediately and `next_fire_at` is advanced to the next occurrence.
3. **Given** a schedule has `max_fires: 5` and `fire_count: 5`, **When** the next fire time arrives, **Then** the schedule is auto-disabled and does not fire.

---

### User Story 2 - User Manages Schedules via Dashboard (Priority: P2)

The user views, pauses, resumes, and cancels recurring schedules from the dashboard
and REST API so they have visibility and control over what the coordinator does
autonomously.

**Why this priority**: Visibility and control are essential but secondary to the
core scheduling mechanism.

**Independent Test**: Create schedules via MCP, then list/pause/cancel via REST API,
verify state changes are reflected in both MCP and REST responses.

**Acceptance Scenarios**:

1. **Given** 3 active schedules exist, **When** user calls `GET /api/schedules`, **Then** all 3 are returned with id, cron_expr, reason, enabled, next_fire_at, fire_count.
2. **Given** an active schedule, **When** user calls `DELETE /api/schedules/:id`, **Then** the schedule is removed from DB and its timer is cleared.
3. **Given** an active schedule, **When** coordinator calls `pause_schedule({ id })`, **Then** `enabled` is set to 0, timer is cleared, and `list_schedules` shows it as paused.

---

### User Story 3 - Situation Prompt Shows Recurring Schedules (Priority: P2)

The coordinator's situation prompt includes active recurring schedules alongside
one-shot checks and watches, so it has full awareness of its pending schedule.

**Why this priority**: Builds on US1 — the coordinator needs to see recurring
schedules to make informed decisions about scheduling more.

**Independent Test**: Create recurring schedules, trigger a wake, verify the
situation prompt includes a "Recurring Schedules" section.

**Acceptance Scenarios**:

1. **Given** 2 recurring schedules and 1 one-shot check, **When** situation prompt is built, **Then** the prompt includes both recurring schedules with their cron expressions and next fire times.

---

### Edge Cases

- What happens when two schedules fire within the 90s cooldown? → Queued like any other wake; latest wins.
- What happens when cron expression is invalid? → `create_schedule` returns error, nothing persisted.
- What happens when backend restarts with 10 overdue schedules? → All fire immediately (one per cooldown cycle), then resume normal cadence.
- What happens when `max_fires` is reached? → Schedule auto-disables; coordinator can re-enable with `resume_schedule`.

## Requirements

### Functional Requirements

- **FR-001**: System MUST persist recurring schedules in SQLite (`cron_schedules` table)
- **FR-002**: System MUST compute next fire time from cron expression and register setTimeout timers
- **FR-003**: System MUST reload all enabled schedules on startup and fire overdue ones
- **FR-004**: System MUST respect the existing 90s cooldown for all wake sources including recurring
- **FR-005**: System MUST provide MCP tools: `create_schedule`, `list_schedules`, `cancel_schedule`, `pause_schedule`, `resume_schedule`
- **FR-006**: System MUST provide REST endpoints: `GET /api/schedules`, `DELETE /api/schedules/:id`
- **FR-007**: System MUST add `"recurring"` as a new WakeReason type
- **FR-008**: System MUST include recurring schedules in `getPendingSchedule()` and the situation prompt
- **FR-009**: System MUST auto-disable schedules that reach `max_fires`
- **FR-010**: System MUST validate cron expressions before persisting (reuse `cronToIntervalMs` logic)

### Key Entities

- **CronSchedule**: `{ id, cronExpr, reason, createdBy, createdAt, lastFiredAt, nextFireAt, enabled, maxFires, fireCount }`

## Success Criteria

- **SC-001**: Recurring schedules survive backend restarts (verified by test)
- **SC-002**: Overdue schedules fire on startup
- **SC-003**: All 5 MCP tools work with coordinator access control
- **SC-004**: REST API lists and cancels schedules
- **SC-005**: Situation prompt includes recurring schedule section
