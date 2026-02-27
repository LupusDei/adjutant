# Feature Specification: Decompose beads-repository.ts into Focused Modules

**Feature Branch**: `021-beads-repository-decompose`
**Created**: 2026-02-25
**Status**: Draft
**Proposal**: `d5654fb1`

## User Scenarios & Testing

### User Story 1 - Zero Breaking Changes (Priority: P1)

All existing imports, function signatures, and barrel exports continue working identically after decomposition. No route handler, test file, or consuming module requires changes.

**Why this priority**: Breaking existing functionality provides negative value. This is the foundational constraint.

**Independent Test**: Run full test suite (`npm run build && npm test` in backend/). All existing tests pass. All API endpoints return identical responses.

**Acceptance Scenarios**:

1. **Given** the existing test suite (beads-repository.test.ts, beads-filter.test.ts, beads-sorter.test.ts, beads-dependency.test.ts, beads-routes.test.ts, beads-graph-route.test.ts, mcp-beads.test.ts), **When** decomposition is complete, **Then** all tests pass
2. **Given** barrel `services/beads/index.ts`, **When** modules are decomposed, **Then** all existing exports resolve correctly via re-exports from new modules
3. **Given** the build pipeline, **When** decomposed modules compile, **Then** zero new type errors

---

### User Story 2 - Eliminate Inline Duplication (Priority: P1)

Functions in beads-repository.ts that duplicate logic already extracted into beads-filter.ts, beads-sorter.ts, and beads-dependency.ts are replaced with imports from those modules. New shared helpers (buildDatabaseList, resolveBeadDatabase) centralize repeated patterns.

**Why this priority**: Duplication is the primary maintenance burden and the reason for this refactoring.

**Independent Test**: Grep for inline Set-based dedup, inline wisp filtering, and inline priority sort patterns in the new modules — they should not exist. All callers use the shared helpers.

**Acceptance Scenarios**:

1. **Given** 5 inline wisp filter occurrences, **When** refactored, **Then** all use `excludeWisps()` from beads-filter.ts
2. **Given** 3 inline deduplication patterns, **When** refactored, **Then** all use `deduplicateById()` from beads-filter.ts
3. **Given** 3 inline priority+date sort patterns, **When** refactored, **Then** all use `sortByPriorityThenDate()` from beads-sorter.ts
4. **Given** 3 repeated multi-db aggregation patterns, **When** refactored, **Then** all use `buildDatabaseList()` from beads-database.ts
5. **Given** 4 inline database resolution patterns (getBead, getEpicChildren, listEpicsWithProgress), **When** refactored, **Then** all use `resolveBeadDatabase()` from beads-database.ts

---

### User Story 3 - Unify autoCompleteEpics (Priority: P2)

The duplicated `autoCompleteEpics()` in mcp-tools/beads.ts is removed and replaced with an import from the beads barrel. This also fixes the missing event bus emission bug in the MCP version.

**Why this priority**: Synchronization risk — business logic changes must be applied in two places today.

**Independent Test**: Verify mcp-tools/beads.ts has no local `autoCompleteEpics` function. Verify that closing a bead via MCP emits `bead:closed` events.

**Acceptance Scenarios**:

1. **Given** the MCP `close_bead` tool, **When** it triggers auto-completion, **Then** `bead:closed` events are emitted (previously missing)
2. **Given** `autoCompleteEpics()` in the barrel, **When** called with no arguments, **Then** it defaults to workspace root (backward compatible with MCP usage)

---

### Edge Cases

- What if a bead ID has no prefix (empty string before `-`)? `resolveBeadDatabase` returns an error.
- What if the prefix map hasn't been built yet? `ensurePrefixMap()` builds it lazily before any operation.
- What if all databases fail during multi-db aggregation? Return the first error (existing behavior preserved).

## Requirements

### Functional Requirements

- **FR-001**: The beads-repository.ts file MUST be deleted. All functions live in new focused modules.
- **FR-002**: The barrel index.ts MUST export the exact same public API (types + functions).
- **FR-003**: New modules MUST NOT introduce circular dependencies.
- **FR-004**: `autoCompleteEpics` parameters MUST become optional (default to workspace root).
- **FR-005**: The duplicate `parseStatusFilter` in beads-repository MUST be removed (beads-filter.ts is the source of truth).

## Success Criteria

- **SC-001**: beads-repository.ts no longer exists
- **SC-002**: `npm run build` exits 0
- **SC-003**: `npm test` — all existing tests pass
- **SC-004**: Total lines across new modules < 1,300 (down from 1,738)
- **SC-005**: No inline dedup/wisp/sort patterns in new modules (use pure helpers)
