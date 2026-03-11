# Feature Specification: Proposal Project Scoping

**Feature Branch**: `041-proposal-project-scoping`
**Created**: 2026-03-11
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Frontend Project-Scoped Proposal List (Priority: P1)

As a user viewing proposals in the web dashboard, I want to see only proposals for my currently selected project, so I don't get confused by proposals from other projects.

**Why this priority**: Users switching between projects currently see ALL proposals mixed together. This is the most visible gap — the proposal list is useless when managing multiple projects.

**Independent Test**: Select project A, verify only project A proposals appear. Switch to project B, verify only project B proposals appear.

**Acceptance Scenarios**:

1. **Given** the user has project "adjutant" selected, **When** they navigate to the Proposals page, **Then** only proposals with `project="adjutant"` are displayed
2. **Given** the user switches active project from "adjutant" to "otherproject", **When** the proposal list reloads, **Then** it shows only "otherproject" proposals
3. **Given** a proposal has `project=""` (empty), **When** the user views any project's proposals, **Then** that proposal does NOT appear (orphaned proposals are hidden)

---

### User Story 2 - iOS Project-Scoped Proposal List (Priority: P1)

As a user viewing proposals in the iOS app, I want to see only proposals for the currently selected project.

**Independent Test**: Same as US1 but in iOS.

**Acceptance Scenarios**:

1. **Given** the iOS app has a project selected, **When** the user opens the Proposals tab, **Then** only proposals for that project are displayed
2. **Given** the user switches projects, **When** the proposal list refreshes, **Then** it shows the new project's proposals

---

### User Story 3 - MCP Tool Project Enforcement (Priority: P1)

As the system, when an agent creates a proposal via MCP, the proposal MUST be scoped to the agent's current project. Agents should not be able to create proposals for projects they're not working on.

**Why this priority**: Without enforcement, agents can pollute other projects' proposal lists.

**Independent Test**: Agent connected to project "adjutant" calls `create_proposal` — verify the proposal gets `project="adjutant"` regardless of what the agent passes.

**Acceptance Scenarios**:

1. **Given** an agent connected to project "adjutant", **When** it calls `create_proposal`, **Then** the proposal's `project` field is auto-set to "adjutant" (server-side, not client-supplied)
2. **Given** an agent calls `list_proposals` without a project filter, **Then** it returns only proposals for the agent's current project
3. **Given** an agent is asked to execute a proposal from a different project, **Then** the agent should decline politely (not change the proposal's status)

---

### User Story 4 - Agent Cross-Project Proposal Decline (Priority: P2)

As an agent, when I'm asked to work on a proposal that belongs to a different project than my current scope, I should decline rather than execute it.

**Independent Test**: Send a proposal from project B to an agent scoped to project A. Verify the agent declines without changing proposal status.

**Acceptance Scenarios**:

1. **Given** an agent scoped to "adjutant" receives a proposal from project "other", **When** the execute_proposal skill runs, **Then** it detects the mismatch and sends a polite decline message
2. **Given** a cross-project decline, **Then** the proposal status remains unchanged (still "pending")

---

### Edge Cases

- What if an agent has no project context? → Reject proposal creation (project is required)
- What if the project field is empty string? → Treat as "unscoped" — hidden from all project views
- What about the `discuss_proposal` MCP tool? → Also auto-scope to agent's project for listing
- Can users create proposals via REST without a project? → No, `CreateProposalSchema` already requires `project: z.string().min(1)`

## Requirements

### Functional Requirements

- **FR-001**: Frontend proposal list MUST filter by active project from ProjectContext
- **FR-002**: iOS proposal list MUST filter by active project
- **FR-003**: MCP `create_proposal` MUST auto-set project from agent's project context (server-side)
- **FR-004**: MCP `list_proposals` MUST default to agent's current project when no filter specified
- **FR-005**: `execute_proposal` skill MUST check project match before execution
- **FR-006**: Existing proposals with empty project field should be hidden from project-scoped views

## Success Criteria

- **SC-001**: Switching projects in frontend/iOS shows only that project's proposals
- **SC-002**: Agents cannot create proposals for projects they're not scoped to
- **SC-003**: Cross-project proposal execution is declined gracefully
