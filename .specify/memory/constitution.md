<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 (initial)
Modified principles: N/A (new constitution)
Added sections:
  - Core Principles (5 principles)
  - Development Standards
  - Quality Gates
  - Governance
Removed sections: N/A
Templates requiring updates: ✅ No updates required (new project)
Follow-up TODOs: None
-->

# Adjutant Constitution

## Core Principles

### I. Type Safety First

All code MUST be written in TypeScript with strict mode enabled (`"strict": true`).
External data from the gastown API MUST be validated at runtime boundaries using
type guards or schema validation (e.g., Zod). Type assertions (`as`) are
prohibited except when interfacing with untyped third-party libraries, and such
cases MUST include a comment explaining why the assertion is safe.

**Rationale**: The Adjutant UI interfaces with an external multi-agent
orchestration system. Type safety at boundaries prevents runtime errors when
the gastown API evolves or returns unexpected data.

### II. Test-First Development

Unit tests MUST be written before implementation for all business logic and
utility functions. Tests MUST fail initially (red), then pass after
implementation (green). Refactoring follows only after tests pass.

**Exceptions**: Pure UI components (styling, layout) do not require pre-written
tests, but interactive components with state MUST have tests.

**Rationale**: TDD catches integration issues early when building UI that
communicates with the gastown Mayor and displays crew member state.

### III. UI Performance

The UI MUST maintain 60fps during animations and transitions. Render-blocking
operations MUST be deferred or chunked. React state updates MUST be batched
where possible. Components MUST implement proper memoization for expensive
computations.

**Measurements**: Use React DevTools Profiler and Chrome Performance tab.
Animations MUST not cause frame drops below 30fps on mid-range hardware.

**Rationale**: The Pip-Boy aesthetic relies on smooth CRT-style animations and
scan-line effects. Choppy performance breaks the retro-futuristic immersion.

### IV. Documentation

Public functions and components MUST have JSDoc comments describing purpose,
parameters, and return values. Complex algorithms MUST include inline comments
explaining the approach. The README MUST be updated when adding user-facing
features.

**Exceptions**: Self-explanatory code (getters, simple handlers) does not
require documentation. Test files do not require JSDoc.

**Rationale**: Documentation enables future maintainers to understand the
gastown integration points and Pip-Boy theming decisions.

### V. Simplicity

Start with the simplest implementation that satisfies requirements. Add
abstractions only when duplication occurs three or more times. Premature
optimization is prohibited. Configuration options MUST be added only when
multiple valid use cases exist.

**Rationale**: The Adjutant UI has a focused purpose (Mayor mail, power
controls, crew stats). Over-engineering the presentation layer wastes effort
and adds maintenance burden.

## Development Standards

**Language/Framework**: TypeScript 5.x with React 18+ and Tailwind CSS
**Build System**: Vite (preferred) or Next.js for SSR if required
**Styling**: Tailwind CSS with custom Pip-Boy theme tokens
**State Management**: React Context for global state; local state preferred
**API Communication**: Fetch API with typed response handlers

**File Organization**:
- `src/components/` - React components (PascalCase)
- `src/hooks/` - Custom React hooks (camelCase with `use` prefix)
- `src/services/` - API communication and business logic
- `src/types/` - TypeScript type definitions
- `src/styles/` - Global styles and Tailwind config

## Quality Gates

All PRs MUST satisfy the following before merge:

1. TypeScript compiles with zero errors (`tsc --noEmit`)
2. All unit tests pass (`npm test`)
3. Linting passes with zero warnings (`npm run lint`)
4. No `any` types except with explicit justification comment
5. New components include basic unit tests for stateful logic

## Governance

This constitution supersedes all other practices for the Adjutant project.
Amendments require:

1. Written proposal documenting the change and rationale
2. Update to this file with version increment
3. Propagation of changes to affected templates

**Versioning**: MAJOR.MINOR.PATCH following semantic versioning:
- MAJOR: Principle removal or fundamental redefinition
- MINOR: New principle or substantial expansion
- PATCH: Clarifications, wording improvements

**Compliance**: Code review MUST verify adherence to these principles.
Violations MUST be corrected before merge or explicitly justified in the
Complexity Tracking section of the implementation plan.

**Version**: 1.0.0 | **Ratified**: 2026-01-11 | **Last Amended**: 2026-01-11
