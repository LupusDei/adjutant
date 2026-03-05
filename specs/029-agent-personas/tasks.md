# Tasks: Agent Personas & Roles

**Input**: Design documents from `/specs/029-agent-personas/`
**Epic**: `adj-033`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-033.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Setup

**Purpose**: Types, SQLite migration, validation schemas

- [ ] T001 [US1] Define Persona types, PersonaTrait enum, and trait definitions constant in `backend/src/types/personas.ts`
- [ ] T002 [P] [US1] Create SQLite migration for `personas` table (id, name, description, traits JSON, timestamps) in `backend/src/services/database.ts`
- [ ] T003 [P] [US1] Create Zod validation schemas for persona create/update payloads in `backend/src/types/personas.ts`

**Checkpoint**: Types and storage ready — service layer can begin

---

## Phase 2: Core Backend — Persona CRUD & Point Budget

**Purpose**: Service layer with business logic and REST API
**Goal**: Full persona lifecycle with point budget enforcement

- [ ] T004 [US1] Implement PersonaService with create, get, list, update, delete + point budget validation in `backend/src/services/persona-service.ts`
- [ ] T005 [P] [US1] Create persona REST routes (GET/POST/PUT/DELETE /api/personas) in `backend/src/routes/personas.ts`
- [ ] T006 [US1] Write PersonaService unit tests (CRUD, budget validation, unique names) in `backend/tests/unit/persona-service.test.ts`
- [ ] T007 [P] [US1] Write persona routes unit tests (request validation, error responses) in `backend/tests/unit/personas-routes.test.ts`
- [ ] T026 [US1] Add callsign enabled/disabled persistence and toggle API (callsign_settings table, PUT /api/callsigns/:name/toggle, PUT /api/callsigns/toggle-all, GET /api/callsigns) in `backend/src/services/callsign-service.ts` and `backend/src/routes/callsigns.ts`
- [ ] T027 [US1] Write callsign toggle unit tests in `backend/tests/unit/callsign-toggle.test.ts`

**Checkpoint**: API fully functional — can create/manage personas and toggle callsigns via REST

---

## Phase 3: Prompt Generation Engine

**Purpose**: Convert trait configurations into behavioral system prompts
**Goal**: Deterministic, tiered prompt generation from trait values
**Independent Test**: Known trait values produce expected prompt sections

- [ ] T008 [US2] Define trait-to-prompt mapping templates with intensity tiers (0/low/medium/high) in `backend/src/services/prompt-generator.ts`
- [ ] T009 [US2] Implement PromptGenerator service — iterate traits, select tiers, concatenate into coherent system prompt in `backend/src/services/prompt-generator.ts`
- [ ] T010 [P] [US2] Add GET /api/personas/:id/prompt endpoint to return generated prompt in `backend/src/routes/personas.ts`
- [ ] T011 [US2] Write PromptGenerator unit tests (tier selection, full prompt assembly, determinism) in `backend/tests/unit/prompt-generator.test.ts`

**Checkpoint**: Prompt engine functional — trait values produce behavioral prompts

---

## Phase 4: Spawn & Hook Integration

**Purpose**: Inject persona prompts into agent sessions at spawn and across compaction
**Goal**: Persona-driven agents that maintain their personality through session lifecycle
**Independent Test**: Spawned agent's tmux session contains persona prompt

- [ ] T012 [US3] Modify spawn route to accept optional `personaId` parameter, fetch persona + prompt, inject into session in `backend/src/routes/agents.ts` and `backend/src/services/session-bridge.ts`
- [ ] T013 [US3] Create SessionStart hook script that fetches persona prompt from API and outputs it in `backend/src/services/persona-hooks.ts`
- [ ] T014 [P] [US3] Create PreCompact hook script for persona prompt re-injection in `backend/src/services/persona-hooks.ts`
- [ ] T015 [US3] Write spawn + persona integration tests in `backend/tests/unit/persona-spawn.test.ts`

**Checkpoint**: Persona prompts injected at spawn and survive compaction

---

## Phase 5: iOS Persona Management UI

**Purpose**: iOS app screens for persona CRUD with slider controls
**Goal**: Create and manage personas from the iOS app with visual budget enforcement

- [ ] T016 [US4] Create Persona Swift model and API client in `ios/AdjutantKit/Sources/Models/Persona.swift` and `ios/AdjutantKit/Sources/Services/PersonaService.swift`
- [ ] T017 [US4] Create PersonaListView showing all personas with trait summaries in `ios/Adjutant/Personas/PersonaListView.swift`
- [ ] T018 [US4] Create PersonaEditorView with 12 trait sliders and point budget bar in `ios/Adjutant/Personas/PersonaEditorView.swift`
- [ ] T019 [P] [US4] Create PersonaDetailView with trait breakdown and generated prompt preview in `ios/Adjutant/Personas/PersonaDetailView.swift`
- [ ] T020 [US4] Add "Build Persona" button to iOS Agents page (opens editor as sheet/push, not a separate tab) in `ios/Adjutant/Agents/`
- [ ] T028 [US4] Add callsign roster toggles to iOS Agents page (individual on/off per callsign + master toggle) in `ios/Adjutant/Agents/`

**Checkpoint**: iOS persona management and callsign toggles fully functional

---

## Phase 6: Web Dashboard Persona Management

**Purpose**: Web dashboard equivalent with retro terminal styling
**Goal**: Manage personas from the web with slider controls and budget visualization

- [ ] T021 [US5] Create PersonasList component with retro terminal styling in `frontend/src/components/personas/PersonasList.tsx`
- [ ] T022 [US5] Create PersonaEditor component with slider controls and budget bar in `frontend/src/components/personas/PersonaEditor.tsx`
- [ ] T023 [P] [US5] Create PersonaPreview component showing generated prompt in `frontend/src/components/personas/PersonaPreview.tsx`
- [ ] T024 [US5] Wire frontend API service with persona endpoints in `frontend/src/services/api.ts`
- [ ] T025 [US5] Add Personas route and navigation in web dashboard in `frontend/src/App.tsx`
- [ ] T029 [US5] Add callsign roster toggles to web Agents/Crew page in `frontend/src/components/crew/`

**Checkpoint**: Web persona management and callsign toggles fully functional

---

## Dependencies

- Setup (Phase 1) → Core Backend (Phase 2) → blocks all subsequent phases
- Prompt Engine (Phase 3) and Spawn Integration (Phase 4) can run in parallel after Phase 2
- iOS UI (Phase 5) depends on Phase 2 (API) + Phase 3 (prompt preview endpoint)
- Web UI (Phase 6) depends on Phase 2 (API) + Phase 3 (prompt preview endpoint)
- iOS (Phase 5) and Web (Phase 6) can run in parallel

## Parallel Opportunities

- T002 and T003 can run in parallel (migration vs schemas — different concerns in same file but independent sections)
- T005 and T006 can run in parallel (routes vs service tests — different files)
- T010 and T011 can run in parallel (endpoint vs tests)
- T013 and T014 can run in parallel (SessionStart vs PreCompact hooks)
- T019 can run in parallel with T017/T018 (detail view vs list/editor)
- T023 can run in parallel with T021/T022 (preview vs list/editor)
- Phase 5 and Phase 6 can run fully in parallel
