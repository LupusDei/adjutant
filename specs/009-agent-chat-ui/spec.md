# Feature Specification: Agent Chat UI

**Feature Branch**: `009-agent-chat-ui`
**Created**: 2026-02-21
**Status**: Draft
**Depends On**: adj-010 (Agent MCP Bridge — backend message store, /api/messages, WebSocket chat_message events)

## Overview

Evolve the existing CommandChat (web) and ChatView (iOS) into persistent, agent-scoped chat views. Messages come from the SQLite message store created by adj-010, not the legacy mail system. Each agent gets its own iMessage-style conversation — a single chronological stream of all messages to/from that agent. Messages persist across session restarts and are immediately visible on both web and iOS via WebSocket events.

## Problem Statement

Today, chat is broken in two ways:

1. **Web CommandChat** fetches messages from `/api/mail` (beads-based). Messages are scoped by recipient but rely on the fragile beads transport. No SQLite persistence, no real-time delivery from MCP agents, no message history after session death.

2. **iOS ChatView** mirrors the same problems — fetches from `/api/mail`, uses polling fallback, and loses all context when agent sessions restart. The `ResponseCache` provides some persistence but it's a client-side cache, not server-backed history.

Both platforms need to switch their data source from legacy mail endpoints to the new MCP-backed `/api/messages` API, while keeping the existing UX patterns (optimistic UI, typing indicators, streaming responses, voice) intact.

## User Scenarios & Testing

### User Story 1 - Per-Agent Chat on Web (Priority: P1)

The web CommandChat shows persistent messages scoped to a selected agent. Selecting an agent shows all messages to/from that agent from the SQLite store. New messages from MCP-connected agents appear in real-time via WebSocket `chat_message` events.

**Why this priority**: The web dashboard is the primary interface. Agent messages must appear here first.

**Independent Test**: Select agent "researcher" in the chat view. Send a message. Have the agent reply via MCP `send_message`. Verify the reply appears within 2 seconds without polling. Restart the backend. Verify all messages are still visible.

**Acceptance Scenarios**:

1. **Given** the chat view with agent "researcher" selected, **When** the user sends a message, **Then** the message is stored in SQLite via POST /api/messages and appears optimistically in the chat.
2. **Given** agent "researcher" connected via MCP, **When** the agent calls `send_message`, **Then** the message appears in the web chat within 2 seconds via WebSocket `chat_message` event.
3. **Given** the backend restarts, **When** the user reopens the chat view, **Then** all previous messages with "researcher" are loaded from SQLite via GET /api/messages.
4. **Given** multiple agents active, **When** the user switches between agents in the selector, **Then** each agent shows only its own conversation history.

---

### User Story 2 - Per-Agent Chat on iOS (Priority: P1)

The iOS ChatView shows the same persistent, agent-scoped messages. Agent selection switches the conversation. Real-time delivery via WebSocket, with polling fallback. APNS push notifications for messages when the app is backgrounded.

**Why this priority**: iOS is the mobile command center. Parity with web is essential.

**Independent Test**: Open the iOS app, select agent "coder". Verify message history loads from /api/messages. Send a message, verify it appears. Have the agent reply via MCP, verify it appears within 2 seconds. Background the app, have the agent send another message, verify APNS push arrives.

**Acceptance Scenarios**:

1. **Given** the iOS chat with agent "coder" selected, **When** the view appears, **Then** messages are fetched from GET /api/messages?agent=coder and displayed chronologically.
2. **Given** the iOS app is backgrounded, **When** an agent sends a message via MCP, **Then** the user receives an APNS push notification with the message preview.
3. **Given** the user opens a push notification, **When** the app activates, **Then** it navigates to the chat view with the sending agent selected and the new message visible.
4. **Given** poor network conditions, **When** WebSocket disconnects, **Then** the app falls back to polling /api/messages every 30 seconds.

---

### User Story 3 - Agent Selector Upgrade (Priority: P2)

The agent selector (both platforms) shows unread message counts per agent and highlights agents with new messages. Selecting an agent marks its messages as read.

**Why this priority**: Enhances usability but not required for basic functionality.

**Independent Test**: Have 3 agents send messages. Verify unread badges appear next to each agent name. Select one agent, verify its badge clears. Verify other badges remain.

**Acceptance Scenarios**:

1. **Given** unread messages from 3 agents, **When** the agent selector is visible, **Then** each agent shows an unread count badge.
2. **Given** the user selects agent "researcher", **When** the conversation loads, **Then** all messages from "researcher" are marked as read via PATCH /api/messages/:id/read, and the badge clears.
3. **Given** a new message arrives from "coder" while viewing "researcher", **When** the user sees the agent selector, **Then** "coder" shows an updated unread badge.

---

### User Story 4 - Message History & Search (Priority: P3)

Users can scroll back through message history with pagination and search across all agent conversations using full-text search.

**Why this priority**: Nice-to-have for power users. Not needed for MVP.

**Independent Test**: Send 100+ messages across multiple agents. Verify infinite scroll loads older messages. Search for a keyword, verify results span multiple agents.

**Acceptance Scenarios**:

1. **Given** 100+ messages with agent "researcher", **When** the user scrolls to the top, **Then** older messages load via GET /api/messages?before=<cursor>&limit=50.
2. **Given** a search query "deployment", **When** the user searches, **Then** results from all agents are returned via GET /api/messages/search?q=deployment, grouped by agent.

---

### Edge Cases

- What happens when an agent has no message history? (Show empty state with "No messages yet" prompt)
- What happens when the same message arrives via both WebSocket and polling? (Deduplicate by message ID)
- What happens when the user sends a message to an offline agent? (Store in SQLite, show as "pending" delivery status, deliver when agent reconnects)
- How are announcement-type messages displayed? (Inline in chat as system messages with distinct styling)

## Requirements

### Functional Requirements

- **FR-001**: Web CommandChat MUST fetch messages from GET /api/messages (not /api/mail)
- **FR-002**: iOS ChatView MUST fetch messages from GET /api/messages (not /api/mail)
- **FR-003**: Both platforms MUST scope messages by selected agent (to/from filter)
- **FR-004**: Both platforms MUST display new messages in real-time via WebSocket `chat_message` events
- **FR-005**: Both platforms MUST support optimistic message sending with delivery confirmation
- **FR-006**: Both platforms MUST preserve existing UX: typing indicators, streaming responses, voice
- **FR-007**: Web MUST display unread counts per agent in the agent selector
- **FR-008**: iOS MUST display unread counts per agent in the agent selector
- **FR-009**: iOS MUST receive APNS push notifications for agent messages when backgrounded
- **FR-010**: Both platforms MUST support paginated message loading (infinite scroll)
- **FR-011**: Both platforms MUST deduplicate messages received via multiple channels

### Key Entities

- **PersistentMessage**: Message from SQLite store (id, sessionId, agentId, role, body, metadata, deliveryStatus, createdAt)
- **AgentConversation**: Scoped view of messages filtered by agent identity (to/from)
- **UnreadCount**: Per-agent count of unread messages (agentId, count)

## Success Criteria

- **SC-001**: Agent messages appear on both web and iOS within 2 seconds of MCP send_message call
- **SC-002**: Full message history survives backend restart on both platforms
- **SC-003**: Switching agents loads the correct scoped conversation within 500ms
- **SC-004**: Zero duplicate messages displayed despite WebSocket + polling overlap
- **SC-005**: Existing voice, typing indicators, and streaming continue to work unchanged
