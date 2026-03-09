# Feature Specification: Idle Agent Proposal Generation

**Feature Branch**: `035-idle-agent-proposals`
**Created**: 2026-03-09
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Idle Agent Receives Proposal Prompt (Priority: P1)

When an agent has been idle for a configurable period (default: 10 minutes), the Adjutant coordinator behavior detects this and sends the agent a message instructing it to generate two proposals — one engineering and one product. The agent is given context about existing proposals to avoid duplication.

**Why this priority**: This is the core trigger mechanism. Without it, nothing else fires.

**Independent Test**: Set an agent to idle status, wait for the configured period, verify the agent receives a proposal-generation message via `comm.messageAgent()`.

**Acceptance Scenarios**:

1. **Given** an agent has status "idle" for >= 10 minutes, **When** the idle-proposal-nudge behavior fires, **Then** the agent receives a message with instructions to generate proposals and a summary of existing pending/dismissed proposals.
2. **Given** an agent has status "working", **When** the behavior evaluates, **Then** no message is sent.
3. **Given** an agent was already nudged within the debounce window, **When** the behavior fires again, **Then** no duplicate message is sent.
4. **Given** an agent is idle but disconnected, **When** the behavior evaluates, **Then** no message is sent (agent can't receive it).

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

- What happens when the agent goes from idle to working between detection and message delivery? → Behavior checks status at evaluation time; if the agent is no longer idle when `act()` fires, it skips.
- What if the agent is idle but has no MCP session (disconnected)? → Skip, agent can't receive messages.
- What if the same agent is nudged, starts working, then goes idle again? → Debounce resets after the agent transitions through a non-idle state.
- What if there are 12+ pending proposals but all are from this same agent? → Still must improve, not create — the cap is global.

## Requirements

### Functional Requirements

- **FR-001**: System MUST detect agents idle for >= configurable threshold (default 10 min) and send a proposal-generation nudge.
- **FR-002**: System MUST include existing pending and dismissed proposal summaries in the nudge message.
- **FR-003**: System MUST enforce a 12-proposal pending cap — when reached, nudge instructs "improve only."
- **FR-004**: System MUST debounce nudges per-agent to prevent repeated prompting (1 nudge per idle period).
- **FR-005**: System MUST NOT nudge disconnected agents.
- **FR-006**: Nudge message MUST instruct the agent to generate one engineering and one product proposal (or improve existing ones if cap hit).
- **FR-007**: System SHOULD log the nudge as a decision in AdjutantState for audit trail.

### Key Entities

- **AgentProfile**: Existing entity — `lastStatus`, `lastStatusAt` fields used for idle detection.
- **Proposal**: Existing entity — `status` field used for pending count, `type` for engineering/product.
- **Debounce state**: Per-agent timestamp stored via `AdjutantState.setMeta()`.

## Success Criteria

- **SC-001**: Idle agents receive proposal nudges within 2 minutes of crossing the idle threshold (behavior runs on schedule).
- **SC-002**: No duplicate nudges sent to the same agent within a single idle period.
- **SC-003**: When pending proposals >= 12, 100% of nudges instruct "improve only."
- **SC-004**: All behavior logic covered by unit tests (shouldAct guard, act handler, message construction).
