# Feature Specification: Agent Role Taxonomy

**Feature Branch**: `039-agent-role-taxonomy`
**Created**: 2026-03-09
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Role-aware behavior dispatch (Priority: P1)

As a system operator, I want behaviors to automatically skip coordinator agents so that coordinator-specific bugs (like adj-xtju) are structurally impossible.

**Why this priority**: Prevents a recurring class of P1 bugs — any new behavior that should skip coordinators currently requires discovering and hardcoding coordinator IDs independently.

**Independent Test**: Register a behavior with `excludeRoles: ["coordinator"]`, emit an event for a coordinator agent, verify act() is never called.

**Acceptance Scenarios**:

1. **Given** a behavior with `excludeRoles: ["coordinator"]`, **When** an event fires for agent "adjutant-core", **Then** the registry skips shouldAct() and act() entirely
2. **Given** a behavior with no `excludeRoles`, **When** an event fires for agent "adjutant-core", **Then** the behavior runs normally (backward compatible)
3. **Given** a behavior with `excludeRoles: ["coordinator"]`, **When** an event fires for agent "engineer-1", **Then** the behavior runs normally

---

### User Story 2 - Single source of truth for agent roles (Priority: P1)

As a developer adding new behaviors, I want to call `state.isCoordinator(agentId)` instead of maintaining my own hardcoded ID set.

**Why this priority**: Currently 3 separate files define coordinator IDs — drift between them is inevitable.

**Independent Test**: Call `state.isCoordinator("adjutant-core")` and verify it returns true. Call `state.isCoordinator("engineer-1")` and verify false.

**Acceptance Scenarios**:

1. **Given** an agent connects with ID "adjutant-core", **When** `isCoordinator()` is called, **Then** returns true
2. **Given** an agent connects with ID "engineer-5", **When** `isCoordinator()` is called, **Then** returns false
3. **Given** the 3 existing coordinator ID definitions, **When** migration is complete, **Then** all 3 use `state.isCoordinator()` or `excludeRoles`

---

### Edge Cases

- What happens when an agent connects with an unknown ID? → Defaults to "worker" role
- What happens when a behavior has `excludeRoles` but the event has no agent ID? → Skip role check, let behavior run
- What happens to existing coordinator ID constants? → Removed from idle-proposal-nudge.ts; signal-aggregator.ts and communication.ts migrated to use state.isCoordinator()

## Requirements

### Functional Requirements

- **FR-001**: System MUST support agent roles: "coordinator", "worker", "qa"
- **FR-002**: AgentProfile MUST include a `role` field persisted in SQLite
- **FR-003**: BehaviorRegistry MUST enforce `excludeRoles` before calling shouldAct()
- **FR-004**: Role MUST be inferred from known coordinator IDs on agent connect
- **FR-005**: Agents without explicit role MUST default to "worker"
- **FR-006**: Existing hardcoded coordinator ID sets MUST be replaced with role queries

## Success Criteria

- **SC-001**: Zero hardcoded coordinator ID sets remain in behavior files
- **SC-002**: Adding `excludeRoles: ["coordinator"]` to a behavior requires zero additional code
- **SC-003**: All existing tests pass with no regressions
