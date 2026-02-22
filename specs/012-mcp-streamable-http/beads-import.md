# MCP Streamable HTTP Migration - Beads

**Feature**: 012-mcp-streamable-http
**Generated**: 2026-02-22
**Source**: specs/012-mcp-streamable-http/tasks.md

## Root Epic

- **ID**: adj-014
- **Title**: MCP Streamable HTTP Migration
- **Type**: epic
- **Priority**: 1
- **Description**: Replace deprecated SSEServerTransport with StreamableHTTPServerTransport. Consolidate GET /mcp/sse + POST /mcp/messages into unified POST/GET/DELETE /mcp endpoint. Update .mcp.json config and clean up middleware.

## Epics

### Phase 1 — Core Transport
- **ID**: adj-014.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — Route Consolidation
- **ID**: adj-014.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 3
- **Tasks**: 3

### Phase 3 — Config & Cleanup
- **ID**: adj-014.3
- **Type**: epic
- **Priority**: 1
- **Depends**: Phase 1, Phase 2
- **Tasks**: 4

## Tasks

### Phase 1 — Core Transport

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Write transport lifecycle tests | backend/tests/unit/mcp-server.test.ts | adj-014.1.1 |
| T002 | Refactor mcp-server.ts for StreamableHTTP | backend/src/services/mcp-server.ts | adj-014.1.2 |
| T003 | Wire agent identity into session callbacks | backend/src/services/mcp-server.ts | adj-014.1.3 |

### Phase 2 — Route Consolidation

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Write unified route handler tests | backend/tests/unit/mcp-routes.test.ts | adj-014.2.1 |
| T005 | Rewrite mcp.ts for POST/GET/DELETE /mcp | backend/src/routes/mcp.ts | adj-014.2.2 |
| T006 | Update index.ts initialization | backend/src/index.ts | adj-014.2.3 |

### Phase 3 — Config & Cleanup

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Update .mcp.json for http transport | .mcp.json | adj-014.3.1 |
| T008 | Clean up api-key middleware | backend/src/middleware/api-key.ts | adj-014.3.2 |
| T009 | Remove dead SSE code | backend/src/ | adj-014.3.3 |
| T010 | Integration smoke test | backend/ | adj-014.3.4 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Core Transport | 3 | 1 | adj-014.1 |
| 2: Route Consolidation | 3 | 1 | adj-014.2 |
| 3: Config & Cleanup | 4 | 1 | adj-014.3 |
| **Total** | **10** | | |

## Dependency Graph

Phase 1: Core Transport (adj-014.1)
    |
Phase 2: Route Consolidation (adj-014.2)
    |
Phase 3: Config & Cleanup (adj-014.3)
    T007 [P] T008 [P]  ← parallel
       |        |
       T009
       |
       T010

## Improvements

Improvements (Level 4: adj-014.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
