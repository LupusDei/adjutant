# Implementation Plan: Auto-Develop

**Spec**: 047-auto-develop
**Root Epic**: `adj-122`

## Technical Context

### Existing Infrastructure
- **BehaviorRegistry** (`backend/src/services/adjutant/behavior-registry.ts`): Plugin system for event-driven behaviors. New `auto-develop-loop` behavior will register here.
- **StimulusEngine** (`backend/src/services/adjutant/stimulus-engine.ts`): Handles scheduled checks, event watches, wake callbacks with 90s cooldown. Loop phases will use `scheduleCheck()` for phase transitions.
- **AdjutantState** (`backend/src/services/adjutant/state-store.ts`): Decision logging, agent profiles, meta store. Auto-develop cycle tracking will extend this.
- **ProposalStore** (`backend/src/services/proposal-store.ts`): CRUD for proposals with comments/revisions. Needs new columns for confidence scoring.
- **ProjectsService** (`backend/src/services/projects-service.ts`): Project registry with SQLite backing. Needs `auto_develop`, `auto_develop_paused_at`, `vision_context` columns.
- **EventBus** (`backend/src/services/event-bus.ts`): Typed pub/sub. Needs new event types for auto-develop lifecycle.
- **Coordination MCP Tools** (`backend/src/services/mcp-tools/coordination.ts`): spawn_worker, assign_bead, nudge_agent. Auto-develop will use these to spawn ideation/reviewer/execution agents.

### Architecture Decisions
1. **Behavior-driven loop**: The auto-develop loop is a BehaviorRegistry behavior, not a standalone service. This keeps it consistent with existing patterns (idle-proposal-nudge) and ensures proper event dispatch.
2. **Phase state in meta store**: Current loop phase stored via `AdjutantState.setMeta()` keyed by project ID. No new tables for phase tracking — the `auto_develop_cycles` table tracks completed cycles.
3. **Confidence signals as JSON**: Stored in `confidence_signals TEXT` column on proposals. Extensible without schema changes.
4. **Coordinator-driven**: The behavior schedules stimulus checks that wake the coordinator. The coordinator reads the situation prompt and takes the appropriate phase action. The behavior does NOT directly spawn agents.

## Phases

### Phase 1: Schema & Data Layer (Setup)
**Sub-epic**: `adj-122.1`

Database migrations and store extensions. No behavior logic yet — just the data foundation.

- Migration: Add `auto_develop`, `auto_develop_paused_at`, `vision_context` to projects table
- Migration: Add `confidence_score`, `review_round`, `auto_generated`, `confidence_signals` to proposals table
- Migration: Create `auto_develop_cycles` table
- Extend `ProjectsService` with auto-develop getters/setters
- Extend `ProposalStore` with confidence scoring methods
- Create `AutoDevelopStore` for cycle tracking

### Phase 2: Event & Type Foundation (Foundational)
**Sub-epic**: `adj-122.2`

New event types and shared types that other phases depend on.

- Add EventBus events: `project:auto_develop_enabled`, `project:auto_develop_disabled`, `proposal:scored`, `proposal:completed`, `auto_develop:phase_changed`, `auto_develop:escalated`
- Add shared types: `ConfidenceSignals`, `ConfidenceScore`, `AutoDevelopPhase`, `AutoDevelopCycle`, `AutoDevelopStatus`
- Add Zod schemas for new API inputs

### Phase 3: Confidence Scoring Engine (US2)
**Sub-epic**: `adj-122.3`

The core scoring logic — pure functions with no side effects, easily testable.

- Implement `computeConfidenceScore(signals: ConfidenceSignals): number` with weighted formula
- Implement `classifyConfidence(score: number): "accept" | "refine" | "escalate" | "dismiss"`
- Implement `score_proposal` MCP tool for reviewer agents
- Implement historical success lookup (query past proposals of similar type/scope)

### Phase 4: Auto-Develop Loop Behavior (US3)
**Sub-epic**: `adj-122.4`

The main behavior that drives the 7-phase loop.

- Implement `auto-develop-loop` behavior with triggers and shouldAct guard
- Phase 1 (ANALYZE): Build situation prompt from project state
- Phase 2 (IDEATE): Schedule coordinator wake with ideation context
- Phase 3 (REVIEW): Schedule coordinator wake with review context
- Phase 4 (GATE): Apply confidence thresholds, transition proposal status
- Phase 5 (PLAN): Invoke epic-planner context in coordinator wake
- Phase 6 (EXECUTE): Invoke squad-execute context in coordinator wake
- Phase 7 (VALIDATE): Schedule QA/review wake
- Register behavior in `adjutant-core.ts` initialization
- Concurrency controls: max proposals in review, max epics in execution
- Backpressure: pause/resume at EXECUTE phase

### Phase 5: Enable/Disable & Escalation (US1 + US4)
**Sub-epic**: `adj-122.5`

Toggle endpoints, MCP tools, and vision update flow.

- REST: `PATCH /api/projects/:id` — accept `autoDevelop` field
- MCP tools: `enable_auto_develop`, `disable_auto_develop`, `provide_vision_update`
- Vision update: store in `projects.vision_context`, clear `auto_develop_paused_at`, emit resume event
- Escalation message builder: structured "Vision Update Needed" with proposals, scores, guidance requests
- APNS integration for escalation push notifications

### Phase 6: MCP Query Tools & REST API (US7)
**Sub-epic**: `adj-122.6`

Status query tools for agents and dashboard.

- MCP tool: `get_auto_develop_status` — returns phase, proposals, scores, paused status
- REST: `GET /api/projects/:id/auto-develop` — same data for web/iOS
- Project-scoped access control on all queries

### Phase 7: Dashboard UI (US6)
**Sub-epic**: `adj-122.7`

Web dashboard components for auto-develop visibility and control.

- Auto-develop toggle in project settings
- Auto-develop status panel: phase indicator, proposal pipeline, confidence bars
- Escalation banner with inline vision update response
- Cycle history timeline component

### Phase 8: iOS App (US5)
**Sub-epic**: `adj-122.8`

iOS SwiftUI views for mobile auto-develop management.

- Project detail auto-develop toggle
- Auto-develop status panel (phase, proposals, scores)
- Escalation banner with inline response
- APNS notification handling for auto-develop events

## Parallel Opportunities

- **Phase 1 + Phase 2**: Schema and events can be built in parallel (no dependencies)
- **Phase 3**: Depends on Phase 1 (proposals schema) + Phase 2 (types)
- **Phase 4**: Depends on Phase 2 (events) + Phase 3 (scoring)
- **Phase 5**: Depends on Phase 1 (projects schema) + Phase 2 (events)
- **Phase 6**: Depends on Phase 4 (loop state) + Phase 5 (enable/disable)
- **Phase 7 + Phase 8**: Can be built in parallel, both depend on Phase 6 (REST API)

```
Phase 1 (Schema) ──┬──→ Phase 3 (Scoring) ──→ Phase 4 (Loop) ──→ Phase 6 (Query) ──┬──→ Phase 7 (Dashboard)
                    │                                              ↑                  │
Phase 2 (Events) ──┴──→ Phase 5 (Toggle/Escalation) ─────────────┘                  └──→ Phase 8 (iOS)
```

## Bead Map

- `adj-122` - Root epic: Auto-Develop — Continuous Autonomous Project Development Loop
  - `adj-122.1` - Setup: Schema & Data Layer
    - `adj-122.1.1` - Migration: projects table auto-develop columns
    - `adj-122.1.2` - Migration: proposals table confidence columns
    - `adj-122.1.3` - Migration: auto_develop_cycles table
    - `adj-122.1.4` - Extend ProjectsService with auto-develop methods
    - `adj-122.1.5` - Extend ProposalStore with confidence methods
    - `adj-122.1.6` - Create AutoDevelopStore for cycle tracking
  - `adj-122.2` - Foundational: Events & Types
    - `adj-122.2.1` - Add auto-develop EventBus event types
    - `adj-122.2.2` - Add shared types (ConfidenceSignals, AutoDevelopPhase, etc.)
    - `adj-122.2.3` - Add Zod schemas for new API inputs
  - `adj-122.3` - US2: Confidence Scoring Engine
    - `adj-122.3.1` - Implement confidence score computation + classification
    - `adj-122.3.2` - Implement historical success lookup
    - `adj-122.3.3` - Implement score_proposal MCP tool
  - `adj-122.4` - US3: Auto-Develop Loop Behavior
    - `adj-122.4.1` - Implement auto-develop-loop behavior skeleton + registration
    - `adj-122.4.2` - Implement ANALYZE + IDEATE phases
    - `adj-122.4.3` - Implement REVIEW + GATE phases
    - `adj-122.4.4` - Implement PLAN + EXECUTE + VALIDATE phases
    - `adj-122.4.5` - Implement concurrency controls + backpressure
  - `adj-122.5` - US1+US4: Toggle & Escalation
    - `adj-122.5.1` - REST endpoint for auto-develop toggle
    - `adj-122.5.2` - MCP tools: enable/disable auto-develop
    - `adj-122.5.3` - Vision update flow (provide_vision_update tool + projects.vision_context)
    - `adj-122.5.4` - Escalation message builder + APNS integration
  - `adj-122.6` - US7: Query Tools & REST API
    - `adj-122.6.1` - MCP tool: get_auto_develop_status
    - `adj-122.6.2` - REST: GET /api/projects/:id/auto-develop
  - `adj-122.7` - US6: Dashboard UI
    - `adj-122.7.1` - Auto-develop toggle + status indicator in project settings
    - `adj-122.7.2` - Auto-develop status panel (phase, pipeline, confidence bars)
    - `adj-122.7.3` - Escalation banner + inline vision update response
    - `adj-122.7.4` - Cycle history timeline component
  - `adj-122.8` - US5: iOS App
    - `adj-122.8.1` - Project detail auto-develop toggle + API integration
    - `adj-122.8.2` - Auto-develop status panel (SwiftUI)
    - `adj-122.8.3` - Escalation banner with inline response
    - `adj-122.8.4` - APNS notification handling for auto-develop events
