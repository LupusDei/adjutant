# Tasks: Persona Agent Files

**Epic**: `adj-oo3o`

- [ ] T001 Create `writeAgentFile()` utility with `sanitizePersonaName()` helper and TDD tests in `backend/src/services/agent-file-writer.ts` + `backend/tests/unit/agent-file-writer.test.ts`
- [ ] T002 Update `agents.ts` and `sessions.ts` spawn routes to call `writeAgentFile()` and pass `--agent <name>` in claudeArgs, removing `initialPrompt` persona injection in `backend/src/routes/agents.ts` + `backend/src/routes/sessions.ts`
- [ ] T003 Update spawn-persona integration tests to assert `--agent` flag and no `initialPrompt` in `backend/tests/unit/spawn-persona-integration.test.ts`
- [ ] T004 QA: edge case testing — special char names, missing dirs, concurrent deploys, file write failures, name collisions after sanitization in all affected files

## Dependencies

- T002 depends on T001 (needs writeAgentFile utility)
- T003 depends on T002 (tests must match new route behavior)
- T004 can start after T001 (QA can review utility independently, then routes)
