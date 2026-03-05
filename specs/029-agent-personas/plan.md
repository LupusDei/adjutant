# Implementation Plan: Agent Personas & Roles

**Branch**: `029-agent-personas` | **Date**: 2026-03-03
**Epic**: `adj-033` | **Priority**: P1

## Summary

Build a persona system that lets users define named agent personalities with trait-based point budgets, generates contextual system prompts from trait configurations, and injects those prompts at spawn time and across compaction events. Storage in SQLite, iOS UI first, web dashboard second.

## Bead Map

- `adj-033` - Root: Agent Personas & Roles
  - `adj-033.1` - Setup: Types, migration, schemas
    - `adj-033.1.1` - Define Persona types and trait enum
    - `adj-033.1.2` - Create SQLite migration for personas table
    - `adj-033.1.3` - Create Zod validation schemas
  - `adj-033.2` - Core Backend: Persona service + CRUD API
    - `adj-033.2.1` - Implement PersonaService with CRUD + budget validation
    - `adj-033.2.2` - Create persona REST routes
    - `adj-033.2.3` - Write PersonaService unit tests
    - `adj-033.2.4` - Write persona routes unit tests
  - `adj-033.3` - US2: Prompt Generation Engine
    - `adj-033.3.1` - Define trait-to-prompt mapping templates
    - `adj-033.3.2` - Implement PromptGenerator service
    - `adj-033.3.3` - Write PromptGenerator unit tests
  - `adj-033.4` - US3: Spawn & Hook Integration
    - `adj-033.4.1` - Modify spawn route to accept personaId
    - `adj-033.4.2` - Create SessionStart hook for persona injection
    - `adj-033.4.3` - Create PreCompact hook for persona re-injection
    - `adj-033.4.4` - Write spawn + persona integration tests
  - `adj-033.5` - US4: iOS Persona Management UI
    - `adj-033.5.1` - Create PersonaListView
    - `adj-033.5.2` - Create PersonaEditorView with sliders + budget
    - `adj-033.5.3` - Create PersonaDetailView with prompt preview
    - `adj-033.5.4` - Wire iOS API client for persona endpoints
    - `adj-033.5.5` - Add Personas navigation in iOS app
  - `adj-033.6` - US5: Web Dashboard Persona Management
    - `adj-033.6.1` - Create PersonasList component
    - `adj-033.6.2` - Create PersonaEditor component with sliders
    - `adj-033.6.3` - Create PersonaPreview component
    - `adj-033.6.4` - Wire frontend API service for persona endpoints
    - `adj-033.6.5` - Add Personas route in web dashboard

## Technical Context

**Stack**: TypeScript 5.x, React 18, Express, SQLite, Zod, SwiftUI (iOS)
**Storage**: New `personas` table in existing SQLite database
**Testing**: Vitest (backend/frontend), XCTest (iOS)
**Constraints**: Point budget validation must be server-side (client can preview but server enforces)

## Architecture Decision

**Trait-to-prompt mapping**: Each trait has a prompt template with intensity tiers. The PromptGenerator iterates traits, selects the appropriate tier based on the 0–20 value, and concatenates sections into a coherent system prompt. Tiers:
- 0: Omitted entirely
- 1–7 (Low): Brief mention, low priority instruction
- 8–14 (Medium): Moderate emphasis, balanced instruction
- 15–20 (High): Strong emphasis, primary behavioral directive

**Point budget**: 100 total points across 12 traits (each 0–20). This means an agent can have ~5 traits at high (15+), or spread points more evenly at medium. The math ensures specialization: maxing 5 traits leaves 0 for the other 7.

**Storage**: Single `personas` table with JSON column for trait values. Simpler than normalized trait tables, and trait definitions are code-side constants (not user-configurable).

**Injection strategy**: Dual injection — (1) at spawn time via prompt prepend in tmux session, and (2) via SessionStart + PreCompact hooks that call the API to fetch the persona prompt. The hook scripts live in the project's `.claude/hooks/` and are registered per-session during spawn.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/types/personas.ts` | New — Persona, PersonaTrait types, trait definitions |
| `backend/src/services/database.ts` | Add personas table migration |
| `backend/src/services/persona-service.ts` | New — CRUD operations, budget validation |
| `backend/src/services/prompt-generator.ts` | New — Trait-to-prompt engine |
| `backend/src/routes/personas.ts` | New — REST endpoints |
| `backend/src/routes/agents.ts` | Modify spawn to accept personaId |
| `backend/src/services/session-bridge.ts` | Modify createSession to inject persona prompt |
| `backend/tests/unit/persona-service.test.ts` | New — Service tests |
| `backend/tests/unit/prompt-generator.test.ts` | New — Prompt generator tests |
| `backend/tests/unit/personas-routes.test.ts` | New — Route tests |
| `ios/Adjutant/Personas/PersonaListView.swift` | New — List view |
| `ios/Adjutant/Personas/PersonaEditorView.swift` | New — Editor with sliders |
| `ios/Adjutant/Personas/PersonaDetailView.swift` | New — Detail + prompt preview |
| `ios/AdjutantKit/Sources/Models/Persona.swift` | New — Persona model |
| `ios/AdjutantKit/Sources/Services/PersonaService.swift` | New — API client |
| `frontend/src/components/personas/PersonasList.tsx` | New — List component |
| `frontend/src/components/personas/PersonaEditor.tsx` | New — Editor with sliders |
| `frontend/src/components/personas/PersonaPreview.tsx` | New — Prompt preview |
| `frontend/src/services/api.ts` | Add persona API methods |

## Phase 1: Setup

Define types, create SQLite migration, and Zod schemas. Pure foundation — no business logic yet.

## Phase 2: Core Backend (MVP)

Implement PersonaService with full CRUD, point budget enforcement, and unique name validation. Create REST routes. TDD — tests first.

## Phase 3: Prompt Generation Engine

Build the trait-to-prompt mapper. Each trait has intensity tiers that produce different behavioral instructions. The engine concatenates active traits into a coherent system prompt with a persona header (name + description).

## Phase 4: Spawn & Hook Integration

Modify the spawn flow to accept an optional `personaId`. When present, fetch the persona, generate the prompt, and inject it into the tmux session. Create hook scripts for SessionStart and PreCompact that re-fetch and re-inject.

## Phase 5: iOS Persona Management UI

Build SwiftUI views for persona CRUD. PersonaListView shows all personas. PersonaEditorView has 12 sliders with a point budget bar that fills as you allocate. PersonaDetailView shows traits and a generated prompt preview. Wire to REST API.

## Phase 6: Web Dashboard Persona Management

Port the iOS experience to the web dashboard with retro terminal styling. Slider controls, budget visualization bar, prompt preview panel. Uses existing frontend patterns and API service.

## Parallel Execution

- After Phase 2 (Core Backend), Phases 3 and 4 can run in parallel (prompt engine and spawn integration are independent until final wiring)
- After Phase 4, Phases 5 and 6 can run in parallel (iOS and web are independent)
- Within phases, tasks marked [P] can run simultaneously

## Verification Steps

- [ ] POST /api/personas with valid traits → 201 with persona
- [ ] POST /api/personas with budget > 100 → 400 error
- [ ] GET /api/personas/:id/prompt → generated system prompt text
- [ ] POST /api/agents/spawn with personaId → agent session contains persona prompt
- [ ] Trigger compaction → persona prompt re-injected via hook
- [ ] iOS: create persona with sliders → appears in list
- [ ] iOS: exceed budget → slider stops
- [ ] Web: equivalent to iOS verification
