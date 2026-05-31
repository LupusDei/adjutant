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

**Scope of the entity**: a "question" here means *anything an agent needs from the
General* — both (a) a **question** the agent wants answered, and (b) a **task/action that
is blocking the agent and that only the General can complete** (provide a key/secret, grant
access, approve, make a call). The `category` distinguishes the two so the General can
triage "things I must answer" vs "things I must go do".

**Acceptance criteria**
- `file_question({ body, context?, category?, urgency?, suggestedOptions?, beadId? })`
  persists a question scoped to the agent's resolved project (server-side identity — the
  asker is NOT client-supplied) and returns `{ id, status:"open" }`.
- `context` is free-form rich framing authored by the agent (what it's doing, what it
  tried, the tradeoff / what it needs done) so the General can answer or act fast and
  accurately. `category` is a filterable bucket:
  `decision|clarification|approval|action_required|other` — where `action_required` marks
  a blocking task/action the General must complete (not merely answer).
- `suggestedOptions` (optional) is a list of agent-proposed answer choices the General
  can one-tap; stored as a JSON array and validated (each a non-empty string).
- The filed question also posts a normal message into the asking agent's DM
  conversation (existing chat shows it), linked via `conversationId`.
- `urgency` defaults to `normal`; accepted: `low|normal|high|blocking`.
- Invalid/empty body, or a malformed `suggestedOptions`, returns a structured error;
  unknown session returns a clear error.

### US2 — Aggregated open-questions API + real-time (Priority: P1) → sub-epic adj-181.3
As a client (web/iOS), I can fetch and subscribe to open questions so a triage view
can render and update live.

**Acceptance criteria**
- `GET /api/questions?status=open|answered|dismissed&projectId=…&category=…&agentId=…&urgency=…`
  returns questions (default `open`), blocking→high→normal→low then oldest-first.
  All filters are optional and composable.
- `POST /api/questions/:id/answer { answerBody?, chosenOption? }` requires at least one
  of the two; if `chosenOption` is present it MUST be one of the question's
  `suggestedOptions`. Sets status `answered`, records `answeredBy` + `answeredAt`, and
  notifies the asking agent (message into its DM) with the chosen option and/or text.
- `POST /api/questions/:id/dismiss` sets status `dismissed`.
- New questions and answers broadcast over WebSocket (`question:new`,
  `question:answered`, `question:dismissed`) so open views update without refresh.
- On `question:new`, an APNS push is enqueued (reusing `apns-service`/`notification-queue`)
  carrying asker + urgency + truncated body, deep-linking to the Open Questions screen.
  Blocking/high always push; normal/low respect existing notification prefs.
- `answer_question` and `list_questions` MCP tools mirror the REST behavior for the
  coordinator, honoring the `projectId` override for cross-project (adj-146 pattern).
  `answer_question` accepts `{ answerBody?, chosenOption? }` with the same one-of rule.

### US3 — Web "Open Questions" triage view (Priority: P2) → sub-epic adj-181.4
As the General, I see all open agent questions in one web view, sorted by urgency
then age, and can answer or dismiss inline.

**Acceptance criteria**
- Aggregated list across all agents; grouping/sort: blocking → high → normal → low,
  then oldest-first within a tier.
- Each row shows asking agent, project, urgency, age, body, the agent-authored
  **context** (expandable), and the **category** chip. Inline answer affordance:
  any `suggestedOptions` render as one-tap answer buttons, plus a free-text box;
  picking an option or submitting text answers the question. Dismiss action present.
- A filter bar narrows the list by category, agent, and urgency (composable).
- Answering/dismissing updates the list live (WS); the row leaves the open view.
- Retro terminal / Pip-Boy theme (`.claude/rules/05-ui-theme.md`); built via the
  `frontend-design` skill. Keyboard-navigable.

### US4 — iOS "Open Questions" screen (Priority: P2) → sub-epic adj-181.5
As the General on iOS, I have the same aggregated open-questions screen + answer flow.

**Acceptance criteria**
- SwiftUI screen listing open questions (same sort), showing context + category +
  suggested-option quick-pick + free-text answer, tap-to-answer + dismiss, live WS
  updates. Feature parity with web for triage + answer.
- A new-question APNS push (Phase 3) deep-links into this screen.
- iOS uses Swift Package Manager (auto-discovers `.swift` under `Adjutant/`); NO
  `.pbxproj` edits for files under `Adjutant/`.

### US5 — Mandate the queue in agent startup instructions (Priority: P1) → sub-epic adj-181.7
As the General, I need EVERY agent to know the queue exists and be *required* to route
their questions through it — a tool nobody uses serves no purpose. Adoption is enforced
at agent startup (the Adjutant prime/protocol) and in the constitution, not left to chance.

**Scope of the mandate**: anything an agent needs FROM the General MUST be filed via
`file_question` — both (a) questions that need a decision/answer AND (b) tasks/actions that
are blocking the agent and that only the General can complete (provide a key, grant access,
approve, make a call). `send_message` remains for general comms and for *replying* to the
General; `set_status({blocked})` still signals blockage but is NOT a substitute for filing
the blocking item in the queue. The queue is the single front door for "the agent needs
something from the General."

**Acceptance criteria**
- The generated Adjutant prime/protocol (`cli/lib/prime.ts` → `.adjutant/PRIME.md` and the
  other generated copies) states a clear, precise, MANDATORY requirement: route all
  agent→General questions through `file_question`, with `body` + agent-authored `context`
  + `urgency` + optional `suggestedOptions`. Includes a concrete tool-call example and the
  explicit "do NOT bury questions in send_message / do NOT use AskUserQuestion / do NOT
  block on stdin" guardrails.
- Constitution **Rule 5 (Agent Communication)** is amended to name `file_question` as the
  required channel for questions (governance: version increment + rationale + propagation
  to dependent templates, per the Governance section).
- Spawn-prompt templates that carry question-routing rules (`squad-execute`,
  `epic-planner` "Question Routing") instruct spawned teammates to use `file_question`.
- This sub-epic is gated on the tool being live (depends on adj-181.2 MCP tools and
  adj-181.3 answer path) — we never instruct agents to use a tool that isn't deployed.
- TDD where testable: a test asserts the generated prime text contains the `file_question`
  mandate (so the instruction can't silently regress).

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
- A freshly-booted agent, reading only the Adjutant prime/protocol, knows it MUST file
  questions via `file_question` — adoption does not depend on tribal knowledge.
- `npm test` + coverage thresholds green; no `any`; zero lint warnings.
