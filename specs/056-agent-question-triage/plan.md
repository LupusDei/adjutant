# Plan: Agent Question Triage (adj-181)

## Architecture Decisions

1. **Standalone `agent_questions` table + reuse delivery.** The question/answer
   record is its own first-class entity (adds the triage/status layer), but it does
   NOT reinvent delivery: filing a question also writes a normal message into the
   asking agent's DM conversation (via the existing message/conversation store) and
   broadcasts over the existing WS server. (Rule 9 — reuse.)
2. **Layered**: `routes/questions.ts` → `question-service`/`question-store.ts` →
   SQLite. WS broadcast via the existing `ws-server.ts` helpers. MCP tools in
   `mcp-tools/questions.ts`.
3. **Server-side asker identity**: `file_question` resolves the asking agent from
   the MCP session (`getAgentBySession`) — never client-supplied. `projectId`
   resolved via `resolveToolProjectContext` (adj-146), supporting cross-project.
4. **projectId is the only scoping key** (UUID). Stored on every row, filtered in
   every query, emitted in every event.

## Data Model (migration `034-agent-questions.sql`)

```
agent_questions(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,              -- asker (server-resolved)
  body TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK(urgency IN ('low','normal','high','blocking')),
  status TEXT NOT NULL DEFAULT 'open'  CHECK(status IN ('open','answered','dismissed')),
  answer_body TEXT,                    -- nullable
  answered_by TEXT,                    -- nullable (answering member id)
  bead_id TEXT,                        -- optional linkage
  conversation_id TEXT,                -- DM the question was mirrored into
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agent_questions_status ON agent_questions(status, urgency, created_at);
CREATE INDEX idx_agent_questions_project ON agent_questions(project_id, status);
```

## Phases (= sub-epic numbers)

### Phase 1 (adj-181.1) — Foundational: data model + store
Migration + `question-store.ts` (`fileQuestion`, `answerQuestion`, `dismissQuestion`,
`listQuestions`, `getQuestion`). Everything depends on this.
Files: `backend/src/services/migrations/034-agent-questions.sql`,
`backend/src/services/question-store.ts`, `backend/src/types/index.ts` (types/Zod).

### Phase 2 (adj-181.2) — US1: MCP tools (depends on .1)
`backend/src/services/mcp-tools/questions.ts`: `file_question`, `answer_question`,
`list_questions`; register in the MCP tool wiring. Server-side identity + projectId
override. file_question mirrors into the asker's DM via the message/conversation store.

### Phase 3 (adj-181.3) — US2: REST + WS real-time (depends on .1; parallel with .2)
`backend/src/routes/questions.ts` (GET list, POST answer, POST dismiss) + register
router; WS broadcast (`question:new|answered|dismissed`) in `ws-server.ts`. Answering
notifies the asker's DM.

### Phase 4 (adj-181.4) — US3: Web triage view (depends on .3)
`frontend/src/services/api.ts` methods, `frontend/src/hooks/useOpenQuestions.ts`,
`frontend/src/components/questions/OpenQuestionsView.tsx` (+ css). Live WS via the
existing CommunicationContext. `frontend-design` for the Pip-Boy themed UI.

### Phase 5 (adj-181.5) — US4: iOS triage screen (depends on .3; parallel with .4)
`ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Questions.swift`,
`ios/Adjutant/Sources/Features/Questions/ViewModels/OpenQuestionsViewModel.swift`,
`ios/Adjutant/Sources/Features/Questions/OpenQuestionsView.swift`. SPM auto-discovery;
NO `.pbxproj` edits for files under `Adjutant/`.

### Phase 6 (adj-181.6) — Polish: acceptance + docs
End-to-end acceptance test (file → appears in triage → answer → leaves view + asker
notified). Architecture-rule + CLAUDE.md doc of the question-triage model.

## Parallelization

```
.1 (foundational) ──┬── .2 (MCP)            ── (done)
                    └── .3 (REST+WS) ──┬── .4 (web)   ─┐
                                       └── .5 (iOS)   ─┴── .6 (polish/acceptance)
```
`.2` and `.3` start once `.1` merges. `.4` and `.5` start once `.3` merges and run in
parallel (different platforms, no shared files). `.6` last. MVP = `.1` + `.2` (+ `.3`
list endpoint) — agents can file + coordinator can answer/triage via MCP before the UIs land.

## Bead Map (created — 32 beads: 1 root + 6 sub-epics + 25 tasks)

- `adj-181` — Agent Question Triage (epic, P2)
  - `adj-181.1` — Foundational: data model + question-store
    - `adj-181.1.1` migration test (RED) · `adj-181.1.2` migration · `adj-181.1.3` store tests (RED) · `adj-181.1.4` store impl · `adj-181.1.5` type tests (RED) · `adj-181.1.6` types
  - `adj-181.2` — US1: MCP tools  *(blocked by .1)*
    - `adj-181.2.1` mcp tests (RED) · `adj-181.2.2` mcp impl · `adj-181.2.3` register
  - `adj-181.3` — US2: REST + WS  *(blocked by .1)*
    - `adj-181.3.1` route tests (RED) · `adj-181.3.2` routes · `adj-181.3.3` register · `adj-181.3.4` WS tests (RED) · `adj-181.3.5` WS broadcasts
  - `adj-181.4` — US3: Web triage view  *(blocked by .3)*
    - `adj-181.4.1` hook tests (RED) · `adj-181.4.2` hook+api · `adj-181.4.3` view · `adj-181.4.4` nav
  - `adj-181.5` — US4: iOS triage screen  *(blocked by .3)*
    - `adj-181.5.1` APIClient tests (RED) · `adj-181.5.2` APIClient · `adj-181.5.3` VM tests (RED) · `adj-181.5.4` VM · `adj-181.5.5` view
  - `adj-181.6` — Polish: acceptance + docs  *(blocked by .4, .5)*
    - `adj-181.6.1` e2e acceptance · `adj-181.6.2` docs

**Wiring notes:** parent↔child via `--parent` (bd: epics can't be `dep`-blocked by tasks). Cross-phase gating via epic←epic deps (.2/.3←.1, .4/.5←.3, .6←.4,.5). Intra-phase RED→impl ordering via task←task deps. Entry points (ready now): `adj-181.1.1`, `adj-181.1.5`.
