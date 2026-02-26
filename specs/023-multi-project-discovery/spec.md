# Feature Specification: Multi-Project Discovery & Agent Spawning

**Feature Branch**: `023-multi-project-discovery`
**Created**: 2026-02-25
**Status**: Draft

## Problem Statement

Adjutant is intended to be the command center for ALL projects a user works on, not just its own repo. The user should be able to start Adjutant in any directory, have it discover sub-directory projects (git repos, bead repos), query/create beads within those projects, and spawn agents to work on code in any discovered project.

The backend already has ~60% of the infrastructure (project registry, beads targeting via bd-client, agent spawning with projectPath, workspace abstraction). The critical gaps are:
1. MCP tools are project-agnostic — agents can't scope beads operations to their project
2. Frontend has no project navigation despite api.projects.list() existing
3. discoverLocalProjects() only checks for .git/, not .beads/
4. Workspace provider is a singleton, not per-project

## Assumptions

- **Single Adjutant instance**: One Adjutant server manages multiple projects (not one server per project)
- **Beads per project**: Each project has its own `.beads/` directory; cross-project bead queries aggregate results
- **Agent scoping**: When an agent connects via MCP, it should be scoped to the project it was spawned for
- **Discovery scope**: Scan immediate children + one level deep (not recursive to avoid performance issues)
- **Active project**: The "active project" concept remains for the default context, but all projects are queryable
- **Backward compatibility**: Existing GasTown mode and single-project workflows must continue working
- **No new dependencies**: Use existing bd CLI, workspace providers, and project registry — extend, don't replace

## User Scenarios & Testing

### User Story 1 - MCP Project Context (Priority: P1)

When an agent is spawned for a specific project, all its MCP tool calls (list_beads, create_bead, etc.) should automatically scope to that project's beads database without the agent needing to know or specify the directory.

**Why this priority**: This is the core gap. Without project-scoped MCP, agents in different projects all hit the same beads DB, making multi-project work impossible.

**Independent Test**: Spawn two agents for different projects. Each calls `list_beads()`. Verify they see different bead sets matching their respective project's `.beads/`.

**Acceptance Scenarios**:

1. **Given** an agent spawned for project A, **When** it calls `list_beads()` via MCP, **Then** it receives only beads from project A's `.beads/` directory
2. **Given** an agent spawned for project B, **When** it calls `create_bead()` via MCP, **Then** the bead is created in project B's `.beads/`, not Adjutant's
3. **Given** an agent with no project context (legacy), **When** it calls bead tools, **Then** behavior falls back to current workspace singleton (backward compatible)

---

### User Story 2 - Enhanced Project Discovery (Priority: P1)

Adjutant discovers projects by scanning for both git repos and bead repos in configurable directories, registering them automatically with correct metadata.

**Why this priority**: Discovery is the entry point — without it, users must manually register every project.

**Independent Test**: Place Adjutant's working directory above several git repos (some with .beads/, some without). Call discover endpoint. Verify all repos found, beads status correctly identified.

**Acceptance Scenarios**:

1. **Given** a directory with 3 child git repos (2 with .beads/, 1 without), **When** discover is called, **Then** all 3 are registered with `hasBeads: true/false` metadata
2. **Given** a previously discovered project that gained .beads/ since last scan, **When** re-discover is called, **Then** its metadata is updated
3. **Given** a directory with nested repos (child/grandchild), **When** discover is called with depth=2, **Then** both levels are found

---

### User Story 3 - Frontend Project Navigation (Priority: P2)

The dashboard shows a project list/switcher so the user can browse all registered projects, see their beads overview, and scope the UI to a specific project.

**Why this priority**: Enables the user to visually manage multi-project state. Depends on US1/US2 backend work.

**Independent Test**: Register 3 projects. Open dashboard. Verify project list shows all 3 with bead counts. Click one — beads view filters to that project.

**Acceptance Scenarios**:

1. **Given** 3 registered projects, **When** user opens the dashboard, **Then** a project selector is visible showing all projects with status indicators
2. **Given** the user selects project B, **When** they view beads, **Then** only project B's beads are shown
3. **Given** the user selects "All Projects", **When** they view beads, **Then** beads from all projects are shown with source labels

---

### User Story 4 - Cross-Project Agent Spawning (Priority: P2)

From the dashboard, users can spawn agents targeted at any registered project, and the agent automatically inherits that project's context.

**Why this priority**: Completes the loop — discover, view, and act on any project from one place.

**Independent Test**: From Adjutant dashboard, spawn an agent for project X. Verify agent's MCP session is scoped to project X. Agent creates a bead — verify it appears in project X's beads.

**Acceptance Scenarios**:

1. **Given** a registered project X, **When** user spawns an agent for it, **Then** agent's tmux session starts in project X's directory
2. **Given** a spawned agent for project X, **When** it connects via MCP, **Then** its session metadata includes projectId and projectPath
3. **Given** an agent spawned for project X, **When** it calls create_bead, **Then** bead appears in project X's `.beads/`

---

### Edge Cases

- What happens when a project's directory is deleted/moved after registration? Return stale indicator, don't crash.
- What if two projects have the same beads prefix? Prefix collisions handled by project scoping — each project is isolated.
- What if bd CLI is not installed in a project? Mark project as `hasBeads: false`, disable bead operations for it.

## Requirements

### Functional Requirements

- **FR-001**: System MUST discover git repositories in configurable scan directories
- **FR-002**: System MUST detect `.beads/` presence in discovered projects
- **FR-003**: MCP bead tools MUST scope operations to the agent's project context
- **FR-004**: MCP session metadata MUST include projectId when agent is project-scoped
- **FR-005**: Frontend MUST display a project list with bead status indicators
- **FR-006**: Frontend MUST allow scoping beads/epics views to a selected project
- **FR-007**: Agent spawning MUST accept a target projectId and pass context through to MCP
- **FR-008**: System MUST maintain backward compatibility with legacy (non-project-scoped) agents

### Key Entities

- **Project**: id, name, path, gitRemote, mode, hasBeads, active, sessions[], createdAt
- **ProjectContext**: projectId, projectPath, beadsDir — carried through MCP session
- **BeadSource**: name, path, hasBeads, projectId — enhanced with project linkage

## Success Criteria

- **SC-001**: Two agents in different projects see isolated bead sets via MCP tools
- **SC-002**: Discovery finds all git repos within 2 levels of scan root
- **SC-003**: Frontend project switcher loads in <500ms with 10+ projects
- **SC-004**: Zero regression in existing single-project and GasTown workflows
