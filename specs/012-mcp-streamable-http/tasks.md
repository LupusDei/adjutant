# Tasks: MCP Streamable HTTP Migration

**Input**: Design documents from `/specs/012-mcp-streamable-http/`
**Epic**: `adj-014`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-014.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Core Transport

**Purpose**: Replace SSEServerTransport with StreamableHTTPServerTransport in the service layer

- [ ] T001 [US1] Write failing tests for StreamableHTTPServerTransport lifecycle (session creation, identity mapping, disconnect cleanup, EventBus events) in `backend/tests/unit/mcp-server.test.ts`
- [ ] T002 [US1] Refactor `mcp-server.ts` — replace SSEServerTransport import with StreamableHTTPServerTransport; replace `connectAgent(agentId, res)` with `createSessionTransport(agentId)` that returns a configured transport; use `onsessioninitialized`/`onsessionclosed` callbacks for connection tracking; preserve `getAgentBySession()`, `getConnectedAgents()`, `resolveAgentId()` APIs in `backend/src/services/mcp-server.ts`
- [ ] T003 [US1] Wire agent identity resolution — extract agentId from request headers/query in the route layer, pass to `createSessionTransport()`, store in connections map keyed by the protocol-generated sessionId in `backend/src/services/mcp-server.ts`

**Checkpoint**: Transport service layer compiles and tests pass

---

## Phase 2: Route Consolidation

**Purpose**: Replace two-endpoint SSE model with unified /mcp handlers

- [ ] T004 [US1] Write failing tests for unified POST/GET/DELETE route handlers (initialize new session, route to existing session, reject invalid session, handle DELETE cleanup) in `backend/tests/unit/mcp-routes.test.ts`
- [ ] T005 [US1] Rewrite `mcp.ts` — replace `GET /sse` and `POST /messages` with `POST /` (initialize or route by Mcp-Session-Id), `GET /` (SSE stream by Mcp-Session-Id), `DELETE /` (session termination); pass `req.body` as parsedBody to `transport.handleRequest()` in `backend/src/routes/mcp.ts`
- [ ] T006 [US1] Update `index.ts` — verify route mounting (`app.use("/mcp", mcpRouter)` still works with the new router); remove any dead imports (getMcpServer if no longer used at top level) in `backend/src/index.ts`

**Checkpoint**: Routes compile, route tests pass, `npm run --prefix backend test` all green

---

## Phase 3: Config & Cleanup

**Purpose**: Update client config, clean up middleware, remove dead code, verify end-to-end

- [ ] T007 [P] [US2] Update `.mcp.json` — change `"type": "sse"` to `"type": "http"`, change URL from `http://localhost:4201/mcp/sse` to `http://localhost:4201/mcp` in `.mcp.json`
- [ ] T008 [P] [US1] Clean up api-key middleware — remove `"/.well-known"` from PUBLIC_PREFIXES (no longer needed without SSE+OAuth discovery); keep `"/mcp"` in `backend/src/middleware/api-key.ts`
- [ ] T009 [US1] Remove dead code — delete any remaining SSEServerTransport imports, unused type references, stale comments about SSE transport across `backend/src/`
- [ ] T010 [US1] Integration smoke test — start server, send initialize POST via curl, verify session ID header, call a tool, send DELETE, verify cleanup. Document the curl commands as a verification script or test.

---

## Dependencies

- Phase 1 (T001-T003) is sequential: tests → implementation → identity wiring
- Phase 2 (T004-T006) blocks on Phase 1 completion
- Phase 3: T007 and T008 can run in parallel after Phase 2; T009 depends on T007+T008; T010 is last

## Parallel Opportunities

- T007 and T008 are independent (different files, no shared state) — can run in parallel
- Within phases 1 and 2, tasks are sequential (TDD: test → implement → refine)
