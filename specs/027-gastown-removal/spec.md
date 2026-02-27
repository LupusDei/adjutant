# Spec 027: Remove Gas Town from Adjutant

**Epic**: `adj-027`
**Beads Import**: `specs/027-gastown-removal/beads-import.md`

## Summary

Adjutant has outgrown Gas Town. The multi-agent orchestration system that Adjutant was
originally built as a dashboard for is no longer the primary deployment context. Adjutant
now operates as a standalone multi-agent dashboard backed by beads and MCP, with no
dependency on the `gt` CLI, `mayor/town.json`, or the Gas Town rig/role hierarchy.

**Goal**: Remove ALL Gas Town-specific code, types, UI, configurations, and references
from the working system. Swarm mode becomes the sole operating mode — there are no more
"modes" at all. Adjutant is simply Adjutant.

**Non-Goal**: We are NOT removing historical specs or archived documentation. Files in
`specs/` and `docs/ARCHIVED/` are preserved for reference.

---

## Decisions (Resolved)

| # | Question | Decision |
|---|----------|----------|
| 1 | Config directory | `~/adjutant/` (not `~/.adjutant/`, not project-local) |
| 2 | Legacy gt-backed mail | Ignore — old mail data stays in `.beads/` but UI won't show it |
| 3 | Convoy model | Remove entirely — Gastown-only concept |
| 4 | Polecat/agent spawning | Remove all polecat mentions. Preserve swarm agent spawn functionality. |
| 5 | `ADJUTANT_MODE` env var | Remove safely. No more modes — swarm behavior is the only behavior. |
| 6 | Mail tab (iOS & frontend) | Remove ALL mail references, pages, and functions entirely |
| 7 | Agent types | Just `user` and `agent` for now. Future feature for more types. |

---

## Current State

### What Exists

The codebase has a well-architected **provider abstraction layer** (built during the
decoupling effort). There are parallel implementations:

| Layer | Gastown Provider (REMOVE) | Swarm Provider (KEEP) |
|-------|---------------------------|----------------------|
| Workspace | `workspace/gastown-provider.ts` | `workspace/swarm-provider.ts` |
| Topology | `topology/gastown-topology.ts` | `topology/swarm-topology.ts` |
| Status | `status/gastown-status-provider.ts` | `status/swarm-status-provider.ts` |
| Transport | `transport/gastown-transport.ts` | `transport/beads-transport.ts` |

The mode-switching system (`mode-service.ts`) supports `"gastown"` and `"swarm"` modes.
After removal, there is only one mode and the mode-switching infrastructure is removed.

### What Must Go

1. **Backend Gastown providers**: 5 files (~1500 LOC)
2. **Backend Gastown services**: `gt-executor.ts`, `gt-control.ts`, `gastown-workspace.ts`, `gastown-utils.ts`, `power-service.ts`
3. **Backend mode infrastructure**: `mode-service.ts`, `mode` route, mode detection — all removed
4. **Backend types**: `GastownStatus`, `RigStatus`, Gas Town `AgentType` values (mayor, deacon, witness, refinery, crew, polecat), `PowerState`
5. **Backend routes**: `/api/power/*`, `/api/mode`, `/api/mail` — all removed
6. **Frontend mode system**: `ModeContext.tsx`, `useDeploymentMode.ts`, `useGastownStatus.ts`
7. **Frontend Gastown UI**: `PowerButton.tsx`, `NuclearPowerButton.tsx`, rig filtering, mail tab & all mail UI, polecat UI
8. **iOS Gastown models**: `GastownStatus.swift` (simplify to SystemStatus), power control views, mode detection, rig filtering, convoy model, mail views
9. **iOS API endpoints**: power up/down, gt-backed mail, polecat spawning
10. **Configuration/Rules**: CLAUDE.md, `.claude/rules/*`, package.json descriptions, README.md
11. **CLI**: `.gastown` path references, gt binary checks
12. **Environment variables**: `GT_TOWN_ROOT`, `GT_BIN`, `GT_PATH`, `GT_RIG_PATHS`, `GT_EXTRA_RIGS`, `GT_MAIL_IDENTITY`, `ADJUTANT_MODE`

---

## Target Architecture

After removal, Adjutant's architecture simplifies to:

```
Agent → MCP SSE Transport → MCP Tool Handler → Message Store (SQLite)
                                                      ↓
Frontend  ←  WebSocket broadcast  ←  wsBroadcast  ←  chat_message event

Beads ← bd CLI → .beads/ database (local)
```

### What Stays

- **Beads (`bd` CLI)**: Universal task tracking — unchanged
- **MCP messaging**: Agent communication via SSE transport — unchanged
- **SQLite message store**: Persistent chat — unchanged
- **WebSocket real-time**: Chat and status broadcasting — unchanged
- **Tmux session detection**: Agent running/stopped detection — unchanged (optional)
- **Push notifications (APNS)**: iOS notifications — unchanged
- **The retro Pip-Boy UI theme**: Unchanged
- **Epics/kanban/beads views**: Unchanged (remove rig filtering)
- **Swarm agent spawn**: Preserved as-is

### What Changes

| Before | After |
|--------|-------|
| Two deployment modes (gastown/swarm) | No modes — single Adjutant behavior |
| Provider factories with mode switching | Direct service implementations |
| `GastownStatus` with rigs/infrastructure | `SystemStatus` with flat agents list |
| `AgentType` = mayor\|deacon\|...\|user\|agent | `AgentType` = user\|agent |
| Power controls (gt up/gt down) | No power controls (always running) |
| Rig-based filtering everywhere | No rig filtering |
| gt-backed mail + MCP messaging | MCP-only messaging |
| Mode switching UI in settings | No mode switching |
| `~/gt` as workspace root | CWD or `ADJUTANT_PROJECT_ROOT` |
| `~/.gastown/` config directory | `~/adjutant/` |
| Mail tab in frontend & iOS | No mail tab — Chat only |

---

## Phases & Beads

### Phase 1: Backend (`adj-027.1`) — 8 tasks

Remove Gastown providers, collapse to single mode, remove gt CLI dependency.

| Bead | Title | Depends On |
|------|-------|------------|
| `adj-027.1.1` | Delete Gastown provider files and gt CLI wrappers | — |
| `adj-027.1.2` | Simplify provider index files — remove mode detection | .1.1 |
| `adj-027.1.3` | Remove mode-service, mode route, and ADJUTANT_MODE | — |
| `adj-027.1.4` | Remove power routes, power service, and all mail routes | — |
| `adj-027.1.5` | Clean up backend types — remove Gastown types | .1.1, .1.3, .1.4 |
| `adj-027.1.6` | Simplify agent-data and agents-service | .1.1 |
| `adj-027.1.7` | Update config paths from ~/.gastown to ~/adjutant | — |
| `adj-027.1.8` | Update backend tests for Gastown removal | all above |

**Parallel starts**: .1.1, .1.3, .1.4, .1.7 can begin simultaneously.

### Phase 2: Frontend (`adj-027.2`) — 7 tasks

Remove Gastown UI, mode system, mail, power controls, rig filtering.

| Bead | Title | Depends On |
|------|-------|------------|
| `adj-027.2.1` | Delete Gastown-only frontend components and hooks | — |
| `adj-027.2.2` | Remove ModeContext and all mode detection | — |
| `adj-027.2.3` | Clean up frontend types | — |
| `adj-027.2.4` | Clean up frontend API service | — |
| `adj-027.2.5` | Simplify CrewStats component | .2.1–.2.4 |
| `adj-027.2.6` | Clean up dashboard, navigation, and remaining components | .2.1–.2.4 |
| `adj-027.2.7` | Update frontend tests for Gastown removal | all above |

**Parallel starts**: .2.1, .2.2, .2.3, .2.4 can begin simultaneously.

### Phase 3: iOS (`adj-027.3`) — 5 tasks

Remove Gastown models, views, API endpoints, mail, convoys from iOS app.

| Bead | Title | Depends On |
|------|-------|------------|
| `adj-027.3.1` | Simplify iOS data models | — |
| `adj-027.3.2` | Remove iOS Gastown UI components | .3.1 |
| `adj-027.3.3` | Update iOS API endpoints | .3.1 |
| `adj-027.3.4` | Update iOS AppState and ViewModels | .3.1 |
| `adj-027.3.5` | Update iOS tests for Gastown removal | .3.2–.3.4 |

**Parallel starts**: .3.2, .3.3, .3.4 can begin after .3.1 completes.

### Phase 4: Config & Docs (`adj-027.4`) — 4 tasks

Update all config, rules, documentation. Can run in parallel with Phases 1–3.

| Bead | Title |
|------|-------|
| `adj-027.4.1` | Rewrite CLAUDE.md for standalone Adjutant |
| `adj-027.4.2` | Update .claude/rules/ for Gastown removal |
| `adj-027.4.3` | Update README and package.json |
| `adj-027.4.4` | Update CLI, skills, and agent setup docs |

**All tasks can run in parallel.**

### Phase 5: Cleanup & Verification (`adj-027.5`) — 1 task

Runs after ALL other phases complete.

| Bead | Title | Depends On |
|------|-------|------------|
| `adj-027.5.1` | Final Gastown reference sweep and verification | adj-027.1–.4 |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking swarm functionality | HIGH | Swarm providers are the ones we keep. Run full test suite per phase. |
| iOS app crash on missing API endpoints | HIGH | Update iOS API client in sync with backend changes. Handle 404s gracefully. |
| Losing historical beads data | LOW | We don't touch `.beads/` databases. Old mail data stays but becomes inaccessible. |
| Config file migration breaks | MEDIUM | Support both `~/.gastown/` and `~/adjutant/` with deprecation warning. |
| Test coverage gaps | MEDIUM | Update tests systematically per phase. Each phase has a dedicated test task. |

---

## Success Criteria

1. `grep -ri "gastown" --include="*.ts" --include="*.tsx" --include="*.swift"` returns ZERO matches outside of `specs/`, `docs/ARCHIVED/`, and `docs/` historical files
2. `npm run build` succeeds with zero errors
3. `npm test` passes all tests
4. iOS project builds successfully
5. `ADJUTANT_MODE` env var is not used anywhere
6. No `gt` binary is needed at runtime
7. No `mayor/town.json` is needed at startup
8. No mail routes, mail UI, or mail hooks exist
9. MCP agent messaging works end-to-end
10. Beads CRUD operations work end-to-end
11. WebSocket real-time chat works
12. Swarm agent spawn functionality works
