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

The record is **rich and filterable**, but the richness is primarily *agent-authored
framing context* so the General can answer fast and accurately (per the General's
directive). New since the original draft: `context`, `category`, `suggested_options`,
`chosen_option` (answer-format + rich-context decisions).

```
agent_questions(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,              -- asker (server-resolved, never client-supplied)
  body TEXT NOT NULL,                  -- the question itself (one-line ask)
  context TEXT,                        -- NEW: rich agent-authored framing — what it's
                                       --   trying to do, what it already tried, the
                                       --   tradeoff/what it needs done. Frames the answer.
  category TEXT,                       -- NEW: filterable bucket
                                       --   ('decision'|'clarification'|'approval'|'action_required'|'other')
                                       --   action_required = a blocking TASK/ACTION the
                                       --   General must DO (not just answer): key, access,
                                       --   approval-with-side-effects, manual step.
  suggested_options TEXT,              -- NEW: JSON array of agent-proposed answer choices
                                       --   (nullable) — the General can one-tap a choice.
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK(urgency IN ('low','normal','high','blocking')),
  status TEXT NOT NULL DEFAULT 'open'  CHECK(status IN ('open','answered','dismissed')),
  answer_body TEXT,                    -- nullable: free-text answer
  chosen_option TEXT,                  -- NEW: nullable: the suggested option the General
                                       --   picked. Answer = chosen_option AND/OR answer_body
                                       --   (at least one required to answer).
  answered_by TEXT,                    -- nullable (answering member id)
  bead_id TEXT,                        -- optional linkage to the work item in question
  conversation_id TEXT,                -- DM the question was mirrored into
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agent_questions_status   ON agent_questions(status, urgency, created_at);
CREATE INDEX idx_agent_questions_project  ON agent_questions(project_id, status);
CREATE INDEX idx_agent_questions_category ON agent_questions(category, status);   -- NEW: filterable
CREATE INDEX idx_agent_questions_agent    ON agent_questions(agent_id, status);   -- NEW: filter by asker
```

**Answer contract**: a question is answered with `chosen_option` (one of
`suggested_options`) OR `answer_body` (free text) OR both — at least one is required.
`suggested_options` is stored as a JSON string array; validated via Zod on the way in.
For `action_required` items, "answering" means the General confirms completion — a short
`answer_body` (e.g. "done — key added to .env") or a suggested option like "Completed"
resolves it; the lifecycle (open→answered) is the same, no separate resolve path.

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

### Phase 3 (adj-181.3) — US2: REST + WS real-time + push (depends on .1; parallel with .2)
`backend/src/routes/questions.ts` (GET list with `status|projectId|category|agentId|urgency`
filters, POST answer accepting `{ answerBody?, chosenOption? }`, POST dismiss) + register
router; WS broadcast (`question:new|answered|dismissed`) in `ws-server.ts`. Answering
notifies the asker's DM. **NEW**: on `question:new`, enqueue an APNS push via the existing
`apns-service.ts` + `notification-queue.ts` so the General is notified on iOS even when
away from the desk (push body carries asker + urgency + truncated question; deep-links to
the Open Questions screen). High/blocking always push; normal/low respect existing
notification prefs.

### Phase 4 (adj-181.4) — US3: Web triage view (depends on .3)
`frontend/src/services/api.ts` methods, `frontend/src/hooks/useOpenQuestions.ts`,
`frontend/src/components/questions/OpenQuestionsView.tsx` (+ css). Live WS via the
existing CommunicationContext. `frontend-design` for the Pip-Boy themed UI. Each row
renders the agent's **context** block (collapsible) and any **suggested options** as
one-tap answer buttons (plus a free-text box); a filter bar exposes category/agent/urgency.

### Phase 5 (adj-181.5) — US4: iOS triage screen + push deep-link (depends on .3; parallel with .4)
`ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Questions.swift`,
`ios/Adjutant/Sources/Features/Questions/ViewModels/OpenQuestionsViewModel.swift`,
`ios/Adjutant/Sources/Features/Questions/OpenQuestionsView.swift`. SPM auto-discovery;
NO `.pbxproj` edits for files under `Adjutant/`. Renders context + suggested-option
quick-pick + free text, mirroring web. The `question:new` APNS push (Phase 3) deep-links
into this screen.

### Phase 6 (adj-181.6) — Polish: acceptance + docs
End-to-end acceptance test (file → appears in triage → answer → leaves view + asker
notified). Architecture-rule + CLAUDE.md doc of the question-triage model.

### Phase 7 (adj-181.7) — Adoption: mandate the queue in agent startup instructions (depends on .2, .3)
Without adoption the tool is dead weight. Make routing questions through `file_question`
a MANDATORY, discoverable requirement at agent startup. Source of truth is the prime
GENERATOR (`cli/lib/prime.ts`) — the `.adjutant/PRIME.md` files are generated, so edit the
generator and regenerate, never hand-edit the output. Also amend constitution Rule 5
(governance: version bump + rationale + propagation) and the spawn-prompt templates
(`squad-execute`, `epic-planner` Question Routing). Gated on the tool being live (.2 + .3):
we never instruct agents to use a tool that isn't deployed.
Files: `cli/lib/prime.ts` (+ regenerated `.adjutant/PRIME.md`, `.beads/PRIME.md`,
`backend/.adjutant/PRIME.md`), `constitution.md`, `.claude/rules/01-project-context.md` (or
the relevant rule), `CLAUDE.md`, `.claude/skills/*/SKILL.md` spawn-prompt sections.

## Parallelization

```
.1 (foundational) ──┬── .2 (MCP) ───────────────┬─────────────── .7 (adoption: prime/constitution)
                    └── .3 (REST+WS+push) ──┬─── ┴── .4 (web)  ─┐
                                            └────── .5 (iOS)   ─┴── .6 (polish/acceptance)
```
`.2` and `.3` start once `.1` merges. `.4` and `.5` start once `.3` merges and run in
parallel (different platforms, no shared files). `.7` (adoption) needs only `.2` + `.3`
(the live tool + answer path), so it can land with the backend MVP — in parallel with the
UI phases. `.6` last. MVP = `.1` + `.2` (+ `.3`) — agents can file + coordinator can
answer/triage via MCP before the UIs land; `.7` then flips agents onto the queue.

## Bead Map (39 beads: 1 root + 7 sub-epics + 31 tasks)

> Augmented 2026-05-31 per the General's directives: (1) richer agent-authored context
> (`context`/`category`), (2) agent-suggested answer options (`suggested_options`/`chosen_option`),
> (3) an APNS push on new question (`adj-181.3.6`/`adj-181.3.7`), and (4) a new adoption
> sub-epic `adj-181.7` mandating the queue in agent startup instructions (prime generator +
> constitution Rule 5 + spawn-prompt templates). Existing tasks whose scope grew (migration,
> store, types, MCP, routes, web/iOS views) were updated in place; see tasks.md.

- `adj-181` — Agent Question Triage (epic, P2)
  - `adj-181.1` — Foundational: data model + question-store
    - `adj-181.1.1` migration test (RED) · `adj-181.1.2` migration · `adj-181.1.3` store tests (RED) · `adj-181.1.4` store impl · `adj-181.1.5` type tests (RED) · `adj-181.1.6` types
  - `adj-181.2` — US1: MCP tools  *(blocked by .1)*
    - `adj-181.2.1` mcp tests (RED) · `adj-181.2.2` mcp impl · `adj-181.2.3` register
  - `adj-181.3` — US2: REST + WS + push  *(blocked by .1)*
    - `adj-181.3.1` route tests (RED) · `adj-181.3.2` routes · `adj-181.3.3` register · `adj-181.3.4` WS tests (RED) · `adj-181.3.5` WS broadcasts · `adj-181.3.6` push tests (RED) · `adj-181.3.7` APNS push on question:new
  - `adj-181.4` — US3: Web triage view  *(blocked by .3)*
    - `adj-181.4.1` hook tests (RED) · `adj-181.4.2` hook+api · `adj-181.4.3` view · `adj-181.4.4` nav
  - `adj-181.5` — US4: iOS triage screen  *(blocked by .3)*
    - `adj-181.5.1` APIClient tests (RED) · `adj-181.5.2` APIClient · `adj-181.5.3` VM tests (RED) · `adj-181.5.4` VM · `adj-181.5.5` view
  - `adj-181.6` — Polish: acceptance + docs  *(blocked by .4, .5)*
    - `adj-181.6.1` e2e acceptance · `adj-181.6.2` docs
  - `adj-181.7` — Adoption: mandate the queue in agent startup instructions  *(blocked by .2, .3)*
    - `adj-181.7.1` prime-mandate test (RED) · `adj-181.7.2` update prime.ts generator + regenerate · `adj-181.7.3` amend constitution Rule 5 (+ propagation) · `adj-181.7.4` update spawn-prompt templates (squad-execute, epic-planner)

**Wiring notes:** parent↔child via `--parent` (bd: epics can't be `dep`-blocked by tasks). Cross-phase gating via epic←epic deps (.2/.3←.1, .4/.5←.3, .6←.4,.5, .7←.2,.3). Intra-phase RED→impl ordering via task←task deps. Entry points (ready now): `adj-181.1.1`, `adj-181.1.5`.
