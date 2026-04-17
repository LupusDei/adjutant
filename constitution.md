# Project Constitution v1.0.0

> MANDATORY — Every agent MUST obey every rule. Reject work that violates any rule.

## 1. Test-First Development

Write failing tests BEFORE implementation. Red, then Green, then Refactor.

- Minimum 3 tests per public method (happy path, error path, edge case)
- Minimum 2 tests per API endpoint or MCP tool handler
- Coverage thresholds: 80% lines, 70% branches, 60% functions
- Mock data MUST use real CLI/API output shapes, NOT TypeScript type definitions
- `npm test` MUST pass before any commit. NEVER use bare `vitest` (starts watch mode)

## 2. Type Safety

TypeScript strict mode (`"strict": true`). No exceptions.

- No `any` types without an explicit justification comment
- Runtime validation via Zod at all API boundaries
- Type assertions (`as`) require a comment explaining why it's safe

## 3. Build Verification

Every commit MUST pass: `npm run build` (lint + compile) and `npm test`.

- Zero lint warnings. Zero TypeScript errors
- Run `scripts/verify-before-push.sh` before every push
- CI gates are blocking — do NOT bypass or skip

## 4. Layered Architecture

Routes handle HTTP. Services hold business logic. Stores manage data.

- No business logic in route handlers
- No direct database access from routes
- No cross-layer imports that skip a layer
- Changes in one module must not ripple into unrelated modules

## 5. Agent Communication

All agent communication goes through Adjutant MCP tools. Text output alone is invisible.

- `set_status()` when starting AND completing every task (always include `task` field)
- `send_message()` for all inter-agent and agent-to-user communication
- Route questions via MCP — never use `AskUserQuestion` or block on stdin
- Agents MUST complete the Boot Sequence before any work

## 6. Bead Discipline

Every piece of work is tracked via `bd` CLI. No exceptions.

- Self-assign before starting: `bd update <id> --assignee=<name> --status=in_progress`
- Every `in_progress` bead MUST have an assignee — unassigned beads are a bug
- Use sequential numeric IDs (`adj-057`, NOT auto-generated hashes)
- Wire parent-child dependencies immediately after creation

## 7. Agent Isolation

Concurrent agents MUST use worktree isolation. Shared directories cause silent data loss.

- `isolation: "worktree"` on every teammate spawn that edits files
- Exception: read-only agents (Explore, Plan) that never use Edit/Write
- Agents in worktrees push branches — squad leaders merge from main repo

## 8. Project Scoping

Agents stay within their assigned project. Cross-project work is forbidden.

- Verify agent's active project before assigning work, messaging, or nudging
- Create beads in the correct project's `.beads/` database
- Never borrow agents from another project — spawn new ones

## 9. Simplicity

Start with the simplest implementation. Add abstractions only after 3+ duplications.

- No premature optimization — measure first, optimize second
- Configuration options only when multiple valid use cases exist
- If a fix feels hacky, ask: "Would I implement the elegant solution instead?"

## Enforcement

- Code review MUST verify adherence to these rules
- Violations create blocking bug beads — work cannot close until fixed
- CI gates (build, lint, test, coverage) are blocking, not advisory
- The QA Sentinel enforces ALL rules; engineers enforce Rules 1, 3; reviewers enforce Rules 2, 4

## Governance

Amendments require: written rationale, version increment, propagation to templates.
Memory corrections that recur 3+ times MUST be promoted to constitutional rules.

**Ratified**: 2026-04-17 | **Version**: 1.0.0
