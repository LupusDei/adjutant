# Implementation Plan: Persistent Self-Correcting Memory System

**Branch**: `033-persistent-memory` | **Date**: 2026-03-08
**Epic**: `adj-053` | **Priority**: P1

## Summary

Add a persistent, self-correcting memory system to the Adjutant via new SQLite tables, 4 new behaviors (memory-collector, session-retrospective, memory-reviewer, self-improver), new MCP tools for memory queries, and a sync mechanism that writes high-confidence learnings to Claude Code auto-memory files. All new behaviors plug into the existing BehaviorRegistry — zero changes to the core framework.

## Bead Map

- `adj-053` - Root: Persistent Self-Correcting Memory System
  - `adj-053.1` - Phase 1: Memory Store (Foundation)
    - `adj-053.1.1` - SQLite migration for memory tables
    - `adj-053.1.2` - Memory store typed interface + CRUD
    - `adj-053.1.3` - Add correction detection events to EventBus
  - `adj-053.2` - Phase 2: Memory Collector (Capture)
    - `adj-053.2.1` - Create memory-collector behavior
    - `adj-053.2.2` - Bead outcome capture logic
    - `adj-053.2.3` - Deduplication + confidence scoring
  - `adj-053.3` - Phase 3: Session Retrospective (Analysis)
    - `adj-053.3.1` - Create session-retrospective behavior
    - `adj-053.3.2` - Metrics gathering + retro generation
  - `adj-053.4` - Phase 4: Memory Reviewer & Query (Maintenance + API)
    - `adj-053.4.1` - Create memory-reviewer behavior
    - `adj-053.4.2` - MCP memory tools
    - `adj-053.4.3` - REST endpoints for dashboard
  - `adj-053.5` - Phase 5: Self-Improver & File Sync (Meta-Learning)
    - `adj-053.5.1` - Create self-improver behavior
    - `adj-053.5.2` - Memory file sync to auto-memory .md files
    - `adj-053.5.3` - Register all behaviors + integration test

## Technical Context

**Stack**: TypeScript 5.x strict mode, Node.js, Express, SQLite (better-sqlite3)
**Storage**: SQLite with FTS5 for full-text search
**Testing**: Vitest (TDD mandatory)
**Constraints**: Must plug into existing BehaviorRegistry/EventBus — no core framework changes. Memory query latency < 50ms for 1000 entries.

## Architecture Decision

**Why behaviors, not a separate service?**

The Adjutant already has a battle-tested event-driven behavior system. Each memory capability (collect, review, retrospect, improve) maps naturally to a behavior with triggers and schedules. Adding them as behaviors means:
- Zero changes to adjutant-core.ts
- Same shouldAct/act pattern as existing behaviors
- Same state/comm injection
- Same decision logging
- Consistent with adj-052's architecture

**Why a separate memory-store.ts, not extending state-store.ts?**

The existing `state-store.ts` manages agent profiles and decisions — a focused responsibility. Memory tables are a different domain (learnings, retrospectives, corrections). A dedicated `memory-store.ts` with its own typed interface keeps both files cohesive and under 200 lines. Both share the same SQLite database instance.

**Why FTS5 for search?**

The existing message-store.ts already uses FTS5 for message search. Using the same approach for learnings means consistent search behavior, no new dependencies, and proven performance in this codebase.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/migrations/011-memory-store.sql` | New migration: learnings, retrospectives, corrections tables + FTS5 |
| `backend/src/services/adjutant/memory-store.ts` | New: typed interface for memory CRUD, search, analytics |
| `backend/src/services/event-bus.ts` | Add `correction:detected` and `learning:created` event types |
| `backend/src/services/adjutant/behaviors/memory-collector.ts` | New behavior: capture learnings from events |
| `backend/src/services/adjutant/behaviors/session-retrospective.ts` | New behavior: daily retro generation |
| `backend/src/services/adjutant/behaviors/memory-reviewer.ts` | New behavior: startup review + weekly prune |
| `backend/src/services/adjutant/behaviors/self-improver.ts` | New behavior: proposal generation |
| `backend/src/services/adjutant/memory-file-sync.ts` | New: sync learnings to auto-memory .md files |
| `backend/src/services/mcp-tools/memory.ts` | New: MCP tools for memory queries |
| `backend/src/routes/memory.ts` | New: REST endpoints for dashboard |
| `backend/src/index.ts` | Register new behaviors + memory routes |
| `backend/tests/unit/adjutant/memory-store.test.ts` | Tests for memory store |
| `backend/tests/unit/adjutant/behaviors/memory-collector.test.ts` | Tests for collector |
| `backend/tests/unit/adjutant/behaviors/session-retrospective.test.ts` | Tests for retro |
| `backend/tests/unit/adjutant/behaviors/memory-reviewer.test.ts` | Tests for reviewer |
| `backend/tests/unit/adjutant/behaviors/self-improver.test.ts` | Tests for improver |
| `backend/tests/unit/adjutant/memory-file-sync.test.ts` | Tests for file sync |

## Phase 1: Memory Store (Foundation)

**Goal**: SQLite schema + typed TypeScript interface for all memory operations.

### Schema Design

```sql
-- Core learnings table
CREATE TABLE adjutant_learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,              -- 'operational'|'technical'|'coordination'|'project'
  topic TEXT NOT NULL,                 -- e.g. 'worktree-isolation', 'bead-assignment'
  content TEXT NOT NULL,               -- the learning itself (plain text)
  source_type TEXT NOT NULL,           -- 'user_correction'|'bead_outcome'|'agent_failure'|'observation'
  source_ref TEXT,                     -- bead ID, message ID, or session ID
  confidence REAL NOT NULL DEFAULT 0.5,
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  last_applied_at TEXT,
  last_validated_at TEXT,
  superseded_by INTEGER REFERENCES adjutant_learnings(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session retrospectives
CREATE TABLE adjutant_retrospectives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_date TEXT NOT NULL,
  beads_closed INTEGER NOT NULL DEFAULT 0,
  beads_failed INTEGER NOT NULL DEFAULT 0,
  corrections_received INTEGER NOT NULL DEFAULT 0,
  agents_used INTEGER NOT NULL DEFAULT 0,
  avg_bead_time_mins REAL,
  went_well TEXT,                      -- JSON array of strings
  went_wrong TEXT,                     -- JSON array of strings
  action_items TEXT,                   -- JSON array of strings
  metrics TEXT,                        -- JSON blob for extensible metrics
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Correction tracking (feedback loop)
CREATE TABLE adjutant_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  correction_type TEXT NOT NULL,       -- 'behavioral'|'technical'|'process'
  pattern TEXT NOT NULL,               -- the detected correction pattern
  description TEXT NOT NULL,
  learning_id INTEGER REFERENCES adjutant_learnings(id),
  recurrence_count INTEGER NOT NULL DEFAULT 0,
  last_recurrence_at TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 for learning search
CREATE VIRTUAL TABLE adjutant_learnings_fts USING fts5(
  content, topic, category,
  content=adjutant_learnings,
  content_rowid=id
);

-- Triggers to keep FTS in sync
CREATE TRIGGER adjutant_learnings_ai AFTER INSERT ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(rowid, content, topic, category)
  VALUES (new.id, new.content, new.topic, new.category);
END;

CREATE TRIGGER adjutant_learnings_ad AFTER DELETE ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(adjutant_learnings_fts, rowid, content, topic, category)
  VALUES('delete', old.id, old.content, old.topic, old.category);
END;

CREATE TRIGGER adjutant_learnings_au AFTER UPDATE ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(adjutant_learnings_fts, rowid, content, topic, category)
  VALUES('delete', old.id, old.content, old.topic, old.category);
  INSERT INTO adjutant_learnings_fts(rowid, content, topic, category)
  VALUES (new.id, new.content, new.topic, new.category);
END;

CREATE INDEX idx_learnings_category ON adjutant_learnings(category);
CREATE INDEX idx_learnings_topic ON adjutant_learnings(topic);
CREATE INDEX idx_learnings_confidence ON adjutant_learnings(confidence DESC);
CREATE INDEX idx_corrections_learning_id ON adjutant_corrections(learning_id);
CREATE INDEX idx_retrospectives_date ON adjutant_retrospectives(session_date DESC);
```

### Memory Store Interface

```typescript
interface MemoryStore {
  // Learnings CRUD
  insertLearning(learning: NewLearning): Learning;
  getLearning(id: number): Learning | null;
  updateLearning(id: number, updates: Partial<Learning>): void;
  findSimilarLearnings(content: string, limit?: number): Learning[];
  queryLearnings(opts: { category?: string; topic?: string; minConfidence?: number; limit?: number }): Learning[];
  searchLearnings(query: string, limit?: number): Learning[];
  reinforceLearning(id: number): void;  // increment count + boost confidence
  supersedeLearning(oldId: number, newId: number): void;
  pruneStale(maxAgeDays: number, minConfidence: number): number;

  // Retrospectives
  insertRetrospective(retro: NewRetrospective): Retrospective;
  getRecentRetrospectives(limit: number): Retrospective[];

  // Corrections
  insertCorrection(correction: NewCorrection): Correction;
  findSimilarCorrection(pattern: string): Correction | null;
  incrementRecurrence(correctionId: number): void;
  getUnresolvedCorrections(): Correction[];

  // Analytics
  getTopicFrequency(days?: number): Array<{ topic: string; count: number }>;
  getCorrectionRecurrenceRate(): number;
  getLearningEffectiveness(): Array<{ id: number; topic: string; recurrences: number }>;
}
```

### Correction Detection Heuristics

Keywords/patterns that indicate user is teaching (matched against `mail:received` body):

```typescript
const CORRECTION_PATTERNS = [
  /\b(?:don'?t|do not|never|stop)\s+(?:do|use|make|create|add|run)/i,
  /\b(?:always|must|should)\s+(?:use|do|include|check|run|add)/i,
  /\b(?:remember|note|important)\s*(?:that|:)/i,
  /\b(?:wrong|incorrect|mistake|error|bug)\b.*\b(?:should|instead|rather)/i,
  /\b(?:rule|policy|convention)\s*:/i,
];
```

### EventBus Additions

```typescript
interface EventMap {
  // ... existing events ...
  "correction:detected": CorrectionDetectedEvent;
  "learning:created": LearningCreatedEvent;
}

interface CorrectionDetectedEvent {
  messageId: string;
  from: string;
  pattern: string;
  body: string;
}

interface LearningCreatedEvent {
  learningId: number;
  category: string;
  topic: string;
  sourceType: string;
}
```

## Phase 2: Memory Collector (Capture)

**Goal**: Behavior that captures learnings from user corrections, bead outcomes, and agent failures.

### Memory Collector Behavior

```
Name: memory-collector
Triggers: mail:received, bead:closed, agent:status_changed
Schedule: none (event-driven only)
```

**Logic**:
1. On `mail:received` from user:
   - Match body against CORRECTION_PATTERNS
   - If match: emit `correction:detected`, then create learning with category/topic inference
   - Deduplicate: search existing learnings for similar content (FTS + Jaccard)
   - If similar exists: reinforce rather than create duplicate
2. On `bead:closed`:
   - Check if bead had failures (reopened, bug beads spawned, multiple attempts)
   - If failure pattern detected: create learning with source_type=bead_outcome
3. On `agent:status_changed` to blocked/disconnected:
   - If agent was working on a bead: log as potential learning about the task type

### Category Inference

Simple keyword-based categorization:
- **operational**: worktree, spawn, isolation, permission, hook, tmux, session
- **technical**: build, test, type, lint, import, compile, migration
- **coordination**: assign, team, agent, bead, epic, dependency
- **project**: ios, frontend, backend, swift, react, component

## Phase 3: Session Retrospective (Analysis)

**Goal**: Daily behavior that generates structured retrospectives. Supersedes adj-052.4.5.

### Session Retrospective Behavior

```
Name: session-retrospective
Triggers: []
Schedule: "0 23 * * *"  (daily at 11 PM, or end of work day)
```

**Logic**:
1. Gather metrics since last retro:
   - Beads closed: count from adjutant_decisions where action=bead_closed
   - Beads failed: beads that were reopened or spawned bug children
   - Corrections received: count of corrections inserted today
   - Agents used: distinct agent IDs in agent profiles active today
   - Average bead time: (closed_at - in_progress_at) from bead history
2. Analyze decisions log for patterns:
   - Most common behavior actions
   - Failed actions (behavior act() errors logged)
3. Generate went_well / went_wrong / action_items:
   - went_well: high bead throughput, zero corrections, successful spawns
   - went_wrong: recurring corrections, build failures, stale agents
   - action_items: derived from went_wrong + unresolved corrections
4. Insert retrospective row
5. Send summary to user via comm.sendImportant()

## Phase 4: Memory Reviewer & Query (Maintenance + API)

**Goal**: Startup review, weekly pruning, and queryable API.

### Memory Reviewer Behavior

```
Name: memory-reviewer
Triggers: [agent:status_changed]  (fires on adjutant startup)
Schedule: "0 0 * * 1"  (weekly on Monday midnight)
```

**Logic — Startup Review**:
1. On first fire after startup (detect via meta key `last_review_at`):
   - Query top 10 learnings by (confidence * recency_weight)
   - Query last 3 retrospectives for recurring action items
   - Format as "Lessons to remember this session" block
   - Inject into next heartbeat prompt via comm.queueRoutine()

**Logic — Weekly Review**:
1. Prune learnings older than 90 days with confidence < 0.3
2. Identify recurring corrections (recurrence_count > 2) — escalate to user
3. Merge similar learnings (FTS match score > 0.8)
4. Update confidence scores based on reinforcement decay:
   - Confidence decays 5% per week if not reinforced
   - Confidence increases 10% per reinforcement
5. Generate weekly summary for user

### MCP Memory Tools

Add to `backend/src/services/mcp-tools/memory.ts`:

```typescript
// query_memories - search learnings by criteria
{
  name: "query_memories",
  description: "Query the Adjutant's memory for learnings by category, topic, or text search",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Full-text search query" },
      category: { type: "string", enum: ["operational", "technical", "coordination", "project"] },
      topic: { type: "string" },
      minConfidence: { type: "number", minimum: 0, maximum: 1 },
      limit: { type: "number", default: 10 },
    },
  },
}

// get_session_retros - retrieve recent retrospectives
{
  name: "get_session_retros",
  description: "Get recent session retrospectives",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", default: 5 },
    },
  },
}
```

### REST Endpoints

```
GET /api/memory/learnings          — list learnings (filter by category, topic, minConfidence)
GET /api/memory/learnings/search   — FTS search
GET /api/memory/retrospectives     — list retros
GET /api/memory/corrections        — list corrections (filter by resolved)
GET /api/memory/stats              — aggregate stats (total learnings, topics, avg confidence)
```

## Phase 5: Self-Improver & File Sync (Meta-Learning)

**Goal**: Generate improvement proposals and sync to auto-memory files.

### Self-Improver Behavior

```
Name: self-improver
Triggers: [learning:created]
Schedule: "0 0 * * 5"  (weekly on Friday)
```

**Logic**:
1. On `learning:created`: check if topic now has 5+ learnings
   - If so, schedule a proposal generation (debounce: 1 per topic per week)
2. On weekly schedule:
   - Group learnings by topic
   - For topics with 5+ entries and avg confidence > 0.6:
     - Synthesize a proposed rule update
     - Call `create_proposal()` MCP tool with type=engineering
   - Track proposal count in metadata
   - If previous proposals were accepted: increase proposal frequency
   - If previous proposals were dismissed: decrease frequency

### Memory File Sync

```
Name: memory-file-sync (not a behavior — utility called by memory-reviewer)
```

**Logic**:
1. Query learnings with confidence > 0.7 and reinforcement_count > 2
2. Group by topic
3. For each topic:
   - Write/update `~/.claude/projects/-Users-Reason-code-ai-adjutant/memory/{topic}.md`
   - Format as concise bullet points (not verbose paragraphs)
4. Update MEMORY.md index:
   - Keep existing manual entries
   - Add/update a "## Auto-Generated Learnings" section with links to topic files
   - Ensure total stays under 180 lines (leave 20-line buffer)
5. Prune topic files for learnings whose confidence dropped below 0.3

## Parallel Execution

- Phase 1 tasks (T001, T002, T003) can run partly in parallel: schema + interface are independent, events depend on schema types
- Phase 2 tasks (T004, T005, T006) are sequential: collector depends on store, outcomes depend on collector, dedup depends on both
- Phase 3 tasks (T007, T008) are tightly coupled: both build the retro behavior
- Phase 4 tasks (T009, T010, T011) can partially parallelize: reviewer is independent of API, but API needs store
- Phase 5 tasks (T012, T013, T014) are sequential: improver uses store, file sync uses store, integration ties everything together
- **Cross-phase**: Phases 2-5 all depend on Phase 1. Phases 3, 4, 5 can run after Phase 2.
- **Best strategy**: 1 agent for Phase 1, then 2-3 agents for Phases 2-5 in parallel

## Verification Steps

- [ ] All memory tables created via migration (run `npm run build && npm test`)
- [ ] Insert a learning via memory-store → verify in SQLite
- [ ] Send a correction message → verify learning created
- [ ] Close a bead → verify bead outcome captured
- [ ] Trigger retro → verify retrospective row with accurate metrics
- [ ] Startup review → verify top learnings surfaced in heartbeat
- [ ] Weekly prune → verify stale learnings removed
- [ ] Query via MCP tool → verify results match criteria
- [ ] REST endpoints → verify JSON responses
- [ ] File sync → verify .md files created with correct content
- [ ] Self-improver → verify proposal created after 5+ topic learnings
- [ ] Zero regression: all existing 102+ tests still pass
