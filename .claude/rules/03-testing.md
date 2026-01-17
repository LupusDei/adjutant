# Testing Rules

## TDD is Mandatory

**All development MUST follow Test-Driven Development. No exceptions.**

### The Red-Green-Refactor Cycle

1. **Red**: Write a failing test first
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Clean up while keeping tests green

### TDD Applies To

- Backend services (`mail-service`, `power-service`, `status-service`, `gt-executor`)
- Custom React hooks (`useMail`, `useGastownStatus`, `usePolling`)
- All new features and functionality
- Bug fixes (write a test that reproduces the bug first)
- API endpoints and request handlers

### Workflow for Each Task

```
1. Read the requirements
2. Write test(s) that verify expected behavior
3. Run tests - confirm they FAIL (Red phase)
4. Implement the minimum code to pass
5. Run tests - confirm they PASS (Green phase)
6. Refactor if needed, keeping tests green
7. Commit test + implementation together
```

### Enforcement

- PRs without tests for new functionality will be rejected
- Bug fixes must include a regression test
- Code coverage should not decrease

## What to Test

### Backend
- Service methods (mock `gt-executor` for unit tests)
- Request/response validation (Zod schemas)
- Error handling paths

### Frontend
- Custom hooks (state changes, API calls)
- Complex component logic (not pure UI styling)

## What NOT to Test

- Pure UI components (styling, layout only)
- Third-party library behavior
- Trivial getters/setters

## Test File Locations

```
backend/tests/unit/*.test.ts
frontend/tests/unit/*.test.ts
```

## Testing Tools

- **Framework**: Vitest
- **React Testing**: @testing-library/react
- **Mocking**: Vitest mocks

## Test Naming

```typescript
describe('MailService', () => {
  it('should return messages sorted by newest first', () => {})
  it('should throw when gt command fails', () => {})
})
```

## Mocking the GT Executor

For service tests, mock the `gt-executor`:

```typescript
vi.mock('../services/gt-executor', () => ({
  executeGt: vi.fn()
}))
```
