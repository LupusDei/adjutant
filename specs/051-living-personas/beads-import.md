# Living Personas - Beads

**Feature**: 051-living-personas
**Generated**: 2026-04-01
**Source**: specs/051-living-personas/tasks.md

## Root Epic

- **ID**: adj-158
- **Title**: Living Personas: Every Agent Gets a Soul on First Breath
- **Type**: epic
- **Priority**: 1
- **Description**: Every agent spawned with a callsign gets a persona. First-breath genesis ritual for new callsigns, persistent injection for existing ones, evolution after retros.

## Epics

### Phase 1 — Infrastructure: DB, Types, Lore
- **ID**: adj-158.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — Genesis Ritual (MVP)
- **ID**: adj-158.2
- **Type**: epic
- **Priority**: 0
- **Blocks**: Phase 3
- **Tasks**: 4

### Phase 3 — Persona Injection on Spawn
- **ID**: adj-158.3
- **Type**: epic
- **Priority**: 0
- **Tasks**: 4

### Phase 4 — Persona Evolution
- **ID**: adj-158.4
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

### Phase 5 — Dashboard + iOS Display
- **ID**: adj-158.5
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

### Phase 6 — Polish
- **ID**: adj-158.6
- **Type**: epic
- **Priority**: 2
- **Depends**: Phase 2
- **Tasks**: 2

## Tasks

### Phase 1 — Infrastructure

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | DB migration: callsign_personas, evolution_log, source column | backend/src/services/migrations/030-living-personas.sql | adj-158.1.1 |
| T002 | StarCraft lore file: 44 hero entries | .claude/lore/starcraft-heroes.md | adj-158.1.2 |
| T003 | Types: PersonaSource, CallsignPersona, PersonaEvolution, genesis template | backend/src/types/personas.ts | adj-158.1.3 |

### Phase 2 — Genesis Ritual

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | create_persona MCP tool with 100-point budget validation | backend/src/services/mcp-tools/personas.ts | adj-158.2.1 |
| T005 | Genesis prompt builder with lore excerpt injection | backend/src/services/adjutant/genesis-prompt.ts | adj-158.2.2 |
| T006 | Spawn flow: detect missing persona, inject genesis prompt | backend/src/services/agent-spawner-service.ts | adj-158.2.3 |
| T007 | Tests for genesis flow | backend/tests/unit/living-personas-genesis.test.ts | adj-158.2.4 |

### Phase 3 — Persona Injection

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | getPersonaByCallsign + linkCallsignPersona in persona-service | backend/src/services/persona-service.ts | adj-158.3.1 |
| T009 | spawn_worker: callsign persona check + injection | backend/src/services/mcp-tools/coordination.ts | adj-158.3.2 |
| T010 | REST spawn: callsign persona check + injection | backend/src/routes/agents.ts | adj-158.3.3 |
| T011 | Tests for persona injection | backend/tests/unit/living-personas-injection.test.ts | adj-158.3.4 |

### Phase 4 — Persona Evolution

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T012 | evolve_persona MCP tool | backend/src/services/mcp-tools/personas.ts | adj-158.4.1 |
| T013 | logEvolution + getEvolutionHistory in persona-service | backend/src/services/persona-service.ts | adj-158.4.2 |
| T014 | Tests for evolution | backend/tests/unit/living-personas-evolution.test.ts | adj-158.4.3 |

### Phase 5 — Dashboard + iOS Display

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T015 | Backend API: evolution endpoint + agent persona fields | backend/src/routes/ | adj-158.5.1 |
| T016 | Frontend: persona badge + trait display | frontend/src/components/ | adj-158.5.2 |
| T017 | iOS: persona badge + trait summary | ios/Adjutant/Features/Agents/ | adj-158.5.3 |

### Phase 6 — Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T018 | Timeline event: persona:created | backend/src/services/event-bus.ts | adj-158.6.1 |
| T019 | Race condition guard for concurrent callsign spawns | backend/src/services/persona-service.ts | adj-158.6.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Infrastructure | 3 | 1 | adj-158.1 |
| 2: Genesis Ritual (MVP) | 4 | 0 | adj-158.2 |
| 3: Persona Injection | 4 | 0 | adj-158.3 |
| 4: Persona Evolution | 3 | 2 | adj-158.4 |
| 5: Dashboard + iOS | 3 | 2 | adj-158.5 |
| 6: Polish | 2 | 2 | adj-158.6 |
| **Total** | **19** | | |

## Dependency Graph

Phase 1: Infrastructure (adj-158.1)
    |
    +---> Phase 2: Genesis Ritual (adj-158.2, MVP)  Phase 4: Evolution (adj-158.4)  [parallel]
    |         |
    |         +---> Phase 3: Injection (adj-158.3)  Phase 5: Display (adj-158.5)  [parallel]
    |                   |
    |                   +---> Phase 6: Polish (adj-158.6)
    |
    (all phases blocked by Phase 1)

## Improvements

Improvements (Level 4: adj-158.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
