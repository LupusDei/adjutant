# Testing Rules

## Testing Mandate

Every new function, service, hook, endpoint, and tool handler MUST have tests. No exceptions. Code without tests does not merge.

## What to Test (Minimum Counts)

### Backend Service Method
Minimum **3 tests** per public method:
1. Happy path — valid input produces expected output
2. Error path — invalid input or dependency failure produces expected error
3. Edge case — boundary values, empty arrays, null fields, concurrent calls

### MCP Tool Handler
Minimum **2 tests** per tool:
1. Success — valid parameters produce correct result and side effects
2. Validation error — missing or invalid parameters return a structured error

### React Hook
Minimum **3 tests** per hook:
1. Initial state — hook returns correct defaults before any action
2. State change — calling a hook method updates state correctly
3. Error handling — failed API call or invalid input puts hook in error state

### API Endpoint
Minimum **2 tests** per route handler:
1. Success response — valid request returns correct status code and body
2. Error response — invalid request returns structured error with correct status code

### Bug Fix
**1 regression test** that reproduces the bug before the fix, then passes after.

## File Location Convention

```
backend/tests/unit/<module-name>.test.ts        # Backend unit tests
frontend/tests/unit/<module-name>.test.ts        # Frontend unit tests
backend/tests/integration/<boundary>.test.ts     # Backend integration tests
```

Examples:
- `backend/tests/unit/message-store.test.ts`
- `backend/tests/unit/mcp-messaging.test.ts`
- `frontend/tests/unit/useChatMessages.test.ts`
- `backend/tests/integration/mcp-agent-flow.test.ts`

## Test Naming Convention

```typescript
describe('ModuleName', () => {
  it('should <behavior> when <condition>', () => {})
})
```

Examples:
```typescript
describe('MessageStore', () => {
  it('should return messages sorted by newest first when limit is specified', () => {})
  it('should throw DatabaseError when connection is unavailable', () => {})
  it('should return empty array when no messages match the filter', () => {})
})
```

## Mocking Rules

1. **Mock external dependencies** — bd CLI, file system, network, databases
2. **Do NOT mock the module under test** — if you're testing `MessageStore`, do not mock `MessageStore`
3. **Use real data shapes from CLI output** — do NOT hand-craft mock objects from TypeScript type definitions

### Why Real Data Shapes Matter (adj-067 Lesson)

TypeScript types can be wrong. If tests mock data matching the TS interface instead of real CLI output, they test the assumption, not reality. The bug ships and lives for weeks.

**Correct approach:**
```bash
# Capture real output first
bd show adj-001 --format json > test-fixtures/bd-show-adj-001.json
```

```typescript
// Use real output shape in tests
const realBdShowOutput = {
  id: "adj-001",
  title: "Example epic",
  type: "epic",
  status: "open",
  dependencies: [
    { id: "adj-001.1", title: "Sub-task", dependency_type: "child" }  // Real shape from bd show
  ]
};
```

**Wrong approach:**
```typescript
// DON'T DO THIS — matches TS type, not real CLI output
const fakeBdShowOutput = {
  dependencies: [
    { issue_id: "adj-001", depends_on_id: "adj-001.1", type: "depends_on" }  // Wrong shape!
  ]
};
```

For standard Vitest mocking:
```typescript
vi.mock('../services/bd-client', () => ({
  executeBd: vi.fn()
}))
```

## Coverage Requirements

Coverage is enforced via `npm run test:coverage`:
- **Lines**: 80% minimum
- **Branches**: 70% minimum
- **Functions**: 60% minimum

Coverage is checked in CI. Code below threshold blocks merge.

## TDD Workflow (Step by Step)

Follow this exact sequence for every new feature or bug fix:

```bash
# 1. Create or open the test file
#    Backend: backend/tests/unit/<module>.test.ts
#    Frontend: frontend/tests/unit/<module>.test.ts

# 2. Write the failing test(s) — describe expected behavior

# 3. Run the test — confirm RED (fails)
cd backend && npx vitest run tests/unit/<module>.test.ts
# or for frontend:
cd frontend && npx vitest run tests/unit/<module>.test.ts

# 4. Verify the test FAILS for the right reason
#    (missing function, wrong return value — NOT a syntax error)

# 5. Implement the minimum code to make the test pass

# 6. Run the test again — confirm GREEN (passes)
cd backend && npx vitest run tests/unit/<module>.test.ts

# 7. Refactor if needed — run the test again to confirm still GREEN

# 8. Run the full suite to check for regressions
npm test        # from project root — runs backend + frontend tests
```

## Pre-Push Verification

Before every push, run the full verification:

```bash
# 1. Build (includes lint)
npm run build                    # Must exit 0

# 2. Run all tests
npm test                         # Must pass

# 3. Check coverage thresholds
npm run test:coverage            # Must meet: 80% lines, 70% branches, 60% functions
```

WIP branches are exempt from coverage thresholds but MUST still pass build + tests.

## What NOT to Test

- Pure UI components (styling, layout only — no logic)
- Third-party library behavior (test YOUR code, not theirs)
- Trivial getters/setters with no logic

## Task Structure in `tasks.md` (TDD-shaped)

Every implementation task in `specs/<###-feature>/tasks.md` MUST be authored
in a test-first shape. A task that says "Create file X with tests" expresses
the same step twice and erases the RED → GREEN cadence — that is not TDD.
The template enforces a split that makes the cadence reviewable.

### Two acceptable shapes

**Shape A — Split task (preferred for non-trivial work):**

```markdown
- [ ] T012a [US1] Write failing tests for ChatPanel.tsx open/close behavior
      in frontend/tests/unit/chat-panel.test.tsx — confirm RED
- [ ] T012b [US1] Implement ChatPanel.tsx in src/components/chat/chat-panel.tsx
      until T012a tests are GREEN
```

The Ta-tests / Tb-impl pair share a base number and a clear ordering:
Ta must be RED before Tb begins.

**Shape B — Single task with explicit phases (for small atomic tasks):**

```markdown
- [ ] T012 [US1] Add ChatPanel.tsx open/close behavior — write failing tests
      first in frontend/tests/unit/chat-panel.test.tsx (confirm RED), then
      implement in src/components/chat/chat-panel.tsx until GREEN.
```

The verbiage MUST include both a write-failing-tests-first phrase
("failing tests first", "write tests first", "RED first", "tests before
impl") AND a confirm-GREEN phrase. A single-line task that only mentions
"with tests" or "+ tests" does NOT satisfy this rule.

### What this rule does NOT require

- **Setup / scaffolding** tasks that have no behavior (e.g. "Add a new npm
  dependency", "Create empty directory structure") are exempt. Mark them
  with the inline tag `[setup]` so the audit script ignores them.
- **Documentation-only** tasks (e.g. "Write CHANGELOG.md entry") are
  exempt. Mark them `[docs]`.
- **Bug-fix** tasks already covered by the "Bug Fix" minimum above — the
  regression test IS the test-first phase. The task wording must still
  include "regression test first" or equivalent.

The auditor also recognizes `[scaffold]` for empty-file/directory creation
that a later task will fill.

### Audit

A warn-only lint script (`scripts/audit-tasks-md.ts`) walks
`specs/*/tasks.md` and flags tasks lacking the test-first phrasing. It
does NOT fail CI yet — existing tasks predate this rule and would
generate noise. Adopt this rule for ALL new tasks.md authored after
this rule lands; backfill is out of scope.

Run locally:

```bash
npx tsx scripts/audit-tasks-md.ts          # full report
npx tsx scripts/audit-tasks-md.ts --quiet  # exit code only
npx tsx scripts/audit-tasks-md.ts --json   # machine-readable
```

`tsx` lives in `backend/node_modules` — invoke via the backend prefix if
not installed at the repo root: `npx --prefix backend tsx ../scripts/audit-tasks-md.ts`.

The epic-planner skill (`skills/epic-planner/SKILL.md`) generates tasks.md
files that comply with this rule by default. Hand-authored tasks.md files
must follow the same shape.

## Testing Tools

- **Framework**: Vitest
- **React Testing**: @testing-library/react
- **Mocking**: Vitest built-in mocks (`vi.mock`, `vi.fn`, `vi.spyOn`)
