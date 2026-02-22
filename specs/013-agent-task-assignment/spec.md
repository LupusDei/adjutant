# Feature Specification: Agent Task Assignment

**Feature Branch**: `013-agent-task-assignment`
**Created**: 2026-02-22
**Status**: Draft
**Input**: User description: "Add the ability to assign beads/tasks to agents from both the Beads view and Epics view in the Adjutant dashboard. When a task is assigned to an agent: 1) The bead status should automatically move to in_progress, 2) The bead's assignee field should be set to the selected agent, 3) The agent should be notified via MCP messaging that they have been assigned a new task."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Assign a Task from Beads View (Priority: P1)

The Mayor opens the Beads view (Kanban or list mode) and sees an unassigned open task. They click an "Assign" control on the bead card, which reveals a dropdown of available agents filtered to only those with "idle" or "working" status. They select an agent. The system automatically sets the bead's assignee to the selected agent, transitions the bead status to "in_progress", and sends the agent a notification message informing them of the assignment.

**Why this priority**: This is the core interaction — assigning work from the primary beads interface. Without this, no other stories deliver value.

**Independent Test**: Can be fully tested by opening the Beads view, clicking assign on any open bead, selecting an agent, and verifying the bead updates and the agent receives a message.

**Acceptance Scenarios**:

1. **Given** an open bead with no assignee in the Beads Kanban view, **When** the Mayor clicks the assign control and selects an idle agent, **Then** the bead's assignee is set to that agent, the bead status moves to "in_progress", the Kanban card moves to the in_progress column, and the agent receives a notification message.
2. **Given** an open bead in the Beads list view, **When** the Mayor assigns an agent with "working" status, **Then** the same assignment, status change, and notification occur.
3. **Given** a bead that is already assigned to an agent, **When** the Mayor reassigns it to a different agent, **Then** the assignee updates to the new agent and the new agent receives a notification.

---

### User Story 2 - Assign a Task from Epics View (Priority: P1)

The Mayor opens the Epics view and expands an epic to see its subtasks. They click the assign control on a subtask card and select an available agent. The same assignment flow occurs: assignee is set, status moves to "in_progress", and the agent is notified.

**Why this priority**: Equal priority with US1 — the Epics view is the other primary surface for managing work. Both views must support assignment for the feature to be complete.

**Independent Test**: Can be fully tested by opening the Epics view, expanding an epic, assigning a subtask to an agent, and verifying the bead updates and agent notification.

**Acceptance Scenarios**:

1. **Given** an open subtask under an epic in the Epics view, **When** the Mayor assigns it to an idle agent, **Then** the subtask's assignee is set, status moves to "in_progress", and the agent receives a notification.
2. **Given** an epic-level bead (not a subtask), **When** the Mayor assigns it to an agent, **Then** the same assignment flow applies to the epic itself.

---

### User Story 3 - Agent Availability Filtering (Priority: P2)

The assignment dropdown only shows agents that are currently in "idle" or "working" status. Agents that are "blocked" or "done" are excluded. The dropdown updates each time it is opened to reflect current agent availability.

**Why this priority**: Important for usability — prevents assigning work to unavailable agents — but the core assignment mechanism (US1/US2) works regardless.

**Independent Test**: Can be tested by verifying the dropdown contents against the known agent status list, confirming only idle/working agents appear.

**Acceptance Scenarios**:

1. **Given** three agents (one idle, one working, one blocked), **When** the Mayor opens the assignment dropdown, **Then** only the idle and working agents appear as options.
2. **Given** an agent transitions from idle to done, **When** the Mayor opens the dropdown on a different bead, **Then** that agent no longer appears.
3. **Given** no agents are idle or working, **When** the Mayor opens the dropdown, **Then** the dropdown shows an empty state message indicating no agents are available.

---

### Edge Cases

- What happens when the selected agent disconnects between dropdown open and selection? The system should attempt the assignment and show an error if the notification cannot be delivered, but still update the bead.
- What happens when two users try to assign the same bead simultaneously? The last write wins — the bead reflects the most recent assignment.
- What happens when the bd CLI update fails (e.g., bead was closed between loading and assigning)? The UI should show an error message and refresh the bead's current state.
- What happens when assigning a bead that already has "in_progress" status? The assignee updates but the status remains "in_progress" (no redundant status change).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display an assignment control on each bead card in both the Beads view (Kanban and list modes) and the Epics view (epic cards and subtask cards).
- **FR-002**: The assignment control MUST show a dropdown of agents filtered to only those with "idle" or "working" status.
- **FR-003**: When an agent is selected for assignment, the system MUST update the bead's assignee field to the selected agent's identifier.
- **FR-004**: When an agent is selected for assignment on a bead with "open" status, the system MUST automatically transition the bead status to "in_progress".
- **FR-005**: When an agent is selected for assignment on a bead already in "in_progress" status, the system MUST update only the assignee (no status change).
- **FR-006**: After successful assignment, the system MUST send a notification message to the assigned agent via the messaging system, including the bead ID, title, and a brief description of the assignment.
- **FR-007**: The assignment dropdown MUST refresh its agent list each time it is opened to reflect current availability.
- **FR-008**: The UI MUST display an error message if the assignment operation fails, and refresh the bead to show its current state.
- **FR-009**: The assignment control MUST show the currently assigned agent (if any) as a visual indicator on the bead card.
- **FR-010**: The system MUST support reassignment — changing the assignee from one agent to another.

### Key Entities

- **Bead**: Represents a task/issue with id, title, status, assignee, priority, type. Assignment modifies the assignee and potentially the status fields.
- **Agent**: Represents a connected agent with agentId, status (idle/working/blocked/done), current task. Only agents with idle or working status are eligible for assignment.
- **Assignment Notification**: A message sent to an agent when assigned a bead, containing the bead ID, title, and assignment context.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can assign a bead to an agent in under 3 clicks (open dropdown, select agent — 2 clicks).
- **SC-002**: Bead status and assignee update within 2 seconds of selection.
- **SC-003**: Agent receives notification within 5 seconds of assignment.
- **SC-004**: Assignment is available on 100% of bead cards in both Beads and Epics views.
- **SC-005**: Only eligible agents (idle or working) appear in the assignment dropdown — zero ineligible agents shown.

## Assumptions

- Agent status data is available via the existing in-memory agent status store and can be queried from the backend.
- The existing `bd update` CLI command supports setting both assignee and status in a single or sequential calls.
- The message store's `insertMessage` function can be used to create assignment notifications that are broadcast via WebSocket to connected agents.
- The existing polling mechanism (30-second interval) in the Beads view is sufficient for reflecting assignment changes made by other users; real-time WebSocket updates provide faster feedback for the assigning user.
