# Feature Specification: Idle Agent Proposal Generation

**Feature Branch**: `035-idle-agent-proposals`
**Created**: 2026-03-09
**Status**: Draft
**Epic**: `adj-057`

## Architecture: Coordinator-Mediated Flow

The behavior does NOT message idle agents directly. Instead:

1. **Behavior** (in-process backend) detects `agent:status_changed` → idle
2. **Behavior** calls `stimulusEngine.scheduleCheck(300000, ...)` with agent context
3. **5 minutes later**, stimulus engine wakes the **Adjutant coordinator agent** via tmux prompt injection
4. **Coordinator** (Claude Code agent) reads the situation prompt containing the idle agent info, existing proposal context, and cap status
5. **Coordinator** decides to message the idle agent via `send_message` or `nudge_agent`

The behavior's job is to schedule the reminder and build the context. The coordinator is the decision-maker.

## User Scenarios & Testing

### User Story 1 - Schedule Proposal Nudge on Idle (Priority: P1)

When the Adjutant coordinator observes an agent's status change to "idle", it schedules a delayed check (5 minutes) via `stimulusEngine.scheduleCheck()`. When the check fires, the stimulus engine wakes the coordinator with a situation prompt that includes: the idle agent's ID, existing proposal context (pending + dismissed), and the pending cap status. The coordinator then decides how to nudge the idle agent.

**Why this priority**: This is the core trigger mechanism. Without it, nothing else fires.

**Independent Test**: Simulate agent status change to idle, verify `scheduleCheck(300000, ...)` is called with correct reason string containing agent ID and proposal context.

**Acceptance Scenarios**:

1. **Given** an agent changes status to "idle", **When** the behavior fires, **Then** it calls `stimulusEngine.scheduleCheck(300000, ...)` with a reason string containing the agent ID.
2. **Given** the scheduled check fires, **Then** the stimulus engine wakes the coordinator with a situation prompt containing the idle agent info and proposal context.
3. **Given** the agent goes back to "working" before the 5-minute check fires, **Then** the callback checks current status and the coordinator skips the nudge.
4. **Given** an agent was already scheduled for a nudge within this idle period, **When** the status event fires again, **Then** no duplicate scheduleCheck is created (debounce).
5. **Given** an agent is idle but disconnected, **When** the behavior evaluates, **Then** no scheduleCheck is created.

---

### User Story 2 - Proposal Context in Wake Prompt (Priority: P1)

The scheduleCheck reason string (which becomes part of the coordinator's situation prompt) includes existing proposal context: pending and dismissed proposal summaries. This gives the coordinator enough information to instruct the idle agent on whether to create new proposals or improve existing ones.

**Why this priority**: Without context in the wake prompt, the coordinator would need to query proposals itself, adding latency and complexity.

**Independent Test**: Create 5 pending and 2 dismissed proposals, trigger the behavior, verify the scheduleCheck reason string includes proposal titles and counts.

**Acceptance Scenarios**:

1. **Given** 3 pending proposals exist, **When** the scheduleCheck reason is built, **Then** it includes titles and IDs of all 3 pending proposals.
2. **Given** dismissed proposals exist, **When** the reason is built, **Then** it includes dismissed proposal titles so the coordinator knows what was already rejected.
3. **Given** 0 existing proposals, **When** the reason is built, **Then** it indicates no existing proposals — coordinator can instruct the agent to create freely.

---

### User Story 3 - Pending Proposal Cap in Wake Prompt (Priority: P1)

When there are 12 or more pending proposals, the scheduleCheck reason string explicitly tells the coordinator that the cap is reached and the idle agent MUST improve an existing proposal rather than creating new ones.

**Why this priority**: Hard cap prevents the system from drowning in unreviewed proposals.

**Independent Test**: Set pending proposal count to 12+, trigger the behavior, verify the reason string includes cap-reached instruction.

**Acceptance Scenarios**:

1. **Given** 12 pending proposals exist, **When** the reason is built, **Then** it includes "PENDING CAP REACHED (12/12) — agent must improve an existing proposal, not create new ones."
2. **Given** 11 pending proposals exist, **When** the reason is built, **Then** it indicates the agent may create new proposals or improve existing ones.
3. **Given** 15 pending proposals exist, **When** the reason is built, **Then** cap-reached instruction is firm.

---

### Edge Cases

- What happens when the agent goes from idle to working before the coordinator is woken? → The coordinator's situation prompt will include current agent status; coordinator checks before acting.
- What if the agent is idle but disconnected? → Behavior skips scheduleCheck entirely — no point waking coordinator for an unreachable agent.
- What if the same agent is nudged, starts working, then goes idle again? → Debounce resets after the agent transitions through a non-idle state. A new scheduleCheck is created.
- What if there are 12+ pending proposals but all are from this same agent? → Still must improve — the cap is global.
- What if the coordinator is not running when the check fires? → Stimulus engine handles this — it queues the wake or the check is lost (acceptable since the next idle event will reschedule).

## Requirements

### Functional Requirements

- **FR-001**: Behavior MUST schedule a delayed check (5 minutes) via `stimulusEngine.scheduleCheck()` when an agent's status changes to "idle".
- **FR-002**: Behavior MUST NOT add any new cron jobs or scheduled behaviors — trigger is purely event-driven.
- **FR-003**: Behavior MUST NOT message the idle agent directly — it only schedules the coordinator wake.
- **FR-004**: The scheduleCheck reason MUST include: idle agent ID, existing pending proposal summaries, dismissed proposal summaries, and pending cap status.
- **FR-005**: When pending proposals >= 12, the reason string MUST explicitly state the cap is reached and the agent must improve, not create.
- **FR-006**: Behavior MUST debounce per-agent to prevent duplicate scheduleChecks within the same idle period.
- **FR-007**: Behavior MUST NOT schedule checks for disconnected agents.
- **FR-008**: Behavior SHOULD log the scheduled check as a decision in AdjutantState for audit trail.

### Key Entities

- **AgentProfile**: Existing entity — `lastStatus`, `lastStatusAt` fields used for idle detection.
- **Proposal**: Existing entity — `status` field used for pending count, `type` for engineering/product.
- **Debounce state**: Per-agent check ID stored via `AdjutantState.setMeta()`.
- **StimulusEngine**: Existing service — `scheduleCheck(delayMs, reason)` for delayed coordinator wake.

## Success Criteria

- **SC-001**: Coordinator is woken exactly 5 minutes after an agent goes idle (via scheduleCheck).
- **SC-002**: No duplicate scheduleChecks for the same agent within a single idle period.
- **SC-003**: When pending proposals >= 12, wake prompt includes cap-reached instruction.
- **SC-004**: All behavior logic covered by unit tests (shouldAct guard, act handler, reason string construction).
- **SC-005**: Zero new cron jobs added. Zero direct agent messages from the behavior.
