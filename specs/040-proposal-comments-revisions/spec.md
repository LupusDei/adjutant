# Feature Specification: Proposal Comments & Revisions

**Feature Branch**: `040-proposal-comments-revisions`
**Created**: 2026-03-10
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Proposal Comments (Priority: P2)

As an agent reviewing a proposal, I want to leave comments on the proposal record itself so that my feedback is permanently attached to the proposal and visible to all agents and the user — not lost in general chat history.

As the user, I want to read agent comments on a proposal and add my own comments so that I can participate in the discussion thread directly on the proposal.

**Why this priority**: Agent reviews currently go to chat messages — zero persistence on the proposal object. This is the #1 gap identified during the 6-proposal review session.

**Independent Test**: Create a proposal, add 3 comments from different agents, verify all comments appear when viewing the proposal via REST API and MCP tool.

**Acceptance Scenarios**:

1. **Given** a pending proposal, **When** an agent calls `comment_on_proposal({ id, body })`, **Then** the comment is stored with author identity resolved server-side, and retrievable via `GET /api/proposals/:id/comments`
2. **Given** a proposal with 5 comments, **When** the user opens the proposal detail in iOS, **Then** all 5 comments are displayed in chronological order with author and timestamp
3. **Given** a proposal, **When** the user posts a comment via `POST /api/proposals/:id/comments`, **Then** the comment appears with author="user"

---

### User Story 2 - Proposal Revisions (Priority: P2)

As an agent who identified improvements during a proposal review, I want to create a revision of the proposal that updates its title, description, or type, while preserving the full history of previous versions.

As the user, I want to see the latest version of a proposal by default, but also browse the revision history to understand how the proposal evolved.

**Why this priority**: Agents currently cannot update proposals — they can only create new ones. This leads to duplicate proposals instead of refined ones.

**Independent Test**: Create a proposal, submit 2 revisions with different descriptions, verify the latest revision is returned by `get_proposal`, and all 3 versions appear in revision history.

**Acceptance Scenarios**:

1. **Given** a proposal (v1), **When** an agent calls `revise_proposal({ id, description, changelog })`, **Then** a revision (v2) is stored, and `get_proposal(id)` returns the v2 content
2. **Given** a proposal with 3 revisions, **When** calling `GET /api/proposals/:id/revisions`, **Then** all 3 revisions are returned in chronological order with revision numbers
3. **Given** a proposal with revisions, **When** viewing in iOS, **Then** the latest revision content is displayed, with a "History" section showing previous versions and changelogs

---

### User Story 3 - Discussion Workflow Integration (Priority: P2)

As an agent running the discuss_proposal skill, I want the skill to automatically record my review as a comment on the proposal, so my analysis is captured even if the chat scrolls away.

**Why this priority**: Bridges the existing discuss_proposal workflow with the new comment system — completes the feedback loop.

**Independent Test**: Run discuss_proposal skill, verify a comment is auto-created on the proposal with the agent's review summary.

**Acceptance Scenarios**:

1. **Given** the discuss_proposal skill is invoked, **When** the agent completes its review, **Then** the skill creates a comment on the proposal summarizing the review findings
2. **Given** a discuss_proposal review that identifies improvements, **When** the agent decides to revise, **Then** a revision is created (not a new proposal) with a changelog noting what changed

---

### Edge Cases

- What happens when commenting on a non-existent proposal? → 404 error
- What happens when revising a dismissed/completed proposal? → Allow it (revisions reopen discussion)
- What if two agents revise the same proposal simultaneously? → Last-write-wins on revision number (sequential), both revisions preserved
- Maximum comment length? → 10,000 characters (same as proposal description)
- Can the user create revisions via REST? → Yes, author="user"

## Requirements

### Functional Requirements

- **FR-001**: System MUST support adding comments to proposals (MCP tool + REST endpoint)
- **FR-002**: System MUST support creating revisions of proposals (MCP tool + REST endpoint)
- **FR-003**: System MUST return the latest revision content when fetching a proposal
- **FR-004**: System MUST provide revision history with changelogs
- **FR-005**: System MUST resolve comment/revision author from MCP session (server-side identity)
- **FR-006**: iOS and frontend MUST display comments and revision history on proposal detail views

### Key Entities

- **ProposalComment**: { id, proposalId, author, body, createdAt }
- **ProposalRevision**: { id, proposalId, revisionNumber, author, title, description, type, changelog, createdAt }

## Success Criteria

- **SC-001**: Agent reviews via discuss_proposal create persistent comments on the proposal
- **SC-002**: Proposals can be iteratively refined through revisions without creating duplicates
- **SC-003**: iOS proposal detail view shows comments and revision history
