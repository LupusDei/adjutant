# Tasks: Agent Question Triage (adj-181)

Markers: `[P]` = parallelizable (different files, no dep); `[US#]` = user story;
`[setup]`/`[docs]`/`[scaffold]` = TDD-exempt. Every other task is TDD-shaped
(failing tests first → confirm RED → implement → GREEN).

## Phase 1 (adj-181.1) — Foundational: data model + store

- [ ] T001a [P] Write failing migration test in `backend/tests/unit/database-migration-questions.test.ts`
      asserting the `agent_questions` table, all columns (incl. `context`, `category`,
      `suggested_options`, `chosen_option`), CHECK constraints, and the FOUR indexes
      (status, project, category, agent) exist after `runMigrations`. Confirm RED.
- [ ] T001b Add `backend/src/services/migrations/034-agent-questions.sql` (full schema per
      plan.md — including `context`/`category`/`suggested_options`/`chosen_option` and the
      category+agent indexes) and wire it into the migration runner until T001a is GREEN.
- [ ] T002a [P] Write failing tests in `backend/tests/unit/question-store.test.ts` for
      `question-store.ts` — for EACH method (`fileQuestion`, `answerQuestion`,
      `dismissQuestion`, `listQuestions`, `getQuestion`) cover happy path, error path,
      edge case (≥3 each); use real row shapes via real inserts. Include: `fileQuestion`
      persists `context`/`category`/`suggestedOptions` (JSON round-trip); `answerQuestion`
      accepts `chosenOption` OR `answerBody` and rejects when both absent / when
      `chosenOption` ∉ `suggestedOptions`; `listQuestions` filters by
      `category`/`agentId`/`urgency` and sorts blocking→…→low then oldest-first. Confirm RED.
- [ ] T002b Implement `backend/src/services/question-store.ts` (createQuestionStore +
      the five methods, projectId-scoped, with the context/options/answer-contract logic)
      until T002a is GREEN. No paths beyond tests.
- [ ] T003a [P] Write failing tests in `backend/tests/unit/question-types.test.ts` for
      the `AgentQuestion` Zod schema + `urgency`/`status`/`category` enums and the
      `suggestedOptions` (array of non-empty strings) + answer-contract refinement
      (`chosenOption` XOR/AND `answerBody`, at least one) — valid parse + reject bad enum
      + reject empty/duplicate options. Confirm RED.
- [ ] T003b Add `AgentQuestion` types + Zod schemas (incl. `context`, `category`,
      `suggestedOptions`, `chosenOption`) to `backend/src/types/index.ts` until T003a is GREEN.

## Phase 2 (adj-181.2) — US1: MCP tools (depends on adj-181.1)

- [ ] T010a [P] [US1] Write failing tests in `backend/tests/unit/mcp-questions.test.ts`
      for `file_question`, `answer_question`, `list_questions` (≥2/tool: success +
      validation/identity error). Assert asker is server-resolved (not client-supplied)
      and projectId override works; `file_question` accepts `context`/`category`/
      `suggestedOptions`; `answer_question` accepts `{ answerBody?, chosenOption? }` with
      the one-of + option-membership rule; `list_questions` honors category/agent/urgency
      filters. Confirm RED.
- [ ] T010b [US1] Implement `backend/src/services/mcp-tools/questions.ts` (the three
      handlers; file_question also mirrors the question into the asker's DM via the
      message/conversation store; answer_question carries the chosen option/text into the
      asker DM) until T010a is GREEN.
- [ ] T011 [US1] Register the question MCP tools in the MCP tool wiring
      (`backend/src/services/mcp-server.ts` / tool registration). Phases: write a
      failing registration test first (tools present on the server) → RED → wire → GREEN.

## Phase 3 (adj-181.3) — US2: REST + WS real-time (depends on adj-181.1)

- [ ] T020a [P] [US2] Write failing tests in `backend/tests/unit/questions-routes.test.ts`
      for `GET /api/questions` (status/project/category/agent/urgency filters + sort),
      `POST /api/questions/:id/answer` (accepts `{ answerBody?, chosenOption? }`; 400 when
      both absent or `chosenOption` ∉ options), `POST /api/questions/:id/dismiss`
      (≥2/endpoint: success + error). Confirm RED.
- [ ] T020b [US2] Implement `backend/src/routes/questions.ts` (thin handlers → service;
      filter + answer-contract validation via Zod at the boundary) until T020a is GREEN.
      No DB access in the route.
- [ ] T021 [US2] Register the questions router in the app. Phases: failing route-mount
      test first → RED → mount in `backend/src/index.ts` → GREEN.
- [ ] T022a [P] [US2] Write failing tests in `backend/tests/unit/ws-questions-broadcast.test.ts`
      asserting `question:new`/`question:answered`/`question:dismissed` are broadcast on
      file/answer/dismiss. Confirm RED.
- [ ] T022b [US2] Wire the broadcasts into `backend/src/services/ws-server.ts` +
      service hooks until T022a is GREEN.
- [ ] T023a [P] [US2] Write failing tests in `backend/tests/unit/question-push-notification.test.ts`
      asserting that filing a question enqueues an APNS push (via the existing
      `apns-service`/`notification-queue`) with asker + urgency + truncated body and a
      deep-link payload to the Open Questions screen; blocking/high always enqueue,
      normal/low respect notification prefs; no push on answer/dismiss. Mock the APNS
      sender with its REAL call shape (adj-067). Confirm RED.
- [ ] T023b [US2] Wire the `question:new` push trigger in the question service/notification
      path (reuse `apns-service.ts` + `notification-queue.ts`; do NOT build a new sender)
      until T023a is GREEN.

## Phase 4 (adj-181.4) — US3: Web triage view (depends on adj-181.3)

- [ ] T030a [P] [US3] Write failing tests in `frontend/tests/unit/useOpenQuestions.test.ts`
      for the hook (initial load, live WS update add/remove, answer via chosenOption AND via
      free text, category/agent/urgency filter state, answer/dismiss error state) — ≥3.
      Confirm RED.
- [ ] T030b [US3] Implement `frontend/src/hooks/useOpenQuestions.ts` + the API methods in
      `frontend/src/services/api.ts` (list with filters, answer with `{ answerBody?,
      chosenOption? }`, dismiss) until T030a is GREEN.
- [ ] T031 [US3] Build `frontend/src/components/questions/OpenQuestionsView.tsx` (+ css)
      — aggregated, urgency→age sorted, each row showing context (expandable) + category
      chip + suggested-option one-tap buttons + free-text answer box + dismiss; a filter
      bar (category/agent/urgency); live updates via the hook. Use the `frontend-design`
      skill; Pip-Boy theme. Phases: failing render/interaction tests first in
      `frontend/tests/unit/open-questions-view.test.tsx` (renders rows + context + options,
      clicking an option answers, free-text answer calls API, answered row leaves list,
      filter narrows list) → RED → implement → GREEN.
- [ ] T032 [US3] Add the Open Questions entry point to the dashboard nav/route. Phases:
      failing test that the route renders the view → RED → wire → GREEN.

## Phase 5 (adj-181.5) — US4: iOS triage screen (depends on adj-181.3)

- [ ] T040a [P] [US4] Write failing tests in
      `ios/AdjutantKit/Tests/AdjutantKitTests/APIClientQuestionsTests.swift` for
      `APIClient+Questions` (list/answer/dismiss decode + request shape). Confirm RED.
- [ ] T040b [US4] Implement
      `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Questions.swift` until
      T040a is GREEN. (SPM auto-discovers; NO `.pbxproj` edits under `Adjutant/`.)
- [ ] T041a [P] [US4] Write failing tests in
      `ios/AdjutantTests/Features/Questions/OpenQuestionsViewModelTests.swift` for the
      view model (load, sort order, live update, answer via chosenOption AND free text,
      category/agent/urgency filtering, dismiss). Confirm RED.
- [ ] T041b [US4] Implement
      `ios/Adjutant/Sources/Features/Questions/ViewModels/OpenQuestionsViewModel.swift`
      until T041a is GREEN.
- [ ] T042 [US4] Build `ios/Adjutant/Sources/Features/Questions/OpenQuestionsView.swift`
      (SwiftUI list showing context + category + suggested-option quick-pick + free-text
      answer; answer/dismiss flow; live WS; opened via the new-question APNS deep-link).
      Phases: failing layout/interaction test first in
      `ios/AdjutantTests/Features/Questions/OpenQuestionsViewLayoutTests.swift`
      → RED → implement → GREEN. SPM auto-discovery; NO `.pbxproj` edits under `Adjutant/`.

## Phase 6 (adj-181.6) — Polish: acceptance + docs

- [ ] T050 [US2] End-to-end acceptance test in
      `backend/tests/acceptance/agent-question-triage.acceptance.test.ts`: file_question
      → appears in list + asker DM → answer → status answered + leaves open list + asker
      notified. Phases: write the failing acceptance test first → RED → make green against
      the implemented stack.
- [ ] T051 [docs] Document the question-triage model in `.claude/rules/04-architecture.md`
      and `CLAUDE.md` (data flow + the reuse-of-DM decision).

## Phase 7 (adj-181.7) — Adoption: mandate the queue in agent startup instructions (depends on adj-181.2, adj-181.3)

- [ ] T060a [P] [US5] Write a failing test in `cli/tests/prime.test.ts` (or the existing
      prime generator test) asserting the generated Adjutant prime/protocol text contains
      the MANDATORY `file_question` routing requirement — covering BOTH questions for the
      General AND blocking tasks/actions the General must complete (mentions `file_question`,
      the body+context+urgency+suggestedOptions params, and the "do NOT bury in send_message
      / no AskUserQuestion / no stdin-block" guardrail). Confirm RED.
- [ ] T060b [US5] Update the prime GENERATOR `cli/lib/prime.ts` so its output mandates
      routing through `file_question` everything an agent needs from the General — both
      questions AND user-blocking tasks/actions (precise wording + a concrete tool-call
      example for each), then regenerate the outputs (`.adjutant/PRIME.md`, `.beads/PRIME.md`,
      `backend/.adjutant/PRIME.md`) via the prime command, until T060a is GREEN. Do NOT
      hand-edit generated `.md` files.
- [ ] T061 [docs] Amend constitution Rule 5 (Agent Communication) in `constitution.md` to
      name `file_question` as the required channel for anything an agent needs from the
      General — questions AND user-blocking tasks/actions — governance: increment version,
      add rationale, and propagate the wording to dependent templates.
- [ ] T062 [docs] Update spawn-prompt templates that carry question-routing rules —
      `.claude/skills/squad-execute/SKILL.md` and the `epic-planner` "Question Routing"
      section — to instruct spawned teammates to file questions via `file_question`.
