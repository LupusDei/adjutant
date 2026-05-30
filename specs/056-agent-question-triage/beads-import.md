# Beads Import: Agent Question Triage (adj-181)

Root epic: **adj-181** (type=epic, P2)

## Hierarchy

| Bead | Title | Type | Pri | Depends on |
|---|---|---|---|---|
| adj-181 | Agent Question Triage | epic | 2 | — |
| adj-181.1 | Foundational: data model + question-store | epic | 2 | — |
| adj-181.2 | US1: MCP question tools (file/answer/list) | epic | 2 | adj-181.1 |
| adj-181.3 | US2: REST API + WS real-time | epic | 2 | adj-181.1 |
| adj-181.4 | US3: Web "Open Questions" triage view | epic | 2 | adj-181.3 |
| adj-181.5 | US4: iOS "Open Questions" screen | epic | 2 | adj-181.3 |
| adj-181.6 | Polish: acceptance + docs | epic | 3 | adj-181.4, adj-181.5 |

## Tasks

| T-ID | Bead | Title | Type | Depends on |
|---|---|---|---|---|
| T001a | adj-181.1.1 | Failing migration test (034 agent_questions) | task | — |
| T001b | adj-181.1.2 | Add migration 034-agent-questions.sql | task | adj-181.1.1 |
| T002a | adj-181.1.3 | Failing question-store tests (5 methods) | task | adj-181.1.2 |
| T002b | adj-181.1.4 | Implement question-store.ts | task | adj-181.1.3 |
| T003a | adj-181.1.5 | Failing AgentQuestion type/Zod tests | task | — |
| T003b | adj-181.1.6 | Add AgentQuestion types + Zod | task | adj-181.1.5 |
| T010a | adj-181.2.1 | Failing MCP question-tool tests | task | adj-181.1.4 |
| T010b | adj-181.2.2 | Implement mcp-tools/questions.ts | task | adj-181.2.1 |
| T011  | adj-181.2.3 | Register question MCP tools (TDD) | task | adj-181.2.2 |
| T020a | adj-181.3.1 | Failing questions-routes tests | task | adj-181.1.4 |
| T020b | adj-181.3.2 | Implement routes/questions.ts | task | adj-181.3.1 |
| T021  | adj-181.3.3 | Register questions router (TDD) | task | adj-181.3.2 |
| T022a | adj-181.3.4 | Failing WS broadcast tests | task | adj-181.1.4 |
| T022b | adj-181.3.5 | Wire WS question broadcasts | task | adj-181.3.4 |
| T030a | adj-181.4.1 | Failing useOpenQuestions hook tests | task | adj-181.3.2 |
| T030b | adj-181.4.2 | Implement hook + api.ts methods | task | adj-181.4.1 |
| T031  | adj-181.4.3 | Build OpenQuestionsView.tsx (TDD) | task | adj-181.4.2 |
| T032  | adj-181.4.4 | Dashboard nav/route entry (TDD) | task | adj-181.4.3 |
| T040a | adj-181.5.1 | Failing APIClient+Questions tests (iOS) | task | adj-181.3.2 |
| T040b | adj-181.5.2 | Implement APIClient+Questions.swift | task | adj-181.5.1 |
| T041a | adj-181.5.3 | Failing OpenQuestionsViewModel tests | task | adj-181.5.2 |
| T041b | adj-181.5.4 | Implement OpenQuestionsViewModel.swift | task | adj-181.5.3 |
| T042  | adj-181.5.5 | Build OpenQuestionsView.swift (TDD) | task | adj-181.5.4 |
| T050  | adj-181.6.1 | E2E acceptance test (file→triage→answer) | task | adj-181.4.4, adj-181.5.5 |
| T051  | adj-181.6.2 | Docs: architecture + CLAUDE.md | task | adj-181.6.1 |

Total: 1 root + 6 sub-epics + 25 tasks = **32 beads**.
