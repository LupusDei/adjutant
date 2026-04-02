# Tasks: Living Personas

**Input**: Design documents from `/specs/051-living-personas/`
**Epic**: `adj-158`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-158.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Infrastructure

**Purpose**: DB schema, types, lore file — blocks everything else

- [ ] T001 [US1,US2] Add DB migration 030-living-personas.sql: CREATE TABLE callsign_personas (callsign TEXT PRIMARY KEY, persona_id TEXT NOT NULL, created_at TEXT DEFAULT datetime('now')); CREATE TABLE persona_evolution_log (id TEXT PRIMARY KEY, persona_id TEXT NOT NULL, trait TEXT NOT NULL, old_value INTEGER, new_value INTEGER, changed_at TEXT DEFAULT datetime('now')); ALTER TABLE personas ADD COLUMN source TEXT DEFAULT 'hand-crafted' in `backend/src/services/migrations/030-living-personas.sql`
- [ ] T002 [P] [US1] Create StarCraft lore reference file with 44 hero entries: personality description (3-5 sentences) + suggested trait affinities for each. Organize by faction (Terran, Zerg, Protoss). Include all callsigns from callsign-service.ts in `.claude/lore/starcraft-heroes.md`
- [ ] T003 [P] [US2,US4] Define types: PersonaSource ('hand-crafted' | 'self-generated'), CallsignPersona interface, PersonaEvolution interface, GENESIS_PROMPT_TEMPLATE constant in `backend/src/types/personas.ts`

**Checkpoint**: Schema ready, lore file available, types defined

---

## Phase 2: Genesis Ritual (Priority: P0, MVP)

**Goal**: Agents self-define their persona on first spawn
**Independent Test**: Spawn new callsign, verify persona created via MCP tool

- [ ] T004 [US2] Implement create_persona MCP tool: validates 100-point budget (sum of all 12 traits must equal 100), 0-20 per trait range, requires name + description + traits. Stores in personas table with source='self-generated'. Links callsign via callsign_personas. Emits persona:created event in `backend/src/services/mcp-tools/personas.ts`
- [ ] T005 [US2] Implement genesis prompt builder: buildGenesisPrompt(callsign, loreExcerpt, assignedWork) that reads the specific callsign entry from the lore file, constructs the self-definition instructions including 12 trait names and descriptions, and includes the work context. Export as function from `backend/src/services/adjutant/genesis-prompt.ts`
- [ ] T006 [US2] Modify spawn flow: in agent-spawner-service.ts, before generating Layer 3 preamble, check callsign_personas table. If no persona exists, build genesis prompt via buildGenesisPrompt() and prepend to the initial spawn prompt. Pass the assigned work context from the spawn request in `backend/src/services/agent-spawner-service.ts`
- [ ] T007 [US2] Write tests: test create_persona validates budget (100 total, 0-20 per trait), test genesis prompt includes callsign lore, test spawn flow detects missing persona and injects genesis, test spawn flow skips genesis when persona exists in `backend/tests/unit/living-personas-genesis.test.ts`

**Checkpoint**: Genesis ritual works end-to-end on new callsign spawn

---

## Phase 3: Persona Injection on Spawn (Priority: P0)

**Goal**: Existing callsign personas auto-inject via --agent file on spawn
**Independent Test**: Create persona for callsign, spawn that callsign, verify --agent file written

- [ ] T008 [US3] Add getPersonaByCallsign(callsign) to persona-service.ts: queries callsign_personas JOIN personas. Add linkCallsignPersona(callsign, personaId) for the create_persona flow in `backend/src/services/persona-service.ts`
- [ ] T009 [US3] Wire callsign persona lookup into spawn_worker MCP tool: before spawning, check getPersonaByCallsign(). If exists, generate persona prompt, write agent file, add --agent flag. This gives coordinator-spawned agents their persona in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T010 [US3] Wire callsign persona lookup into REST /api/agents/spawn: same logic as spawn_worker — check callsign_personas before generating Layer 3 preamble in `backend/src/routes/agents.ts`
- [ ] T011 [US3] Write tests: test getPersonaByCallsign returns persona when linked, test spawn_worker injects persona, test REST spawn injects persona, test both fall back to genesis when no persona in `backend/tests/unit/living-personas-injection.test.ts`

**Checkpoint**: All spawn paths check callsign persona and inject when available

---

## Phase 4: Persona Evolution (Priority: P2)

**Goal**: Agents can adjust their traits after session retros
**Independent Test**: Call evolve_persona, verify traits update within bounds

- [ ] T012 [P] [US4] Implement evolve_persona MCP tool: accepts trait adjustments (+/-2 per trait max), validates total remains 100, validates each trait stays 0-20. Persists evolution log entry. Updates persona traits in `backend/src/services/mcp-tools/personas.ts`
- [ ] T013 [P] [US4] Add logEvolution() to persona-service.ts: inserts into persona_evolution_log with before/after values. Add getEvolutionHistory(personaId) for the API in `backend/src/services/persona-service.ts`
- [ ] T014 [US4] Write tests: test evolve bounds (+/-2), test budget preservation (total=100), test per-trait range (0-20), test evolution log persistence in `backend/tests/unit/living-personas-evolution.test.ts`

**Checkpoint**: Agents can evolve their personas within strict bounds

---

## Phase 5: Dashboard + iOS Display (Priority: P2)

**Goal**: Users can see agent personas and evolution history
**Independent Test**: Open agent detail, verify traits displayed

- [ ] T015 [P] [US5] Backend API: GET /api/personas/:id/evolution returns evolution history. Extend GET /api/agents to include personaId and personaSource fields in agent response in `backend/src/routes/personas.ts` and `backend/src/routes/agents.ts`
- [ ] T016 [P] [US5] Frontend: add persona badge (self-generated / hand-crafted) to agent cards on overview. Add trait weight display to agent detail or persona gallery page in `frontend/src/components/`
- [ ] T017 [P] [US5] iOS: add persona source badge to AgentsSectionView. Add trait summary to AgentDetailView in `ios/Adjutant/Features/Agents/`

**Checkpoint**: Persona visibility across all surfaces

---

## Phase 6: Polish & Cross-Cutting

- [ ] T018 [US2] Add persona:created event type to EventBus + timeline event type enum. Wire timeline persistence in index.ts event listener in `backend/src/services/event-bus.ts` and `backend/src/types/events.ts`
- [ ] T019 [US2] Add race condition guard: if two agents spawn with same callsign simultaneously, second should wait for first's persona or use it if already created. Use DB unique constraint + retry in `backend/src/services/persona-service.ts`

---

## Dependencies

- Phase 1 (Infrastructure) -> blocks all other phases
- Phase 2 (Genesis) -> blocks Phase 3 (Injection needs create_persona to exist)
- Phase 3 (Injection) can partially overlap Phase 2 (persona lookup is independent)
- Phase 4 (Evolution) independent after Phase 1
- Phase 5 (Display) independent after Phase 1 (just needs API endpoints)
- Phase 6 (Polish) depends on Phase 2

## Parallel Opportunities

- T002 and T003 can run in parallel within Phase 1 (different files)
- T012 and T013 can run in parallel within Phase 4 (different files)
- T015, T016, T017 can all run in parallel within Phase 5 (backend/frontend/iOS)
- After Phase 1: Phase 2 and Phase 4 can start simultaneously
- After Phase 2: Phase 3 and Phase 5 can start simultaneously
