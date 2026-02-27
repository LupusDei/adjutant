# Adjutant Rules Audit — Portability Analysis

> **Bead**: adj-tmio | **Date**: 2026-02-27 | **Author**: duke

## Executive Summary

The adjutant project has **7 rule files**, **2 PRIME files**, **1 CLAUDE.md**, and a **plugin system** (`adjutant init`). Several rules are heavily coupled to **Gas Town** concepts (`gt` CLI, rigs, Mayor, convoys, `~/gt/`) that are slated for removal. The PRIME files (`.adjutant/PRIME.md` and `.beads/PRIME.md`) are the most portable pieces and form the core of what "any directory as Adjutant" needs. The `.claude/rules/` are project-specific development rules for the adjutant codebase itself — most should NOT ship as part of the portable Adjutant system.

---

## File Inventory

### PRIME Files (Portable Agent Protocol)

| File | Purpose | Gastown Refs | Portable? |
|------|---------|-------------|-----------|
| `.adjutant/PRIME.md` | MCP communication, status reporting, bead tracking protocol | None | **YES — core portable artifact** |
| `.beads/PRIME.md` | Beads workflow, hierarchy, team orchestration, session close protocol | None | **YES — core portable artifact** |

**Assessment**: Both PRIME files are already Gas Town-free and form the portable Adjutant agent protocol. They are the foundation of the portable system.

### CLAUDE.md (Project Root)

| File | Purpose | Gastown Refs | Portable? |
|------|---------|-------------|-----------|
| `CLAUDE.md` | Mayor context, active tech, scope understanding | **HEAVY** — "Dashboard for ALL of Gas Town", `~/gt`, town beads, rigs | **NO — project-specific, needs rewrite** |

**Issues**:
- "Mayor Context" framing is Gas Town-specific
- References `~/gt/.beads/` (town beads with `hq-*` prefix)
- "The UI runs from `~/gt`" — will be wrong post-extraction
- "Active Technologies" section references specific bead IDs (`013-agent-task-assignment`, `019-beads-service-decompose`)
- `gt prime` recovery command — should be `bd prime` or `adjutant init`

### .claude/rules/ (7 files)

#### 00-critical-scope.md — MISSING
Referenced by `01-project-context.md` and `CLAUDE.md` but **does not exist**. This is a broken reference.

#### 01-project-context.md — GASTOWN-HEAVY, NOT PORTABLE

**Gastown references (11 instances)**:
- "Dashboard for ALL of Gas Town"
- `~/gt/.beads/` (town beads)
- "All agents across all rigs (gastown, adjutant, etc.)"
- "Mayor's command center for the entire town"
- "Mail Interface - Split-view inbox/outbox for Mayor communication (legacy gt mail)"
- `gt up` / `gt down` / `gt status --json` / `gt agents list --all`
- "The backend wraps `gt` CLI commands for Gastown operations"

**What's salvageable**: The architecture description (React + TS + Express + SQLite + MCP) and the project structure tree are accurate and could form the basis of a portable "what is Adjutant" doc. The MCP section, messaging REST API, and WebSocket descriptions are already Gas Town-independent.

**Verdict**: Needs full rewrite to describe Adjutant as a standalone system.

#### 02-code-style.md — PORTABLE AS-IS

No Gas Town references. Standard TypeScript/React coding conventions. This is a good project-development rule but is specific to the *adjutant codebase*, not to "using Adjutant as a platform."

**Verdict**: Keep for adjutant development. Not needed in portable agent protocol.

#### 03-testing.md — PARTIALLY OUTDATED

**Gastown references (5 instances)**:
- `gt-executor` mock examples
- `mail-service`, `power-service`, `status-service` in TDD scope
- `it('should throw when gt command fails')`

**What's salvageable**: TDD methodology, test structure, Vitest config, naming conventions are all sound.

**Verdict**: Needs update to remove `gt-executor` references. Not part of portable protocol — it's for adjutant development.

#### 04-architecture.md — GASTOWN-HEAVY, NOT PORTABLE

**Gastown references (6 instances)**:
- "GT Executor" as a backend layer
- "Single point for spawning `gt` commands"
- Data flow diagram: `→ GT Executor → gt CLI`
- "CLI Wrapper Pattern: We spawn `gt` commands instead of integrating with Gastown internals"
- "Don't bypass the GT executor to call `gt` directly"

**What's salvageable**: The MCP architecture (agent messaging flow, WebSocket server, message store, MCP tools) is the real heart of Adjutant and is already Gas Town-independent. The frontend layers and data flow for agent messaging are clean.

**Verdict**: Needs rewrite. The portable version should describe Adjutant's own architecture: MCP server, message store, beads integration, WebSocket real-time, REST API. Drop the GT executor layer entirely.

#### 05-ui-theme.md — PORTABLE AS-IS (for adjutant development)

No Gas Town references. Describes the Pip-Boy retro terminal aesthetic, color palette, effects, and accessibility. References the `frontend-design` skill.

**Verdict**: Keep for adjutant UI development. Not part of the agent protocol — agents don't need to know about UI theming.

#### 06-speckit-workflow.md — PORTABLE AS-IS

No Gas Town references. Describes the speckit feature development process. References a specific feature (`001-pipboy-ui`) and branch.

**Minor issue**: The "Current Feature" section at the bottom is stale — it references `001-pipboy-ui` which is likely no longer active.

**Verdict**: Keep for adjutant development. The speckit workflow is a development methodology, not part of the agent protocol.

#### 07-team-isolation.md — ALREADY IN PRIME

No Gas Town references. Describes worktree isolation for multi-agent work.

**Issue**: This content is **duplicated** in `.beads/PRIME.md` (the "Worktree Isolation (MANDATORY)" section). The PRIME version is more detailed.

**Verdict**: Redundant with PRIME.md. Could be removed from rules if PRIME covers it. Keep one authoritative source.

---

## Cross-Reference: PRIME vs Rules Overlap

| Topic | In PRIME? | In Rules? | Recommendation |
|-------|-----------|-----------|----------------|
| MCP communication | `.adjutant/PRIME.md` | `01-project-context.md` (partial) | **PRIME is authoritative** — remove from rules |
| Bead tracking | Both PRIMEs | — | Already portable |
| Bead self-assignment | Both PRIMEs | — | Already portable |
| Worktree isolation | `.beads/PRIME.md` | `07-team-isolation.md` | **Deduplicate** — keep in PRIME only |
| Team agent protocol | `.beads/PRIME.md` | — | Already portable |
| Session close checklist | `.beads/PRIME.md` | — | Already portable |
| Architecture (GT) | — | `01-project-context.md`, `04-architecture.md` | **Rewrite without GT** |
| Code style | — | `02-code-style.md` | Keep for dev, not portable |
| Testing/TDD | — | `03-testing.md` | Keep for dev, update GT refs |
| UI theme | — | `05-ui-theme.md` | Keep for dev, not portable |
| Speckit workflow | — | `06-speckit-workflow.md` | Keep for dev, not portable |
| Verification before done | `.beads/PRIME.md` | — | Already portable |
| Plan mode / orchestration | `.beads/PRIME.md` | — | Already portable |

---

## What "Any Directory as Adjutant" Needs

### Tier 1: Core Portable Artifacts (Agent Protocol)

These are what `adjutant init` should install in any directory:

1. **`.adjutant/PRIME.md`** — MCP communication protocol (already exists, already clean)
2. **`.mcp.json`** — MCP server connection config (already exists via `adjutant init`)
3. **Claude Code hooks** — SessionStart/PreCompact to inject PRIME.md (already exists via plugin.json)

### Tier 2: Beads Integration (Optional but Recommended)

4. **`.beads/PRIME.md`** — Full beads workflow (already exists, already clean)
   - Session close protocol
   - Hierarchy wiring
   - Team orchestration
   - Worktree isolation rules
5. **`bd` CLI** — Beads task tracker (separate package)
6. **Claude Code hooks for beads** — `bd prime` on SessionStart/PreCompact

### Tier 3: Adjutant Backend + Dashboard (Full Installation)

7. **Backend server** — Express + MCP SSE + SQLite + WebSocket
8. **Frontend dashboard** — React + Tailwind retro UI
9. **iOS companion app** — Optional mobile dashboard

### What's Missing for Portability

| Gap | Description | Action Needed |
|-----|-------------|---------------|
| No standalone "What is Adjutant" doc | CLAUDE.md is project-specific, not a user guide | Write a portable README for installed directories |
| `adjutant init` doesn't install beads PRIME | Only installs `.adjutant/PRIME.md`, not `.beads/PRIME.md` | Add beads PRIME to init, or make it conditional on `.beads/` existing |
| Plugin doesn't include beads hooks | `plugin.json` only has the adjutant PRIME hook, not `bd prime` | Add beads hook or make it conditional |
| No portable architecture doc | The "how Adjutant works" knowledge is scattered across GT-coupled rules | Create a clean `ARCHITECTURE.md` for installed directories |
| Skills not bundled in plugin | Speckit skills are `.claude/commands/`, not part of the plugin | Bundle skills in the plugin or document how to install them |
| GT removal leaves gaps | Power controls, mail, convoys, GT executor are GT-specific features | Need to decide: remove these features, or replace with Adjutant-native equivalents? |

---

## Gastown Removal Impact Assessment

### Backend Services — GT-Dependent (will need removal/replacement)

| Service | GT Dependency | Impact |
|---------|--------------|--------|
| `gt-executor.ts` | Core GT command runner | **Remove entirely** |
| `gt-control.ts` | `gt up/down` power control | Remove or replace with adjutant-native |
| `power-service.ts` | Wraps GT control | Remove or replace |
| `gastown-utils.ts` | GT utility functions | Remove |
| `gastown-workspace.ts` | GT workspace management | Remove |
| `mail-service.ts` / `mail-data.ts` | `gt mail` legacy | Remove (replaced by message-store.ts) |
| `convoys-service.ts` | GT convoys | Remove |

### Backend Services — Already Adjutant-Native (keep as-is)

| Service | Purpose |
|---------|---------|
| `mcp-server.ts` | MCP SSE server for agents |
| `mcp-tools/*` | All MCP tool handlers |
| `message-store.ts` | SQLite persistent messaging |
| `ws-server.ts` | WebSocket real-time |
| `database.ts` | SQLite + migrations |
| `bd-client.ts` | Beads CLI wrapper |
| `agents-service.ts` | Agent management |
| `session-registry.ts` | Session tracking |
| `proposal-store.ts` | Proposals system |
| `voice-service.ts` | ElevenLabs voice |
| `cost-tracker.ts` | Token cost tracking |
| `swarm-service.ts` | Multi-agent swarm management |

### Frontend Components — GT-Dependent

| Component Dir | GT Dependency | Impact |
|---------------|--------------|--------|
| `power/` | GT up/down controls | Remove or replace |
| `mail/` | GT mail interface | Remove (chat replaces it) |

### Frontend Components — Already Adjutant-Native

| Component Dir | Purpose |
|---------------|---------|
| `chat/` | Agent messaging |
| `beads/` | Bead management |
| `crew/` | Agent status/activity |
| `terminal/` | Session terminal streaming |
| `dashboard/` | Overview dashboard |
| `epics/` | Epic management |
| `proposals/` | Proposal system |
| `voice/` | Voice interface |
| `notifications/` | Notification system |
| `settings/` | Settings UI |

---

## Recommendations

### Immediate Actions (Pre-GT-Removal)

1. **Delete `00-critical-scope.md` reference** — file doesn't exist, remove references in `01-project-context.md` and `CLAUDE.md`
2. **Delete `07-team-isolation.md`** — fully duplicated in `.beads/PRIME.md`
3. **Update `06-speckit-workflow.md`** — remove stale "Current Feature" section
4. **Update `CLAUDE.md`** — remove `gt prime` recovery instruction, replace with `bd prime`

### For GT Removal Sprint

5. **Rewrite `01-project-context.md`** — describe Adjutant as standalone: MCP server + dashboard + beads + agent protocol
6. **Rewrite `04-architecture.md`** — remove GT executor layer, document Adjutant-native architecture
7. **Update `03-testing.md`** — remove GT executor mock examples, add MCP/message-store test patterns
8. **Rewrite `CLAUDE.md`** — complete overhaul as Adjutant standalone project context

### For Portability

9. **Enhance `adjutant init`** — optionally install `.beads/PRIME.md` and beads hooks
10. **Bundle skills in plugin** — speckit commands should be part of the adjutant plugin package
11. **Create portable ARCHITECTURE.md** — clean, GT-free description of Adjutant's architecture for any installed directory
12. **Document the portable rule set** — which rules travel with Adjutant (PRIME files) vs which are development rules (code style, testing, theme)

---

## Classification Summary

### Portable (ships with Adjutant plugin)
- `.adjutant/PRIME.md` — agent communication protocol
- `.beads/PRIME.md` — beads workflow + team orchestration
- `.mcp.json` — MCP server config
- `plugin.json` — Claude Code hooks

### Project-Specific (stays in adjutant repo, does NOT ship)
- `CLAUDE.md` — adjutant project context (needs GT removal rewrite)
- `02-code-style.md` — adjutant codebase conventions
- `03-testing.md` — adjutant TDD rules (needs GT ref cleanup)
- `05-ui-theme.md` — Pip-Boy retro theme rules
- `06-speckit-workflow.md` — feature development methodology

### Obsolete / Redundant (delete)
- `07-team-isolation.md` — duplicated in PRIME
- `00-critical-scope.md` — referenced but doesn't exist

### Needs Rewrite (for GT removal)
- `01-project-context.md` — heavy GT coupling
- `04-architecture.md` — heavy GT coupling
- `CLAUDE.md` — heavy GT coupling
