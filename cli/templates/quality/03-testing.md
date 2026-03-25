# Testing Rules

## Testing Mandate

Every new function, service, hook, endpoint, and tool handler MUST have tests. No exceptions. Code without tests does not merge.

## What to Test (Minimum Counts)

### Backend Service Method
Minimum **3 tests** per public method:
1. Happy path — valid input produces expected output
2. Error path — invalid input or dependency failure produces expected error
3. Edge case — boundary values, empty arrays, null fields, concurrent calls

### API Endpoint
Minimum **2 tests** per route handler:
1. Success response — valid request returns correct status code and body
2. Error response — invalid request returns structured error with correct status code

### React Hook
Minimum **3 tests** per hook:
1. Initial state — hook returns correct defaults before any action
2. State change — calling a hook method updates state correctly
3. Error handling — failed API call or invalid input puts hook in error state

### Bug Fix
**1 regression test** that reproduces the bug before the fix, then passes after.

## File Location Convention

```
backend/tests/unit/<module-name>.test.ts        # Backend unit tests
frontend/tests/unit/<module-name>.test.ts        # Frontend unit tests
backend/tests/integration/<boundary>.test.ts     # Backend integration tests
```

## Test Naming Convention

```typescript
describe('ModuleName', () => {
  it('should <behavior> when <condition>', () => {})
})
```

## Mocking Rules

1. **Mock external dependencies** — CLI tools, file system, network, databases
2. **Do NOT mock the module under test**
3. **Use real data shapes** — mock data must match actual CLI/API output, not just TypeScript type definitions

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
# 2. Write the failing test(s) — describe expected behavior
# 3. Run the test — confirm RED (fails)
# 4. Verify the test FAILS for the right reason (not a syntax error)
# 5. Implement the minimum code to make the test pass
# 6. Run the test again — confirm GREEN (passes)
# 7. Refactor if needed — run the test again to confirm still GREEN
# 8. Run the full suite to check for regressions: npm test
```

## Pre-Push Verification

Before every push, run the full verification:

```bash
npm run build     # Must exit 0
npm test          # Must pass
```

## What NOT to Test

- Pure UI components (styling, layout only — no logic)
- Third-party library behavior (test YOUR code, not theirs)
- Trivial getters/setters with no logic

## Testing Tools

- **Framework**: Vitest
- **React Testing**: @testing-library/react
- **Mocking**: Vitest built-in mocks (`vi.mock`, `vi.fn`, `vi.spyOn`)
