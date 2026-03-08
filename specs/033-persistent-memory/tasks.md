# Tasks: Persistent Self-Correcting Memory System

**Input**: Design documents from `/specs/033-persistent-memory/`
**Epic**: `adj-053`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-053.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1-US5)

---

## Phase 1: Memory Store (Foundation)

**Purpose**: SQLite schema + typed TypeScript interface for all memory operations. This is the data layer that every other phase depends on.

- [ ] T001 [P] Create SQLite migration for memory tables (adjutant_learnings, adjutant_retrospectives, adjutant_corrections, FTS5 virtual table, triggers, indexes) in `backend/src/services/migrations/011-memory-store.sql`
- [ ] T002 Create memory-store.ts with typed MemoryStore interface and all CRUD methods (insertLearning, queryLearnings, searchLearnings, reinforceLearning, insertRetrospective, insertCorrection, pruneStale, analytics) in `backend/src/services/adjutant/memory-store.ts` + `backend/tests/unit/adjutant/memory-store.test.ts`
- [ ] T003 [P] Add `correction:detected` and `learning:created` event types to EventBus in `backend/src/services/event-bus.ts`

**Checkpoint**: Memory store operational — all CRUD methods pass unit tests, migration applies cleanly

---

## Phase 2: Memory Collector (Capture)

**Purpose**: Behavior that captures learnings from user corrections, bead outcomes, and agent failures. This is the primary learning ingestion pipeline.
**Goal**: [US1] When the user corrects behavior, the system captures it as a structured learning

- [ ] T004 [US1] Create memory-collector behavior with correction detection (CORRECTION_PATTERNS regex matching against mail:received body, category inference from keywords) in `backend/src/services/adjutant/behaviors/memory-collector.ts` + `backend/tests/unit/adjutant/behaviors/memory-collector.test.ts`
- [ ] T005 [US1] Add bead outcome capture to memory-collector (detect failure patterns from bead:closed events — reopened beads, bug children, multiple attempts) in `backend/src/services/adjutant/behaviors/memory-collector.ts`
- [ ] T006 [US1] Implement deduplication (FTS similarity matching) and confidence scoring (reinforcement on duplicate detection, decay on non-use) in `backend/src/services/adjutant/memory-store.ts`

**Checkpoint**: Corrections captured → Learning created → Deduplication working

---

## Phase 3: Session Retrospective (Analysis)

**Purpose**: Daily behavior that generates structured retrospectives. Supersedes adj-052.4.5.
**Goal**: [US2] End-of-day structured reflection with metrics and action items

- [ ] T007 [US2] Create session-retrospective behavior with daily schedule, metrics gathering (beads closed/failed, corrections count, agents used, avg bead time from decisions log) in `backend/src/services/adjutant/behaviors/session-retrospective.ts` + `backend/tests/unit/adjutant/behaviors/session-retrospective.test.ts`
- [ ] T008 [US2] Implement retro analysis logic (went_well/went_wrong/action_items generation from metrics + correction patterns, summary formatting, send to user via comm.sendImportant) in `backend/src/services/adjutant/behaviors/session-retrospective.ts`

**Checkpoint**: Daily retro generates with accurate metrics and actionable insights

---

## Phase 4: Memory Reviewer & Query (Maintenance + API)

**Purpose**: Startup review, weekly pruning, pattern detection, and queryable API.
**Goal**: [US3, US5] Surface learnings at startup + expose memory via MCP/REST

- [ ] T009 [US3] Create memory-reviewer behavior with startup review (top learnings by confidence*recency injected into heartbeat prompt) and weekly prune (decay confidence, prune stale, merge similar, identify recurring corrections) in `backend/src/services/adjutant/behaviors/memory-reviewer.ts` + `backend/tests/unit/adjutant/behaviors/memory-reviewer.test.ts`
- [ ] T010 [P] [US5] Add MCP memory tools (query_memories, get_session_retros) with input schemas and handlers in `backend/src/services/mcp-tools/memory.ts`
- [ ] T011 [P] [US5] Add REST endpoints (GET /api/memory/learnings, /search, /retrospectives, /corrections, /stats) in `backend/src/routes/memory.ts`

**Checkpoint**: Startup review surfaces top lessons, MCP + REST queries return correct results

---

## Phase 5: Self-Improver & File Sync (Meta-Learning)

**Purpose**: Generate improvement proposals and sync learnings to auto-memory files.
**Goal**: [US4] Propose self-improvements + keep auto-memory files current

- [ ] T012 [US4] Create self-improver behavior (detect 5+ learnings per topic, generate rule/agent-definition proposals via create_proposal MCP tool, track acceptance rate) in `backend/src/services/adjutant/behaviors/self-improver.ts` + `backend/tests/unit/adjutant/behaviors/self-improver.test.ts`
- [ ] T013 [US3] Implement memory file sync utility (query high-confidence learnings, write topic .md files to auto-memory dir, update MEMORY.md index under 180 lines) in `backend/src/services/adjutant/memory-file-sync.ts` + `backend/tests/unit/adjutant/memory-file-sync.test.ts`
- [ ] T014 Register all 4 new behaviors in `backend/src/index.ts`, add memory routes, write integration test verifying full pipeline (correction → learning → retro → review → proposal) in `backend/src/index.ts` + `backend/tests/unit/adjutant/memory-integration.test.ts`

**Checkpoint**: Full pipeline operational — correction flows through to learning, retro, review, and proposal

---

## Dependencies

- Phase 1 (Foundation) blocks all other phases
- Phase 2 (Collector) depends on Phase 1
- Phase 3 (Retrospective) depends on Phase 1 (uses memory store for metrics)
- Phase 4 (Reviewer & Query) depends on Phase 1 + Phase 2 (reviews collected learnings)
- Phase 5 (Self-Improver) depends on Phase 1 + Phase 2 (needs accumulated learnings)
- T014 (integration) depends on all prior tasks
- Within Phase 1: T001 and T003 are parallel; T002 depends on T001 (needs schema)
- Within Phase 4: T010 and T011 are parallel (different files)

## Parallel Opportunities

- T001 and T003 can run simultaneously (different files)
- T010 and T011 can run simultaneously (different files)
- After Phase 1 completes: Phases 2, 3, and partial Phase 4 (MCP/REST) can run in parallel
- After Phase 2 completes: Phases 4 (reviewer) and 5 can run in parallel
- **Best team strategy**: 1 agent for Phase 1, then 3 agents for Phases 2/3/4-API in parallel, then 1 agent for Phase 5 integration

## External Dependencies

- Existing proposal system (MCP `create_proposal` tool) must be working for self-improver
- Existing message-store.ts pattern is the reference implementation for FTS5
- adj-052.4.5 (Retrospective) will be superseded — close it when this epic's Phase 3 ships
