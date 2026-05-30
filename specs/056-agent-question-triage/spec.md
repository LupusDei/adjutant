# Spec: Agent Question Triage (adj-181)

## Problem

Agents currently route questions to the General via `send_message({to:"user"})`
(constitution Rule 5: never `AskUserQuestion`, never block on stdin). That works
for delivery but has no structure: there is no first-class "question" entity, no
way to mark a question **answered**, and no **aggregated surface** to see every
OPEN question across all agents. The General cannot quickly answer *"what is
blocking my agents right now?"* — blocking questions are buried in per-agent DMs.

## Goal

A first-class, triageable agent question/answer system: agents **file** questions
via an MCP tool; the General sees all open questions in an **aggregated triage
view** (web + iOS) sorted by urgency and age; answering a question closes it and
notifies the asking agent. A filed question also appears in the asking agent's DM
(reuse existing chat), so nothing about today's flow is lost.

## Non-Goals

- Threaded multi-turn Q&A (a question has one body + one answer; follow-ups are
  new questions or normal DM). 
- Agent-to-agent questions (this is agent→General). 
- Replacing `send_message` for general comms — only structured questions.

## Users & Roles

- **Asking agent** (Layer 3/4): files a question when blocked on a decision only
  the General can make.
- **The General / coordinator** (answerer): triages and answers open questions.

## User Stories

### US1 — Agent files a structured question (Priority: P1) → sub-epic adj-181.2
As an agent, I can file a question to the General via an MCP tool so it is tracked
as a first-class, answerable item (not just a chat line).

**Acceptance criteria**
- `file_question({ body, urgency?, beadId? })` persists a question scoped to the
  agent's resolved project (server-side identity — the asker is NOT client-supplied)
  and returns `{ id, status:"open" }`.
- The filed question also posts a normal message into the asking agent's DM
  conversation (existing chat shows it), linked via `conversationId`.
- `urgency` defaults to `normal`; accepted: `low|normal|high|blocking`.
- Invalid/empty body returns a structured error; unknown session returns a clear error.

### US2 — Aggregated open-questions API + real-time (Priority: P1) → sub-epic adj-181.3
As a client (web/iOS), I can fetch and subscribe to open questions so a triage view
can render and update live.

**Acceptance criteria**
- `GET /api/questions?status=open|answered|dismissed&projectId=…` returns questions
  (default `open`), newest-blocking first.
- `POST /api/questions/:id/answer { body }` sets status `answered`, records
  `answeredBy` + `answeredAt`, and notifies the asking agent (message into its DM).
- `POST /api/questions/:id/dismiss` sets status `dismissed`.
- New questions and answers broadcast over WebSocket (`question:new`,
  `question:answered`, `question:dismissed`) so open views update without refresh.
- `answer_question` and `list_questions` MCP tools mirror the REST behavior for the
  coordinator, honoring the `projectId` override for cross-project (adj-146 pattern).

### US3 — Web "Open Questions" triage view (Priority: P2) → sub-epic adj-181.4
As the General, I see all open agent questions in one web view, sorted by urgency
then age, and can answer or dismiss inline.

**Acceptance criteria**
- Aggregated list across all agents; grouping/sort: blocking → high → normal → low,
  then oldest-first within a tier.
- Each row shows asking agent, project, urgency, age, body, and an inline answer box
  + dismiss action.
- Answering/dismissing updates the list live (WS); the row leaves the open view.
- Retro terminal / Pip-Boy theme (`.claude/rules/05-ui-theme.md`); built via the
  `frontend-design` skill. Keyboard-navigable.

### US4 — iOS "Open Questions" screen (Priority: P2) → sub-epic adj-181.5
As the General on iOS, I have the same aggregated open-questions screen + answer flow.

**Acceptance criteria**
- SwiftUI screen listing open questions (same sort), tap-to-answer + dismiss, live WS
  updates. Feature parity with web for triage + answer.
- iOS uses Swift Package Manager (auto-discovers `.swift` under `Adjutant/`); NO
  `.pbxproj` edits for files under `Adjutant/`.

## Cross-Cutting Requirements

- **Architecture**: routes → services → store. No business logic in routes; no DB
  access from routes. (`.claude/rules/04-architecture.md`)
- **Project identity**: `projectId` (UUID) is the only scoping key stored/filtered/
  emitted. Never `projectName`. MCP asker resolved server-side via session.
- **Testing (TDD, `.claude/rules/03-testing.md`)**: failing tests first. Min 3
  tests/service method, 2/MCP tool handler, 2/REST endpoint, 3/hook. Mock with REAL
  output shapes, not TS types (adj-067).
- **Reuse (Rule 9)**: link to existing conversation/message + WS infra; do not build
  a parallel delivery system.

## Success Criteria

- An agent files a question; it appears in the asking agent's DM AND in the
  aggregated open-questions view (web + iOS) within real-time latency.
- The General answers it once from the triage view; it leaves all open views and the
  asking agent receives the answer in its DM.
- Open questions are ordered so a blocking question is always at the top.
- `npm test` + coverage thresholds green; no `any`; zero lint warnings.
