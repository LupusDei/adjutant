# Feature Specification: MCP Streamable HTTP Migration

**Feature Branch**: `012-mcp-streamable-http`
**Created**: 2026-02-22
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Agent Connects via Streamable HTTP (Priority: P1)

An MCP agent (Claude Code or similar) connects to the Adjutant backend using the Streamable HTTP transport. The agent sends an initialization POST to `/mcp`, receives a session ID in the `Mcp-Session-Id` response header, and uses that session ID for all subsequent tool calls. The server tracks the agent's identity (from `X-Agent-Id` header or query param) and associates it with the protocol-level session.

**Why this priority**: Core functionality — agents can't communicate without a working transport.

**Independent Test**: Start the backend, send an MCP initialization POST to `/mcp`, verify 200 response with `Mcp-Session-Id` header. Then call a tool (e.g., `set_status`) and verify it resolves the agent's identity correctly.

**Acceptance Scenarios**:

1. **Given** the server is running, **When** an agent sends a POST with an `initialize` JSON-RPC request to `/mcp`, **Then** a new session is created and the response includes an `Mcp-Session-Id` header.
2. **Given** an active session, **When** the agent sends a tool call POST with the `Mcp-Session-Id` header, **Then** the server routes it to the correct transport and resolves the agent's identity.
3. **Given** an active session, **When** the agent sends a GET to `/mcp` with the `Mcp-Session-Id` header, **Then** an SSE stream is opened for server-initiated messages.
4. **Given** an active session, **When** the agent sends a DELETE to `/mcp` with the `Mcp-Session-Id` header, **Then** the session is terminated and cleaned up.
5. **Given** multiple agents connected, **When** each calls tools, **Then** each agent's identity is correctly resolved from its own session.

---

### User Story 2 - Transparent Config Migration (Priority: P1)

Claude Code agents pick up the updated `.mcp.json` config and connect using the new transport without manual intervention. The config specifies `"type": "http"` and the URL points to `/mcp` instead of `/mcp/sse`.

**Why this priority**: Without updated config, no agent can connect.

**Independent Test**: Update `.mcp.json`, start a Claude Code agent, verify it connects to `/mcp` via Streamable HTTP and can call tools.

**Acceptance Scenarios**:

1. **Given** the updated `.mcp.json`, **When** Claude Code starts an MCP connection, **Then** it uses Streamable HTTP transport (POST to `/mcp`).
2. **Given** an agent using the old SSE config (`/mcp/sse`), **When** it tries to connect, **Then** it gets a 404 (clean break, no legacy support).

---

### Edge Cases

- What happens when a POST arrives with no `Mcp-Session-Id` and it's NOT an initialization request? → 400 Bad Request
- What happens when a POST arrives with an invalid/expired `Mcp-Session-Id`? → 404 Not Found
- What happens when the server restarts and agents try to resume old sessions? → 404; agents must reconnect
- What happens when two agents use the same `X-Agent-Id`? → Each gets a separate session; identity resolution still works per-session

## Requirements

### Functional Requirements

- **FR-001**: Server MUST accept Streamable HTTP transport connections on `POST /mcp`
- **FR-002**: Server MUST generate unique session IDs and return them via `Mcp-Session-Id` header
- **FR-003**: Server MUST support GET `/mcp` for server-initiated SSE streams per session
- **FR-004**: Server MUST support DELETE `/mcp` for explicit session termination
- **FR-005**: Server MUST resolve agent identity from `X-Agent-Id` header or `agentId` query param on the initialization request
- **FR-006**: Server MUST emit `mcp:agent_connected` and `mcp:agent_disconnected` events on the EventBus
- **FR-007**: All existing MCP tools (messaging, status, beads, queries) MUST work unchanged
- **FR-008**: The `/mcp` path prefix MUST remain in the API key middleware's PUBLIC_PREFIXES
- **FR-009**: The old SSE endpoints (`GET /mcp/sse`, `POST /mcp/messages`) MUST be removed

### Non-Requirements

- No OAuth support (agents are local, auth is via API key middleware exclusion)
- No EventStore resumability (agents handle reconnection themselves)
- No changes to WebSocket `/ws/chat` or terminal streaming (independent transports)
- No backwards compatibility with SSE transport

## Success Criteria

- **SC-001**: All existing MCP tool tests pass without modification to tool handler logic
- **SC-002**: A Claude Code agent can connect, call tools, and disconnect using the new transport
- **SC-003**: The server correctly tracks 3+ simultaneous agent sessions with independent identity
- **SC-004**: Zero changes to `backend/src/services/mcp-tools/*.ts` handler implementations
