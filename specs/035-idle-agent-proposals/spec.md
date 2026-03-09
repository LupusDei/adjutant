# Feature Specification: Idle Agent Proposal Generation

**Feature Branch**: `035-idle-agent-proposals`
**Created**: 2026-03-09
**Status**: Draft
**Epic**: `adj-057`

## User Scenarios & Testing

### User Story 1 - Idle Agent Receives Proposal Prompt (Priority: P1)

When the Adjutant coordinator observes an agent's status change to "idle", it schedules a delayed check (5 minutes) via `stimulusEngine.scheduleCheck()`. If the agent is still idle when the check fires, the coordinator sends the agent a message instructing it to generate two proposals — one engineering and one product. No cron jobs are added; the trigger is purely event-driven via the existing `agent:status_changed` event.

**Why this priority**: This is the core trigger mechanism. Without it, nothing else fires.

**Independent Test**: Set an agent to idle status, simulate the scheduleCheck callback firing after 5 minutes, verify the agent receives a proposal-generation message via `comm.messageAgent()`.

**Acceptance Scenarios**:

1. **Given** an agent changes status to "idle", **When** the behavior fires, **Then** it calls `stimulusEngine.scheduleCheck(300000, ...)` with agent context.
2. **Given** the scheduled check fires and the agent is still idle, **Then** the agent receives a nudge message with instructions and existing proposal context.
3. **Given** the agent goes back to "working" before the 5-minute check fires, **Then** the scheduled check is cancelled (or the callback checks current status and skips).
4. **Given** an agent was already nudged within this idle period, **When** the behavior fires again, **Then** no duplicate scheduleCheck is created.
5. **Given** an agent is idle but disconnected, **When** the behavior evaluates, **Then** no message is sent (agent can't receive it).

---

### User Story 2 - Proposal Deduplication Review (Priority: P1)

Before generating proposals, the idle agent reviews all existing pending and dismissed proposals via `list_proposals`. The agent uses this context to decide whether to create a new proposal or improve an existing one. The nudge message includes the list of existing proposals so the agent has context immediately.

**Why this priority**: Without dedup, agents flood the system with redundant proposals.

**Independent Test**: Call the behavior with 5 existing pending proposals; verify the nudge message includes proposal summaries. Verify the message instructs the agent to check for duplicates.

**Acceptance Scenarios**:

1. **Given** 3 pending proposals exist, **When** the nudge message is constructed, **Then** it includes titles and IDs of all 3 pending proposals.
2. **Given** dismissed proposals exist, **When** the nudge message is constructed, **Then** it includes dismissed proposal titles (so the agent knows what was already rejected and why).
3. **Given** 0 existing proposals, **When** the nudge message is constructed, **Then** it instructs the agent to generate two new proposals freely.

---

### User Story 3 - Pending Proposal Cap (Priority: P1)

When there are already 12 or more pending proposals, the idle agent MUST improve an existing pending proposal via `discuss_proposal` rather than creating new ones. This prevents proposal backlog bloat.

**Why this priority**: Hard cap prevents the system from drowning in unreviewed proposals.

**Independent Test**: Set pending proposal count to 12+, trigger the behavior, verify the nudge message tells the agent to improve an existing proposal and does NOT instruct it to create new ones.

**Acceptance Scenarios**:

1. **Given** 12 pending proposals exist, **When** the nudge fires, **Then** the message instructs the agent to pick and improve an existing proposal (not create new ones).
2. **Given** 11 pending proposals exist, **When** the nudge fires, **Then** the message allows the agent to either create new proposals or improve existing ones.
3. **Given** 15 pending proposals exist, **When** the nudge fires, **Then** the message is firm: "MUST improve an existing proposal, do not create new ones."

---

### Edge Cases

- What happens when the agent goes from idle to working between scheduleCheck creation and callback? → Callback re-checks agent status; if no longer idle, it skips the nudge.
- What if the agent is idle but has no MCP session (disconnected)? → Skip, agent can't receive messages.
- What if the same agent is nudged, starts working, then goes idle again? → Debounce resets after the agent transitions through a non-idle state. A new scheduleCheck is created.
- What if there are 12+ pending proposals but all are from this same agent? → Still must improve, not create — the cap is global.

## Requirements

### Functional Requirements

- **FR-001**: System MUST schedule a delayed check (5 minutes) when an agent's status changes to "idle", using `stimulusEngine.scheduleCheck()`.
- **FR-002**: System MUST NOT add any new cron jobs or scheduled behaviors — trigger is purely event-driven.
- **FR-003**: System MUST include existing pending and dismissed proposal summaries in the nudge message.
- **FR-004**: System MUST enforce a 12-proposal pending cap — when reached, nudge instructs "improve only."
- **FR-005**: System MUST debounce nudges per-agent to prevent repeated prompting (1 nudge per idle period).
- **FR-006**: System MUST NOT nudge disconnected agents.
- **FR-007**: Nudge message MUST instruct the agent to generate one engineering and one product proposal (or improve existing ones if cap hit).
- **FR-008**: System SHOULD log the nudge as a decision in AdjutantState for audit trail.
- **FR-009**: If the agent leaves idle before the scheduled check fires, the nudge SHOULD be skipped (check current status in callback).

### Key Entities

- **AgentProfile**: Existing entity — `lastStatus`, `lastStatusAt` fields used for idle detection.
- **Proposal**: Existing entity — `status` field used for pending count, `type` for engineering/product.
- **Debounce state**: Per-agent timestamp stored via `AdjutantState.setMeta()`.
- **StimulusEngine**: Existing service — `scheduleCheck(delayMs, reason)` for delayed evaluation.

## Success Criteria

- **SC-001**: Idle agents receive proposal nudges exactly 5 minutes after going idle (via scheduleCheck, not cron).
- **SC-002**: No duplicate nudges sent to the same agent within a single idle period.
- **SC-003**: When pending proposals >= 12, 100% of nudges instruct "improve only."
- **SC-004**: All behavior logic covered by unit tests (shouldAct guard, act handler, message construction).
- **SC-005**: Zero new cron jobs or scheduled behaviors added to the system.
