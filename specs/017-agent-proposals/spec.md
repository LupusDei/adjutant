# Feature Specification: Agent Proposals System

**Feature Branch**: `017-agent-proposals`
**Created**: 2026-02-24
**Status**: Draft

## Overview

When agents finish their assigned work and have no remaining tasks, they enter "proposal mode" — spending deep thinking time generating improvement proposals for the project. Each idle agent spawns two specialized teammates: a Product/UX thinker and a Staff Engineer thinker. Both review existing proposals for uniqueness before submitting their own.

Proposals are surfaced in a new "Proposals" tab on both the web frontend and iOS app, where the user can accept or dismiss them. Accepted proposals can be sent to agents for epic planning and implementation.

---

## User Scenarios & Testing

### User Story 1 - Data Model & Backend API (Priority: P1)

The system persists proposals in SQLite and exposes REST endpoints for CRUD operations. Agents create proposals via MCP tools; users manage them via the web/iOS UI.

**Why this priority**: Nothing else works without the data layer and API.

**Independent Test**: POST a proposal via API, GET it back, PATCH status to accepted/dismissed.

**Acceptance Scenarios**:

1. **Given** the database is initialized, **When** a proposal is created via POST /api/proposals, **Then** it is persisted with status "pending" and a generated UUID
2. **Given** proposals exist, **When** GET /api/proposals is called with `?status=pending`, **Then** only pending proposals are returned sorted by newest first
3. **Given** a pending proposal, **When** PATCH /api/proposals/:id with `{ status: "accepted" }`, **Then** the proposal status updates to "accepted" and updated_at is refreshed
4. **Given** a pending proposal, **When** PATCH /api/proposals/:id with `{ status: "dismissed" }`, **Then** the proposal status updates to "dismissed"

---

### User Story 2 - MCP Tools for Agents (Priority: P1)

Agents need MCP tools to create proposals and list existing proposals (for uniqueness checking).

**Why this priority**: Agents can't generate proposals without these tools — parallel with US1 since both are foundational.

**Independent Test**: Connect an MCP client, call `list_proposals`, then `create_proposal`, verify it appears in subsequent `list_proposals`.

**Acceptance Scenarios**:

1. **Given** an agent connected via MCP, **When** it calls `create_proposal` with title, description, and type, **Then** the proposal is created with the agent's resolved identity as author
2. **Given** existing proposals, **When** an agent calls `list_proposals`, **Then** it receives all proposals (for uniqueness review)
3. **Given** an agent calls `list_proposals` with `type=product`, **Then** only product-type proposals are returned

---

### User Story 3 - Frontend Proposals Tab (Priority: P1)

A new "Proposals" tab in the web UI showing pending proposals with accept/dismiss actions, type filtering, and a dismissed sub-view.

**Why this priority**: Primary user interface for managing proposals — MVP delivery.

**Independent Test**: Open Proposals tab, see pending proposals, accept one (verify it shows accepted badge), dismiss another (verify it moves to dismissed view).

**Acceptance Scenarios**:

1. **Given** the user navigates to the Proposals tab, **When** there are pending proposals, **Then** they see proposal cards with title, author, type badge, description preview, and date
2. **Given** a pending proposal, **When** the user clicks Accept, **Then** the proposal status changes to "accepted" and a "Send to Agent" button appears
3. **Given** a pending proposal, **When** the user clicks Dismiss, **Then** the proposal disappears from the main view and is accessible via a "Show Dismissed" toggle
4. **Given** the user toggles "Show Dismissed", **When** there are dismissed proposals, **Then** they appear in a dimmed/secondary style
5. **Given** proposals of mixed types, **When** the user filters by "product" or "engineering", **Then** only matching proposals are shown

---

### User Story 4 - iOS Proposals Tab (Priority: P2)

A new "Proposals" tab in the iOS app with the same functionality as the web frontend.

**Why this priority**: Mobile experience follows web — same API, different presentation.

**Independent Test**: Open Proposals tab on iOS, see pending proposals, accept/dismiss, verify dismissed sub-menu.

**Acceptance Scenarios**:

1. **Given** the iOS app loads, **When** the user taps the Proposals tab, **Then** they see a list of pending proposals
2. **Given** a pending proposal on iOS, **When** the user swipe-actions or taps Accept, **Then** the proposal updates to accepted
3. **Given** an accepted proposal on iOS, **When** the user taps "Send to Agent", **Then** the system initiates epic planning for that proposal

---

### User Story 5 - Agent Proposal Generation Behavior (Priority: P2)

When an agent's task queue is empty, it enters proposal mode: spawning a Product/UX teammate and a Staff Engineer teammate, each generating one unique proposal.

**Why this priority**: The agent behavior is the generation engine — depends on MCP tools being available.

**Independent Test**: Simulate an idle agent, verify it spawns two teammates, each reviews existing proposals, and creates a unique proposal.

**Acceptance Scenarios**:

1. **Given** an agent has no remaining tasks (`bd ready` returns empty), **When** the agent enters proposal mode, **Then** it spawns a Product/UX teammate and a Staff Engineer teammate
2. **Given** a Product/UX teammate, **When** it generates a proposal, **Then** it first calls `list_proposals` to check uniqueness, then calls `create_proposal` with type "product"
3. **Given** a Staff Engineer teammate, **When** it generates a proposal, **Then** it first calls `list_proposals` to check uniqueness, then calls `create_proposal` with type "engineering"
4. **Given** existing proposals cover a topic, **When** a teammate discovers its idea is already proposed, **Then** it generates a different, novel proposal instead

---

### Edge Cases

- What happens when an agent creates a proposal with a duplicate title? → Allow it (descriptions may differ), but the uniqueness check should catch obvious duplicates.
- What happens when all proposals are dismissed? → Main view shows empty state with "No pending proposals" message.
- What happens when the user accepts then wants to undo? → No undo; the user can re-create the proposal or the status is final.
- What if "Send to Agent" fails? → Show error toast, proposal stays in accepted state for retry.

## Requirements

### Functional Requirements

- **FR-001**: System MUST persist proposals in SQLite with id, author, title, description, type, status, created_at, updated_at
- **FR-002**: System MUST expose REST endpoints: GET/POST /api/proposals, PATCH/GET /api/proposals/:id
- **FR-003**: System MUST provide MCP tools: create_proposal, list_proposals
- **FR-004**: System MUST resolve agent identity server-side via MCP session (not client-supplied)
- **FR-005**: Frontend MUST show a Proposals tab with pending proposals by default
- **FR-006**: Frontend MUST support Accept and Dismiss actions on pending proposals
- **FR-007**: Dismissed proposals MUST be viewable in a sub-menu/filter toggle
- **FR-008**: Accepted proposals MUST show a "Send to Agent" action
- **FR-009**: iOS MUST have a matching Proposals tab with equivalent functionality
- **FR-010**: Agents MUST review existing proposals for uniqueness before creating new ones
- **FR-011**: Proposal type MUST be either "product" or "engineering"

### Key Entities

- **Proposal**: An improvement suggestion authored by an agent. Has a type (product/engineering), a lifecycle (pending → accepted/dismissed), and a deep description of the proposed change.

## Success Criteria

- **SC-001**: Proposals created by agents appear in the frontend within 5 seconds
- **SC-002**: Accept/Dismiss actions update proposal status instantly in the UI
- **SC-003**: Dismissed proposals are hidden from the default view but accessible via toggle
- **SC-004**: Agent proposal generation produces unique, non-duplicate suggestions
- **SC-005**: Both web and iOS tabs render proposals consistently
