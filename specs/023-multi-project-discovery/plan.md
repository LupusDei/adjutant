# Implementation Plan: Multi-Project Discovery & Agent Spawning

**Branch**: `023-multi-project-discovery` | **Date**: 2026-02-25
**Epic**: `adj-023` | **Priority**: P1

## Summary

Close the gaps so Adjutant can serve as a multi-project command center. The backend already has project registry, bd-client with arbitrary cwd support, and agent spawning with projectPath. We need to: (1) thread project context through MCP sessions so agent bead tools are project-scoped, (2) enhance discovery to detect .beads/ repos, (3) add frontend project navigation, and (4) wire agent spawning to carry project context end-to-end.

## Bead Map

- `adj-023` - Root: Multi-Project Discovery & Agent Spawning
  - `adj-023.1` - Foundational: Types, project context threading
    - `adj-023.1.1` - Add ProjectContext type and hasBeads to Project
    - `adj-023.1.2` - Thread project context through MCP session map
    - `adj-023.1.3` - Add project context resolver for MCP tool handlers
  - `adj-023.2` - US1: MCP Project-Scoped Beads (MVP)
    - `adj-023.2.1` - Update MCP bead tools to use project-scoped beadsDir
    - `adj-023.2.2` - Update MCP status/messaging tools with project metadata
    - `adj-023.2.3` - Add integration tests for multi-project MCP isolation
  - `adj-023.3` - US2: Enhanced Project Discovery
    - `adj-023.3.1` - Enhance discoverLocalProjects to detect .beads/ and depth
    - `adj-023.3.2` - Add project health check (stale paths, missing beads)
    - `adj-023.3.3` - Add re-discovery endpoint to update existing projects
  - `adj-023.4` - US3: Frontend Project Navigation
    - `adj-023.4.1` - Create ProjectContext and useProjects hook
    - `adj-023.4.2` - Create ProjectSelector component
    - `adj-023.4.3` - Wire BeadsView and EpicsView to project filter
    - `adj-023.4.4` - Add project overview panel with bead stats
  - `adj-023.5` - US4: Cross-Project Agent Spawning
    - `adj-023.5.1` - Update spawn-polecat to accept projectId and set MCP context
    - `adj-023.5.2` - Update SendToAgentModal to use project selector
    - `adj-023.5.3` - End-to-end test: spawn, connect, create bead in target project

## Technical Context

**Stack**: TypeScript 5.x (strict), React 18+, Express, Tailwind CSS, Zod
**Storage**: SQLite (messages), .beads/beads.db per project (via bd CLI)
**Testing**: Vitest
**Constraints**: Backward compatible with GasTown mode, no new runtime deps

## Architecture Decision

**Approach: Project context in MCP session metadata**

Rather than making workspace provider per-project (heavy refactor), we thread a `ProjectContext` object through the existing MCP session map. When an agent connects, we look up their session in SessionBridge to get projectPath, resolve the beadsDir, and inject it into tool handler calls. This is minimally invasive — the existing bd-client already supports `cwd` and `beadsDir` options.

**Alternative rejected**: Per-project workspace provider instances. Too invasive — would require refactoring every service that calls `getWorkspace()`. The session-context approach achieves the same result with surgical changes to MCP tool handlers only.

**Alternative rejected**: Agent-supplied project context via MCP tool parameters. Violates the server-side identity resolution principle (agents shouldn't self-declare context). Project context must come from the spawn metadata, not the agent.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/types/index.ts` | Add ProjectContext type, hasBeads to relevant types |
| `backend/src/services/mcp-server.ts` | Store projectId/projectPath in session map |
| `backend/src/services/mcp-tools/beads.ts` | Resolve beadsDir from session project context |
| `backend/src/services/mcp-tools/status.ts` | Add project metadata to status/announcements |
| `backend/src/services/projects-service.ts` | Add hasBeads detection, depth scanning, health checks |
| `backend/src/routes/projects.ts` | Add re-discover and health-check endpoints |
| `backend/src/routes/agents.ts` | Thread projectId through spawn flow |
| `backend/src/services/session-bridge.ts` | Carry projectId in SessionInfo |
| `frontend/src/contexts/ProjectContext.tsx` | New: project selection state |
| `frontend/src/hooks/useProjects.ts` | New: fetch and manage project list |
| `frontend/src/components/shared/ProjectSelector.tsx` | New: project switcher component |
| `frontend/src/components/beads/BeadsView.tsx` | Accept project filter, pass to API |
| `frontend/src/components/epics/EpicsView.tsx` | Accept project filter, pass to API |
| `frontend/src/components/proposals/SendToAgentModal.tsx` | Use ProjectContext for spawn target |
| `frontend/src/services/api.ts` | Add project-scoped bead/epic API calls |

## Phase 1: Foundational

**Purpose**: Establish shared types and thread project context through the MCP session lifecycle.

This is the prerequisite for all user stories. We add the ProjectContext type, extend the MCP session map to carry project metadata, and create a resolver function that MCP tool handlers can call to get the agent's project-scoped beadsDir.

Key decisions:
- ProjectContext lives in backend types, not a separate module
- MCP session map extended (not replaced) — `sessionToAgent` gains optional projectId/projectPath fields
- Resolver function `getProjectContextForSession(sessionId)` returns `{ projectId, projectPath, beadsDir } | null`
- Null means legacy/unscoped agent — fall back to workspace singleton (backward compat)

## Phase 2: US1 - MCP Project-Scoped Beads (MVP)

**Purpose**: Make agent bead operations project-aware. This is the MVP — once MCP tools respect project context, agents can work across projects.

Each bead tool handler calls the project context resolver before executing bd commands. If context exists, passes `cwd` and `beadsDir` to `execBd()`. If not, falls back to current behavior.

Integration tests spin up two mock MCP sessions with different project contexts and verify bead isolation.

## Phase 3: US2 - Enhanced Project Discovery

**Purpose**: Make discovery smarter — detect .beads/, support depth scanning, handle stale projects.

Extends `discoverLocalProjects()` with:
- `.beads/beads.db` detection alongside `.git/`
- Configurable scan depth (default 1, max 3)
- Project health status (path exists, git valid, beads present)
- Re-scan endpoint that updates existing projects without duplicating

## Phase 4: US3 - Frontend Project Navigation

**Purpose**: Give users a visual project switcher and project-scoped views.

New ProjectContext wraps the app (like RigContext). ProjectSelector component in the header/sidebar. BeadsView and EpicsView read active project from context and pass projectId to API calls. Project overview panel shows bead stats for selected project.

## Phase 5: US4 - Cross-Project Agent Spawning

**Purpose**: Complete the loop — spawn agents from UI with project targeting.

Update spawn-polecat to accept projectId (not just projectPath), look up the project, and pass context through to the MCP session. Update SendToAgentModal to use ProjectContext for target selection. End-to-end test covers the full flow.

## Parallel Execution

- After Phase 1 (Foundational), Phases 2-3 can run in parallel (backend, independent concerns)
- Phase 4 (Frontend) can start after Phase 1 types are defined, but needs Phase 2 for bead scoping
- Phase 5 depends on Phases 2 + 4

## Verification Steps

- [ ] Spawn agent for project A, call list_beads — sees only A's beads
- [ ] Spawn agent for project B, call create_bead — bead appears in B's .beads/
- [ ] Legacy agent (no project) — falls back to workspace singleton, no regression
- [ ] Discover 5+ projects — all registered with correct hasBeads status
- [ ] Frontend project selector — switch projects, beads view updates
- [ ] Spawn from UI targeting project X — agent's MCP session scoped to X
- [ ] GasTown mode — existing rig-based workflow unaffected
