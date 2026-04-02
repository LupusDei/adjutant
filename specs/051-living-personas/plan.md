# Implementation Plan: Living Personas

**Branch**: `051-living-personas` | **Date**: 2026-04-01
**Epic**: `adj-158` | **Priority**: P1

## Summary

Every agent spawned with a StarCraft callsign gets a persona — either pre-existing or self-generated via a "genesis ritual" on first spawn. The agent reads bundled lore, reflects on their assignment, and allocates 100 trait points across 12 personality dimensions. Personas persist, inject via the existing --agent file mechanism, and evolve after session retros.

## Bead Map

- `adj-158` - Root: Living Personas
  - `adj-158.1` - Phase 1: Infrastructure (DB, types, lore file)
    - `adj-158.1.1` - DB migration: callsign_personas + persona source field + evolution log
    - `adj-158.1.2` - StarCraft lore file: 44 hero entries
    - `adj-158.1.3` - Types: CallsignPersona, PersonaEvolution, genesis prompt template
  - `adj-158.2` - Phase 2: Genesis Ritual (US2, core feature)
    - `adj-158.2.1` - create_persona MCP tool with 100-point budget validation
    - `adj-158.2.2` - Genesis prompt builder with lore excerpt injection
    - `adj-158.2.3` - Spawn flow: check callsign persona, inject genesis or persona
    - `adj-158.2.4` - Tests for genesis flow
  - `adj-158.3` - Phase 3: Persona Injection (US3)
    - `adj-158.3.1` - Callsign persona lookup in agent-spawner-service
    - `adj-158.3.2` - spawn_worker MCP tool: callsign persona check
    - `adj-158.3.3` - Tests for persona injection
  - `adj-158.4` - Phase 4: Persona Evolution (US4)
    - `adj-158.4.1` - evolve_persona MCP tool with +/-2 bounds
    - `adj-158.4.2` - Evolution log persistence
    - `adj-158.4.3` - Tests for evolution
  - `adj-158.5` - Phase 5: Dashboard + iOS Display (US5)
    - `adj-158.5.1` - Backend API: persona detail + evolution history endpoints
    - `adj-158.5.2` - Frontend: persona badge on agent cards, trait display
    - `adj-158.5.3` - iOS: trait display on agent detail, persona badge
  - `adj-158.6` - Phase 6: Polish
    - `adj-158.6.1` - Timeline event: persona:created
    - `adj-158.6.2` - Race condition guard for concurrent callsign spawns

## Technical Context

**Stack**: TypeScript, Node.js, Express, SQLite (better-sqlite3), React, SwiftUI
**Storage**: SQLite (personas table, callsign_personas table, persona_evolution_log table)
**Testing**: Vitest
**Constraints**: 100-point budget for trait allocation, 0-20 per trait, genesis must complete < 60s

## Architecture Decision

Reuse the existing persona system (PersonaService, PromptGenerator, agent file writer) rather than building a parallel system. The genesis ritual is a spawn-time conditional that either injects an existing persona or prepends a genesis prompt. The create_persona MCP tool wraps PersonaService.createPersona() with budget validation.

Key choice: genesis prompt is injected as the initial spawn prompt (via tmux paste), NOT as an --agent file. This is because the agent needs MCP tools (read_messages, create_persona) during genesis, which require a running Claude session — the --agent file would need to be written before the session starts, but we don't know the traits yet.

After genesis completes, subsequent spawns use the --agent file mechanism (persona already exists).

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/migrations/030-living-personas.sql` | New tables: callsign_personas, persona_evolution_log; alter personas add source column |
| `.claude/lore/starcraft-heroes.md` | New file: 44 hero personality entries with suggested trait affinities |
| `backend/src/types/personas.ts` | Add PersonaSource type, CallsignPersona interface, PersonaEvolution interface |
| `backend/src/services/persona-service.ts` | Add getPersonaByCallsign(), linkCallsignPersona(), logEvolution() |
| `backend/src/services/mcp-tools/personas.ts` | New file: create_persona, evolve_persona MCP tools |
| `backend/src/services/agent-spawner-service.ts` | Callsign persona lookup before spawn |
| `backend/src/services/mcp-tools/coordination.ts` | spawn_worker: callsign persona check |
| `backend/src/routes/agents.ts` | Callsign persona lookup in REST spawn |
| `backend/src/services/event-bus.ts` | Add persona:created event type |
| `frontend/src/components/` | Persona badge, trait display components |
| `ios/Adjutant/Features/Agents/` | Trait display in agent detail |

## Phase 1: Infrastructure
DB migration for callsign_personas junction table, persona source field, evolution log. StarCraft lore file with 44 entries. Type definitions.

## Phase 2: Genesis Ritual (MVP)
The core feature. create_persona MCP tool with budget validation. Genesis prompt builder that extracts the specific callsign's lore excerpt and constructs the self-definition instructions. Spawn flow modification to detect missing persona and inject genesis prompt.

## Phase 3: Persona Injection
Wire callsign persona lookup into all spawn paths: agent-spawner-service (REST spawns), spawn_worker MCP tool (coordinator spawns). When persona exists, write --agent file and inject.

## Phase 4: Persona Evolution
evolve_persona MCP tool with +/-2 per trait per adjustment, total must remain 100. Persist evolution history with before/after snapshots.

## Phase 5: Dashboard + iOS Display
API endpoint for persona detail with evolution history. Frontend persona badge on agent cards. iOS trait display on agent detail view.

## Phase 6: Polish
Timeline event for persona:created. Race condition guard for concurrent spawns of the same callsign.

## Parallel Execution

- Phase 1 blocks all others
- After Phase 1: Phases 2 and 3 can run in parallel (but Phase 3 depends on create_persona from Phase 2)
- Phase 4 is independent of Phases 2/3 (just needs the DB schema)
- Phase 5 is independent (just needs API endpoints from Phase 2/3)
- Phase 6 can run last

Best parallelization: Phase 1 first, then 2+4 in parallel, then 3+5 in parallel, then 6.

## Verification Steps

- [ ] Spawn agent with new callsign — verify genesis ritual runs and persona is created
- [ ] Spawn same callsign again — verify persona is injected, no genesis
- [ ] Verify 100-point budget is enforced in create_persona
- [ ] Verify 0-20 per-trait range is enforced
- [ ] Verify evolve_persona respects +/-2 bounds
- [ ] Verify lore file has all 44 callsigns
- [ ] Verify dashboard shows persona badge and traits
- [ ] Verify iOS shows persona on agent detail
