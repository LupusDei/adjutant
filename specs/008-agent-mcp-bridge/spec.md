# Feature Specification: Agent MCP Bridge

**Feature Branch**: `008-agent-mcp-bridge`
**Created**: 2026-02-21
**Status**: Draft
**Replaces**: adj-009 (beads mail for swarm), adj-010 (persistent messaging SQLite)

## Overview

Replace the fragile curl-based HTTP API and beads-mail systems with a proper MCP (Model Context Protocol) server embedded in the Adjutant backend. Agents connect via MCP and get structured tools for messaging, status reporting, bead operations, and dashboard queries. A companion Claude Code skill suite teaches agents how to use these tools automatically.

## Problem Statement

Current agent communication is broken across three half-implemented systems:

1. **Session pipeline** (tmux pipe-pane) — Real-time but ephemeral. No persistence, no offline delivery, pipe disconnects silently.
2. **Beads mail** (adj-009 design) — Persistent but uses `bd` CLI which SIGSEGV crashes under concurrency (adj-4qz). Heavyweight for simple messaging.
3. **HTTP curl** (adj-010 design) — Agents must manually construct curl commands. No discoverability, no type safety, fragile string templating.

None of these give agents first-class access to the dashboard. Agents can't check what other agents are doing, query project state, or interact with beads through a reliable typed interface.

**MCP solves this.** Agents connect once and get a typed tool catalog. The Adjutant backend becomes the single communication hub for all agent interaction.

## User Scenarios & Testing

### User Story 1 - Agent-to-User Messaging (Priority: P1)

An agent working on a task needs to communicate with the human operator — ask a question, report a blocker, or announce completion. The message appears in real-time on the web dashboard and iOS app, persists across session restarts, and supports threaded conversations.

**Why this priority**: This is the fundamental use case. Without reliable messaging, all other agent coordination breaks.

**Independent Test**: Start an agent session, have it call `send_message` via MCP, verify the message appears in the web dashboard chat view and iOS app within 2 seconds.

**Acceptance Scenarios**:

1. **Given** an agent connected to MCP, **When** the agent calls `send_message(to: "user", body: "Need approval on schema change")`, **Then** the message appears in the dashboard chat view within 2 seconds and persists in SQLite.
2. **Given** a message thread between user and agent, **When** the user replies via the dashboard, **Then** the agent receives the reply via MCP `read_messages` and the thread is correctly linked.
3. **Given** an agent session that crashes and restarts, **When** the new session connects to MCP, **Then** it can read the full message history from the previous session.
4. **Given** the user is on the iOS app, **When** an agent sends a message, **Then** the user receives an APNS push notification with the message preview.

---

### User Story 2 - Agent Status & Progress Reporting (Priority: P1)

Agents report their current status (working, blocked, idle, done) and task progress to the dashboard. The dashboard shows a real-time view of what every agent is doing, and announcements trigger notifications.

**Why this priority**: The dashboard's primary value is visibility into agent activity. Without structured status updates, the user is blind.

**Independent Test**: Have an agent call `report_progress(task: "adj-009.3.1", percent: 75, description: "Running tests")`, verify the dashboard crew view updates in real-time.

**Acceptance Scenarios**:

1. **Given** an agent working on a task, **When** it calls `set_status(status: "working", task: "adj-009.3.1")`, **Then** the crew panel shows the agent as "working" with the current task.
2. **Given** an agent that completes its work, **When** it calls `announce(message: "Feature X complete", type: "completion")`, **Then** the dashboard shows a prominent notification and iOS sends a push.
3. **Given** multiple agents running, **When** the dashboard loads, **Then** all agent statuses are current (within 5 seconds) via MCP connection state.

---

### User Story 3 - Agent Bead Operations via MCP (Priority: P2)

Agents can create, update, query, and close beads through MCP tools instead of shelling out to `bd` CLI. This eliminates SIGSEGV crashes from concurrent `bd` access and provides type-safe bead operations.

**Why this priority**: Replaces the crashy `bd` CLI path for agents while keeping `bd` for human use. Important but not as urgent as messaging.

**Independent Test**: Have an agent call `create_bead(title: "Fix auth bug", type: "task", priority: 1)`, verify the bead appears in the Kanban board on the dashboard.

**Acceptance Scenarios**:

1. **Given** an agent connected to MCP, **When** it calls `create_bead(title: "...", type: "task")`, **Then** a bead is created in `.beads/issues.jsonl` and the dashboard Kanban updates.
2. **Given** an open bead, **When** an agent calls `update_bead(id: "adj-009.3.1", status: "in_progress")`, **Then** the bead status changes and the dashboard reflects it in real-time.
3. **Given** a completed task, **When** an agent calls `close_bead(id: "adj-009.3.1", reason: "Tests passing")`, **Then** the bead closes and parent epic progress updates.

---

### User Story 4 - Dashboard Queries for Agents (Priority: P2)

Agents can query the dashboard to understand the broader system state — what other agents are doing, what beads are open, what the project status looks like. This enables autonomous coordination.

**Why this priority**: Enables agent autonomy. Less urgent than communication but enables smarter agent behavior.

**Independent Test**: Have an agent call `list_agents()`, verify it returns accurate data for all active agents including their status and current tasks.

**Acceptance Scenarios**:

1. **Given** 3 agents running, **When** agent A calls `list_agents()`, **Then** it receives data for all 3 agents with name, status, current task, and session info.
2. **Given** open beads in the project, **When** an agent calls `list_beads(status: "open", type: "task")`, **Then** it receives the filtered bead list with IDs, titles, and assignees.
3. **Given** an agent that needs context, **When** it calls `get_project_state()`, **Then** it receives a summary with open bead count, active agents, recent activity.

---

### User Story 5 - Claude Code Skills for Agents (Priority: P1)

A skill package that auto-configures MCP connection and teaches agents how to use Adjutant tools. Agents load this skill automatically and can immediately communicate without manual setup.

**Why this priority**: Without the skill, agents won't know the MCP tools exist. This is the onboarding path.

**Independent Test**: Spawn a new Claude Code agent in the project directory, verify it auto-discovers the MCP server and can call `send_message` without any manual configuration.

**Acceptance Scenarios**:

1. **Given** a project with `.claude/settings.json` configured, **When** a new Claude Code agent starts, **Then** it automatically connects to the Adjutant MCP server.
2. **Given** an agent with the skill loaded, **When** it needs to message the user, **Then** it knows to use `send_message` MCP tool (not curl, not bd).
3. **Given** an agent, **When** it calls `/adjutant-status`, **Then** it gets a formatted summary of project state, other agents, and open tasks.

---

### Edge Cases

- What happens when the MCP server is down but agents are running? (Graceful degradation, retry with backoff)
- What happens when two agents send conflicting bead updates? (Last-write-wins with sequence numbers)
- What happens when an agent disconnects mid-message-send? (Message either fully commits or doesn't — SQLite ACID)
- How do we handle agent identity? (Derive from MCP connection metadata or session ID)

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide an MCP server embedded in the Adjutant Express backend
- **FR-002**: System MUST support SSE transport for MCP connections from Claude Code agents
- **FR-003**: System MUST persist all messages in SQLite (better-sqlite3) at `~/.adjutant/adjutant.db`
- **FR-004**: System MUST broadcast messages to connected frontends via existing WebSocket infrastructure
- **FR-005**: System MUST provide MCP tools for: send_message, read_messages, list_threads, mark_read
- **FR-006**: System MUST provide MCP tools for: set_status, report_progress, announce
- **FR-007**: System MUST provide MCP tools for: create_bead, update_bead, close_bead, list_beads, show_bead
- **FR-008**: System MUST provide MCP tools for: list_agents, get_project_state, search_messages
- **FR-009**: System MUST send APNS push notifications for agent messages when no frontend is connected
- **FR-010**: System MUST include Claude Code skills that auto-configure MCP connection
- **FR-011**: System MUST support message threading with conversation grouping
- **FR-012**: System MUST maintain message delivery status (pending, delivered, read, failed)

### Key Entities

- **Message**: Persistent chat message with sender, recipient, thread, body, metadata, delivery status
- **Thread**: Conversation grouping linked by thread ID
- **AgentConnection**: MCP connection state for a connected agent (identity, capabilities, session)
- **Announcement**: Structured broadcast from an agent (completion, blocker, question)

## Success Criteria

- **SC-001**: Agent messages appear on dashboard within 2 seconds of MCP tool call
- **SC-002**: Messages persist across backend restarts (SQLite durability)
- **SC-003**: Zero SIGSEGV crashes from agent bead operations (MCP replaces `bd` CLI for agents)
- **SC-004**: New agents auto-connect to MCP within 5 seconds of session start
- **SC-005**: Full message history queryable with pagination and full-text search
