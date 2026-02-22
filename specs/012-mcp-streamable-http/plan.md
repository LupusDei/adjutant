# Implementation Plan: MCP Streamable HTTP Migration

**Branch**: `012-mcp-streamable-http` | **Date**: 2026-02-22
**Epic**: `adj-014` | **Priority**: P1

## Summary

Replace the deprecated `SSEServerTransport` with `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk@1.26.0`. Consolidate the two-endpoint SSE model (`GET /mcp/sse` + `POST /mcp/messages`) into a single `/mcp` endpoint handling POST (tool calls + initialization), GET (server-initiated SSE), and DELETE (session termination). The per-session McpServer architecture is preserved — each agent session gets its own transport and server instance, matching the SDK's recommended pattern.

## Bead Map

- `adj-014` - Root: MCP Streamable HTTP Migration
  - `adj-014.1` - Core Transport: Replace SSEServerTransport with StreamableHTTPServerTransport
    - `adj-014.1.1` - Write tests for new transport lifecycle
    - `adj-014.1.2` - Refactor mcp-server.ts to use StreamableHTTPServerTransport
    - `adj-014.1.3` - Wire agent identity resolution into session callbacks
  - `adj-014.2` - Route Consolidation: Unified /mcp endpoint
    - `adj-014.2.1` - Write tests for unified route handlers
    - `adj-014.2.2` - Rewrite mcp.ts routes for POST/GET/DELETE on /mcp
    - `adj-014.2.3` - Update index.ts initialization and route mounting
  - `adj-014.3` - Config & Cleanup
    - `adj-014.3.1` - Update .mcp.json for http transport
    - `adj-014.3.2` - Clean up api-key middleware
    - `adj-014.3.3` - Remove SSE imports and dead code
    - `adj-014.3.4` - Integration smoke test

## Technical Context

**Stack**: Node.js, Express, TypeScript, `@modelcontextprotocol/sdk@1.26.0`
**Storage**: N/A (in-memory session tracking; SQLite message store unchanged)
**Testing**: Vitest with mocked SDK classes
**Constraints**: Zero changes to MCP tool handler implementations

## Architecture Decision

**Per-session transport + server** (keep current model, adapted):

The SDK example (`simpleStreamableHttp.js`) confirms that per-session is the recommended pattern: each initialization creates a new `StreamableHTTPServerTransport` + `McpServer` pair. The transport is stored in a map keyed by session ID. Subsequent requests look up the transport by `Mcp-Session-Id` header.

This maps directly to the current adjutant architecture where each `connectAgent()` call creates a new McpServer with tools. The key changes are:
1. Transport creation moves from `connectAgent()` to the POST route handler (on initialization)
2. Session lifecycle is managed by the transport's `onsessioninitialized` / `onsessionclosed` callbacks
3. Agent identity is resolved once at initialization and stored alongside the session

**Why not singleton**: The MCP SDK's `Protocol` class binds to a single transport. A singleton McpServer cannot serve multiple concurrent sessions. The per-session model gives clean isolation.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/mcp-server.ts` | Replace SSEServerTransport with StreamableHTTPServerTransport; refactor connectAgent to createSessionTransport; use onsessioninitialized/onsessionclosed callbacks |
| `backend/src/routes/mcp.ts` | Replace GET /sse + POST /messages with POST/GET/DELETE on root; handle initialization vs existing session routing |
| `backend/src/index.ts` | Update route mounting from `app.use("/mcp", mcpRouter)` — may need `app.all("/mcp", ...)` or explicit method handlers |
| `.mcp.json` | Change `type: "sse"` → `type: "http"`, URL from `/mcp/sse` → `/mcp` |
| `backend/src/middleware/api-key.ts` | Keep `/mcp` in PUBLIC_PREFIXES; remove `/.well-known` if no longer needed |
| `backend/tests/unit/mcp-server.test.ts` | Rewrite mocks for StreamableHTTPServerTransport; test session lifecycle callbacks |
| `backend/tests/unit/mcp-routes.test.ts` | Rewrite for POST/GET/DELETE handlers; test session routing logic |

## Phase 1: Core Transport (`adj-014.1`)

Replace the transport layer in `mcp-server.ts`:

1. **New transport factory**: Replace `connectAgent(agentId, res)` with `createSessionTransport(agentId)` that returns a `StreamableHTTPServerTransport` configured with:
   - `sessionIdGenerator: () => randomUUID()`
   - `onsessioninitialized`: stores the session in the connections map and emits `mcp:agent_connected`
   - `onsessionclosed`: removes session and emits `mcp:agent_disconnected`
   - `onclose`: cleanup handler

2. **Identity mapping**: Store `agentId → sessionId` during initialization. The `getAgentBySession()` function remains the same — tools use `extra.sessionId` to look up the agent.

3. **Remove SSE-specific code**: Drop `SSEServerTransport` import, remove `ServerResponse` parameter from connection API.

## Phase 2: Route Consolidation (`adj-014.2`)

Rewrite `mcp.ts` to serve a single `/mcp` endpoint:

- **POST /**: Check `mcp-session-id` header. If present, route to existing transport. If absent and body is `initialize`, create new transport + server via `createSessionTransport()`, connect them, then `transport.handleRequest(req, res, req.body)`.
- **GET /**: Validate `mcp-session-id`, route to existing transport's `handleRequest()`.
- **DELETE /**: Validate `mcp-session-id`, route to transport's `handleRequest()` which triggers cleanup.

The router is mounted at `/mcp` in index.ts, so route paths within the router are `/` (root).

**Critical**: Must pass `req.body` as `parsedBody` to `handleRequest()` since Express's `express.json()` middleware has already consumed the request body stream.

## Phase 3: Config & Cleanup (`adj-014.3`)

1. Update `.mcp.json`: `"type": "http"`, `"url": "http://localhost:4201/mcp"`
2. Clean api-key middleware: Keep `/mcp` in PUBLIC_PREFIXES. The `/.well-known` entry can be removed — with Streamable HTTP and no OAuth, agents won't probe that endpoint.
3. Remove dead imports (`SSEServerTransport`), update TypeScript types.
4. Smoke test: start server, connect agent, call tool, disconnect.

## Parallel Execution

- Phase 1 tasks (T001-T003) are sequential (tests → implementation → identity wiring)
- Phase 2 tasks (T004-T006) depend on Phase 1 completion
- Phase 3 tasks (T007-T010) can partially parallelize after Phase 2:
  - T007 (.mcp.json) and T008 (middleware) are independent of each other
  - T009 (dead code removal) depends on T007-T008
  - T010 (smoke test) is last

## Verification Steps

- [ ] `npm run --prefix backend test` — all unit tests pass
- [ ] `npm run --prefix backend build` — no TypeScript errors
- [ ] Start server, `curl -X POST http://localhost:4201/mcp` with initialize body — verify session ID in response
- [ ] Connect a Claude Code agent with updated `.mcp.json` — verify tool calls work
- [ ] Connect 3 agents simultaneously — verify independent sessions
- [ ] Disconnect agent — verify cleanup (no dangling sessions)
