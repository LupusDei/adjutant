# Feature Specification: Agent-Scoped Scheduling

**Feature Branch**: `053-agent-scoped-scheduling`
**Created**: 2026-04-17
**Status**: Draft

## Background

Adjutant's scheduling system is coordinator-centric. All scheduled wakes (cron, one-shot, event watches) are hardcoded to deliver prompts to `ADJUTANT_TMUX_SESSION`. This means only the coordinator agent can receive scheduled pings. As Adjutant evolves toward a multi-project hub with plugin coordinators (Incubator, etc.), any agent needs to be able to schedule reminders for itself, and the backend must clean up when an agent dies.

## User Scenarios & Testing

### User Story 1 - Self-Scheduling (Priority: P1)

Any MCP-connected agent can create a persistent cron schedule that delivers prompts to its own tmux session, without needing the coordinator as an intermediary.

**Why this priority**: This is the core capability. Without it, every scheduling need must be routed through the coordinator — a bottleneck that doesn't scale to multi-project deployments.

**Independent Test**: An agent (not the coordinator) calls `create_schedule`. The schedule fires and delivers a prompt to THAT agent's tmux pane, not the coordinator's.

**Acceptance Scenarios**:

1. **Given** agent "incubator-coordinator" is connected via MCP, **When** it calls `create_schedule({ cron: "0 */6 * * *", reason: "Run discovery sweep" })`, **Then** every 6 hours a prompt is injected into `adj-swarm-incubator-coordinator` tmux session with the reason text
2. **Given** a schedule exists targeting agent "nova", **When** "nova" calls `list_schedules`, **Then** it sees its own schedules, **And** does NOT see schedules owned by other agents
3. **Given** the coordinator calls `create_schedule({ cron: "*/15 * * * *", reason: "Check proposals", targetAgent: "nova" })`, **Then** the schedule targets nova's tmux session (coordinator can target others)

---

### User Story 2 - Session Death Cleanup (Priority: P1)

When an agent's tmux session is destroyed (agent dies, is decommissioned, or session crashes), all schedules and watches targeting that agent are automatically disabled.

**Why this priority**: Without cleanup, orphaned schedules keep firing into dead sessions — wasting resources and creating log noise. This is a correctness requirement.

**Independent Test**: Create a schedule for agent "test-agent". Kill the tmux session. Verify the schedule is disabled in SQLite.

**Acceptance Scenarios**:

1. **Given** agent "worker-1" has 3 active schedules, **When** its tmux session is destroyed, **Then** all 3 schedules are disabled (enabled=0) in the database
2. **Given** agent "worker-1" has an active `watch_for` registration, **When** its tmux session is destroyed, **Then** the watch is cancelled in the StimulusEngine
3. **Given** agent "coordinator" has schedules AND "worker-1" has schedules, **When** "worker-1" dies, **Then** ONLY "worker-1" schedules are disabled — coordinator schedules are unaffected

---

### User Story 3 - Open Access with Ownership (Priority: P2)

Scheduling MCP tools are accessible to all connected agents, not just the coordinator. Each agent can only manage (list/pause/cancel) its own schedules. The coordinator has admin access to manage anyone's schedules.

**Why this priority**: Enables the multi-project model. Plugin coordinators can manage their own scheduling without Adjutant coordinator involvement.

**Independent Test**: Agent "nova" creates a schedule, then cancels it. Agent "raynor" tries to cancel nova's schedule — gets an access error. The coordinator cancels it — succeeds.

**Acceptance Scenarios**:

1. **Given** any MCP-connected agent, **When** it calls `create_schedule`, **Then** the schedule is created targeting itself by default
2. **Given** agent "nova" owns schedule "sched-123", **When** "raynor" calls `cancel_schedule("sched-123")`, **Then** it returns an access error
3. **Given** the coordinator, **When** it calls `cancel_schedule("sched-123")` for a schedule owned by "nova", **Then** it succeeds (admin override)
4. **Given** agent "nova" calls `list_schedules`, **Then** it sees only its own schedules, **Unless** it's the coordinator (sees all)

---

### User Story 4 - Targeted Wake Routing (Priority: P1)

The StimulusEngine routes wakes to the correct agent based on the schedule/watch's target, not a hardcoded coordinator session.

**Why this priority**: This is the plumbing that makes US1 work. Without it, the engine can store agent-targeted schedules but can't deliver them.

**Independent Test**: Two schedules exist — one targeting the coordinator, one targeting "nova". Both fire. Verify the coordinator gets its rich situation prompt and nova gets a simple reminder prompt.

**Acceptance Scenarios**:

1. **Given** a coordinator-targeted schedule fires, **When** the wake callback runs, **Then** it builds and delivers a `buildSituationPrompt()` (existing rich prompt)
2. **Given** a non-coordinator schedule fires targeting "nova", **When** the wake callback runs, **Then** it delivers `[SCHEDULED REMINDER] {reason}` to nova's tmux session
3. **Given** a schedule fires targeting a dead session, **When** delivery fails, **Then** it logs a warning and disables the schedule (don't keep firing into void)

---

### Edge Cases

- What if the target agent disconnects from MCP but its tmux session is still alive? → Deliver anyway (tmux session is the delivery target, not MCP connection)
- What if two agents share a tmux session name? → Not possible — session names are `adj-swarm-{name}`, and agent names are unique
- What if a schedule is created during server startup before sessions are registered? → Fire on next tick after sessions load — skip delivery if session not found yet
- What if `scheduleCheck` (one-shot, used by auto-develop) needs targeting? → Add `targetAgent` param, default to coordinator for backwards compat

## Requirements

### Functional Requirements

- **FR-001**: `cron_schedules` table MUST have `target_agent` and `target_tmux_session` columns
- **FR-002**: `create_schedule` MUST default `target_agent` to the calling agent (self-scheduling)
- **FR-003**: `create_schedule` MUST accept optional `targetAgent` param for coordinator admin use
- **FR-004**: Schedule delivery MUST route to the target agent's tmux session, not hardcoded coordinator
- **FR-005**: Session destruction MUST disable all schedules and cancel all watches for that agent
- **FR-006**: All scheduling tools MUST be accessible to any MCP-connected agent
- **FR-007**: Non-coordinator agents MUST only see/manage their own schedules
- **FR-008**: Coordinator MUST retain admin access to all schedules
- **FR-009**: Existing coordinator schedules MUST continue working after migration

## Success Criteria

- **SC-001**: An agent (not coordinator) creates a schedule and receives prompt delivery to its tmux session
- **SC-002**: Killing an agent's tmux session disables all its schedules within 1 second
- **SC-003**: `list_schedules` returns only the caller's schedules (unless coordinator)
- **SC-004**: All existing coordinator schedules work unchanged after migration
- **SC-005**: All tests pass, no regressions
