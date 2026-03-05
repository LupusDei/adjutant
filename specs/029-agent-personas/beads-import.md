# Agent Personas & Roles - Beads

**Feature**: 029-agent-personas
**Generated**: 2026-03-03
**Source**: specs/029-agent-personas/tasks.md

## Root Epic

- **ID**: adj-033
- **Title**: Agent Personas & Roles
- **Type**: epic
- **Priority**: 1
- **Description**: Configurable agent personas with personality trait sliders, point-budget enforcement, prompt generation engine, and spawn/compaction injection. iOS UI first, web dashboard second.

## Epics

### Phase 1 — Setup: Types, Migration, Schemas
- **ID**: adj-033.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — Core Backend: Persona CRUD & Point Budget + Callsign Toggles
- **ID**: adj-033.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 3, Phase 4, Phase 5, Phase 6
- **Tasks**: 6

### Phase 3 — US2: Prompt Generation Engine
- **ID**: adj-033.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 4 — US3: Spawn & Hook Integration
- **ID**: adj-033.4
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 5 — US4: iOS Persona Management UI (on Agents page)
- **ID**: adj-033.5
- **Type**: epic
- **Priority**: 2
- **MVP**: false
- **Tasks**: 6

### Phase 6 — US5: Web Dashboard Persona Management
- **ID**: adj-033.6
- **Type**: epic
- **Priority**: 3
- **Tasks**: 6

## Tasks

### Phase 1 — Setup

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Define Persona types, trait enum, trait definitions | `backend/src/types/personas.ts` | adj-033.1.1 |
| T002 | Create SQLite migration for personas table | `backend/src/services/database.ts` | adj-033.1.2 |
| T003 | Create Zod validation schemas for persona payloads | `backend/src/types/personas.ts` | adj-033.1.3 |

### Phase 2 — Core Backend

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Implement PersonaService with CRUD + budget validation | `backend/src/services/persona-service.ts` | adj-033.2.1 |
| T005 | Create persona REST routes | `backend/src/routes/personas.ts` | adj-033.2.2 |
| T006 | Write PersonaService unit tests | `backend/tests/unit/persona-service.test.ts` | adj-033.2.3 |
| T007 | Write persona routes unit tests | `backend/tests/unit/personas-routes.test.ts` | adj-033.2.4 |
| T026 | Add callsign enabled/disabled persistence + toggle API | `backend/src/services/callsign-service.ts` | adj-033.2.5 |
| T027 | Write callsign toggle unit tests | `backend/tests/unit/callsign-toggle.test.ts` | adj-033.2.6 |

### Phase 3 — Prompt Generation Engine

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Define trait-to-prompt mapping templates | `backend/src/services/prompt-generator.ts` | adj-033.3.1 |
| T009 | Implement PromptGenerator service | `backend/src/services/prompt-generator.ts` | adj-033.3.2 |
| T010 | Add GET /api/personas/:id/prompt endpoint | `backend/src/routes/personas.ts` | adj-033.3.3 |
| T011 | Write PromptGenerator unit tests | `backend/tests/unit/prompt-generator.test.ts` | adj-033.3.4 |

### Phase 4 — Spawn & Hook Integration

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T012 | Modify spawn route to accept personaId + inject prompt | `backend/src/routes/agents.ts` | adj-033.4.1 |
| T013 | Create SessionStart hook for persona injection | `backend/src/services/persona-hooks.ts` | adj-033.4.2 |
| T014 | Create PreCompact hook for persona re-injection | `backend/src/services/persona-hooks.ts` | adj-033.4.3 |
| T015 | Write spawn + persona integration tests | `backend/tests/unit/persona-spawn.test.ts` | adj-033.4.4 |

### Phase 5 — iOS Persona Management UI

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T016 | Create Persona Swift model + API client | `ios/AdjutantKit/` | adj-033.5.1 |
| T017 | Create PersonaListView | `ios/Adjutant/Personas/PersonaListView.swift` | adj-033.5.2 |
| T018 | Create PersonaEditorView with sliders + budget bar | `ios/Adjutant/Personas/PersonaEditorView.swift` | adj-033.5.3 |
| T019 | Create PersonaDetailView with prompt preview | `ios/Adjutant/Personas/PersonaDetailView.swift` | adj-033.5.4 |
| T020 | Add "Build Persona" button to iOS Agents page | `ios/Adjutant/Agents/` | adj-033.5.5 |
| T028 | Add callsign roster toggles to iOS Agents page | `ios/Adjutant/Agents/` | adj-033.5.6 |

### Phase 6 — Web Dashboard Persona Management

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T021 | Create PersonasList component | `frontend/src/components/personas/PersonasList.tsx` | adj-033.6.1 |
| T022 | Create PersonaEditor with sliders + budget bar | `frontend/src/components/personas/PersonaEditor.tsx` | adj-033.6.2 |
| T023 | Create PersonaPreview component | `frontend/src/components/personas/PersonaPreview.tsx` | adj-033.6.3 |
| T024 | Wire frontend API service for persona endpoints | `frontend/src/services/api.ts` | adj-033.6.4 |
| T025 | Add Personas route in web dashboard | `frontend/src/App.tsx` | adj-033.6.5 |
| T029 | Add callsign roster toggles to web Agents/Crew page | `frontend/src/components/crew/` | adj-033.6.6 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Setup | 3 | 1 | adj-033.1 |
| 2: Core Backend | 6 | 1 | adj-033.2 |
| 3: Prompt Engine | 4 | 1 | adj-033.3 |
| 4: Spawn Integration | 4 | 1 | adj-033.4 |
| 5: iOS UI | 6 | 2 | adj-033.5 |
| 6: Web Dashboard | 6 | 3 | adj-033.6 |
| **Total** | **29** | | |

## Dependency Graph

```
Phase 1: Setup (adj-033.1)
    |
Phase 2: Core Backend (adj-033.2) --blocks--> Phase 3, 4, 5, 6
    |
    +---------------------------+
    |                           |
Phase 3: Prompt Engine    Phase 4: Spawn Integration
(adj-033.3)               (adj-033.4)
    |                           |
    +---------------------------+
    |                           |
Phase 5: iOS UI           Phase 6: Web Dashboard     [parallel]
(adj-033.5)               (adj-033.6)
```

## Improvements

Improvements (Level 4: adj-033.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
