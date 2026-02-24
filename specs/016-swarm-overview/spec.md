# Feature Specification: Swarm Overview Page

**Feature Branch**: `016-swarm-overview`
**Created**: 2026-02-24
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Project Overview at a Glance (Priority: P1)

As a user in swarm mode with an active project, I want a dedicated overview tab (leftmost, like Dashboard in Gastown mode) that shows me the state of my project: beads being worked on, epics nearing completion, and agent activity — all scoped to the active project.

**Why this priority**: This is the primary interface for swarm mode. Without it, users must navigate multiple tabs to understand project state.

**Independent Test**: Activate a project with some open/in-progress beads and agents. The Overview tab should appear as the leftmost tab and display all relevant data.

**Acceptance Scenarios**:

1. **Given** a user in swarm mode with an active project, **When** they open the app, **Then** the Overview tab is the leftmost tab and shows project-scoped data.
2. **Given** the active project has open and in-progress beads, **When** viewing the Overview, **Then** beads are grouped by status: open, in progress, recently closed.
3. **Given** the active project has epics with varying completion, **When** viewing the Overview, **Then** epics are ordered by closest to complete (highest % first).
4. **Given** no epics are in progress, **When** viewing the Overview, **Then** recently completed epics are shown instead.
5. **Given** no active project is set, **When** the user is in swarm mode, **Then** the Overview tab is hidden or shows a prompt to activate a project.

---

### User Story 2 - Agent Management from Overview (Priority: P1)

As a user, I want to see all agents working on my project with their status, current beads, and unread messages — and start new agents directly from the overview.

**Why this priority**: Agent awareness and quick-spawn is core to swarm management.

**Independent Test**: With 2+ agents on the project, verify status dots, bead assignments, and unread counts display. Tap Start Agent, spawn, and verify navigation to chat.

**Acceptance Scenarios**:

1. **Given** agents are working on the active project, **When** viewing the Agents section, **Then** each agent shows: name, status (working/idle/blocked), assigned/in-progress beads, and unread message count.
2. **Given** the user taps the Start Agent button, **When** a random callsign is assigned, **Then** a new agent spawns and the user is taken to chat with that agent.
3. **Given** the user long-presses the Start Agent button, **When** the callsign picker appears, **Then** the user can select a specific callsign before spawning.
4. **Given** a new agent has been started, **When** the spawn completes, **Then** the app navigates to the Chat tab with the new agent selected as recipient.

---

### User Story 3 - Epic Progress Tracking (Priority: P2)

As a user, I want to see which epics are closest to completion so I can focus attention on finishing them.

**Why this priority**: Enhances project visibility but not strictly required for basic swarm operation.

**Independent Test**: Create an epic with 4 tasks, close 3. Verify it shows ~75% complete and appears before epics with lower completion.

**Acceptance Scenarios**:

1. **Given** multiple epics are in progress, **When** viewing the Epics section, **Then** they are ordered by completion percentage (highest first).
2. **Given** an epic has 5 children with 3 closed, **When** viewing its row, **Then** it shows 60% completion with a visual progress indicator.
3. **Given** no epics are in progress, **When** viewing the Epics section, **Then** the 2-3 most recently completed epics are shown instead.

---

### User Story 4 - Project Intelligence (Priority: P3, User-Assigned)

As a user, I want the overview to suggest what should be worked on next, informed by agent suggestions for new beads and project health.

**Why this priority**: This requires deeper integration with agent workflows and is deferred for future implementation. Assigned to user.

**Description**: Have agents come up with new tasks to be worked on to improve the project. This may involve agents analyzing project state, identifying gaps, and creating suggestion beads.

---

### Edge Cases

- What happens when the active project has no .beads/ directory? Show empty state with guidance.
- What happens when the project has beads but no agents? Show beads/epics sections, empty agents section with prominent Start Agent.
- What happens when the project is deactivated while viewing the overview? Navigate away or show activation prompt.
- What if the backend is unreachable? Show cached data or error state with retry.

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a project-scoped overview endpoint that aggregates beads, epics, and agents for a specific project.
- **FR-002**: System MUST compute epic completion percentage as (closed children / total children).
- **FR-003**: System MUST show the Overview tab as leftmost tab in swarm mode when an active project exists.
- **FR-004**: System MUST scope all displayed data to the active project's .beads/ directory and associated agents.
- **FR-005**: System MUST support starting a new agent from the overview with callsign selection (tap for random, long-press to choose).
- **FR-006**: System MUST navigate to chat with the newly spawned agent after successful spawn.
- **FR-007**: System MUST show recently closed beads/epics as fallback when none are actively in progress.

### Key Entities

- **ProjectOverview**: Aggregated project state (beads, epics, agents)
- **EpicProgress**: Epic with completion percentage and child counts
- **AgentSummary**: Agent with status, assigned beads, unread message count

## Success Criteria

- **SC-001**: Overview loads in under 2 seconds on WiFi
- **SC-002**: All data is scoped to active project (no cross-project bleed)
- **SC-003**: Start Agent → Chat navigation completes in under 3 seconds
- **SC-004**: Epic completion percentages match actual child bead status
