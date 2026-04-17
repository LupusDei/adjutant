# Project Constitution v1.0.0

> MANDATORY — Every agent MUST obey every rule. Reject work that violates any rule.

## 1. Test-First Development

Write failing tests BEFORE implementation. Red, then Green, then Refactor.

- Minimum 3 tests per public method (happy path, error path, edge case)
- Minimum 2 tests per API endpoint or tool handler
- Coverage thresholds: 80% lines, 70% branches, 60% functions
- Mock data MUST use real output shapes, NOT type definitions
- All tests MUST pass before any commit

## 2. Type Safety

TypeScript strict mode (`"strict": true`). No exceptions.

- No `any` types without an explicit justification comment
- Runtime validation at all API boundaries
- Type assertions (`as`) require a comment explaining why it's safe

## 3. Build Verification

Every commit MUST pass build and tests.

- Zero lint warnings. Zero compile errors
- Run verification before every push
- CI gates are blocking — do NOT bypass or skip

## 4. Layered Architecture

Separate concerns: handlers, business logic, and data access.

- No business logic in request handlers
- No direct data access from handlers
- Changes in one module must not ripple into unrelated modules

## 5. Agent Communication

All agent communication goes through Adjutant MCP tools.

- `set_status()` when starting AND completing every task
- `send_message()` for all inter-agent communication
- Route questions via MCP — never block on stdin

## 6. Bead Discipline

Every piece of work is tracked via `bd` CLI.

- Self-assign before starting: `bd update <id> --assignee=<name> --status=in_progress`
- Every `in_progress` bead MUST have an assignee
- Wire parent-child dependencies immediately after creation

## 7. Agent Isolation

Concurrent agents MUST use worktree isolation.

- `isolation: "worktree"` on every teammate spawn that edits files
- Exception: read-only agents that never modify files

## 8. Simplicity

Start with the simplest implementation. Add abstractions only after 3+ duplications.

- No premature optimization — measure first
- If a fix feels hacky, ask: "Would I implement the elegant solution instead?"

## Enforcement

- Code review MUST verify adherence to these rules
- Violations create blocking bug beads
- CI gates are blocking, not advisory

## Governance

Amendments require: written rationale, version increment, propagation to templates.

**Ratified**: 2026-04-17 | **Version**: 1.0.0
