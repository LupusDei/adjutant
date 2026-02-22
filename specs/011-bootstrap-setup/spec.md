# Feature Specification: Adjutant Bootstrap & Developer Setup

**Feature Branch**: `011-bootstrap-setup`
**Created**: 2026-02-22
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Fresh Clone Bootstrap (Priority: P1, MVP)

A developer clones the adjutant repo for the first time. They run `adjutant init` and the command validates prerequisites, creates missing directories/files, installs dependencies, registers Claude Code hooks, and initializes the SQLite database. At the end, a clear summary shows what was set up.

**Why this priority**: Without bootstrap, every new user must manually create `.adjutant/`, `.mcp.json`, configure hooks, etc. This is the minimum viable delivery.

**Independent Test**: Clone a fresh copy of the repo, run `npm install -g .` then `adjutant init`, verify all artifacts exist.

**Acceptance Scenarios**:

1. **Given** a fresh clone with no `.adjutant/` dir, **When** user runs `adjutant init`, **Then** `.adjutant/PRIME.md` is created with agent protocol content
2. **Given** no `.mcp.json` at project root, **When** user runs `adjutant init`, **Then** `.mcp.json` is created with correct adjutant MCP server config
3. **Given** Claude Code hooks missing adjutant-prime entry, **When** user runs `adjutant init`, **Then** hooks are merged into `~/.claude/settings.json` without clobbering existing hooks
4. **Given** all prerequisites already exist, **When** user runs `adjutant init` again, **Then** nothing is overwritten and summary says "already configured"
5. **Given** backend dependencies not installed, **When** user runs `adjutant init`, **Then** `npm install` runs in backend/ and frontend/ directories

---

### User Story 2 - Health Check / Doctor (Priority: P1)

A developer or agent runs `adjutant doctor` to diagnose why something isn't working. The command checks every prerequisite and prints a pass/fail/warn report.

**Why this priority**: Essential for debugging setup issues, especially for agents that can't manually inspect.

**Independent Test**: Run `adjutant doctor` with backend server stopped, verify it reports the failure correctly.

**Acceptance Scenarios**:

1. **Given** backend server running on :4201, **When** `adjutant doctor` runs, **Then** health check shows PASS
2. **Given** backend server NOT running, **When** `adjutant doctor` runs, **Then** health check shows FAIL with "Backend not reachable on port 4201"
3. **Given** `bd` CLI not installed, **When** `adjutant doctor` runs, **Then** shows WARN "beads CLI not found"
4. **Given** `.mcp.json` missing, **When** `adjutant doctor` runs, **Then** shows FAIL with "run adjutant init"
5. **Given** all checks pass, **When** `adjutant doctor` runs, **Then** exit code is 0

---

### User Story 3 - Agent Auto-Protocol via Hooks (Priority: P1)

When a Claude Code agent starts a session in a project that has `.adjutant/PRIME.md`, the file content is automatically injected into the agent's context. This happens on session start and before context compaction. Agents automatically know to use MCP messaging, report status, and track beads.

**Why this priority**: This is the core motivation — agents must get the protocol automatically.

**Independent Test**: Start a Claude Code session in a directory with `.adjutant/PRIME.md`, verify the protocol appears in the session context.

**Acceptance Scenarios**:

1. **Given** `.adjutant/PRIME.md` exists in the project, **When** Claude Code starts a session, **Then** PRIME.md content is injected via SessionStart hook
2. **Given** context is about to compact, **When** PreCompact fires, **Then** PRIME.md content is re-injected
3. **Given** `.adjutant/PRIME.md` does NOT exist, **When** hooks fire, **Then** no output (silent no-op)
4. **Given** existing `bd prime` hooks, **When** `adjutant init` registers hooks, **Then** both hooks coexist (adjutant-prime added alongside bd prime)

---

### Edge Cases

- What if `~/.claude/settings.json` doesn't exist at all? Create it with just the hooks section.
- What if `~/.claude/settings.json` has hooks but no SessionStart? Add the SessionStart array.
- What if the adjutant hook is already registered? Skip it (idempotent).
- What if `.adjutant/PRIME.md` exists but is outdated? `adjutant init --force` overwrites it.
- What if the port 4201 is in use by something else? `adjutant doctor` checks /health specifically.

## Requirements

### Functional Requirements

- **FR-001**: `adjutant init` MUST be idempotent (safe to run multiple times)
- **FR-002**: `adjutant init` MUST NOT overwrite user-modified files without `--force`
- **FR-003**: `adjutant doctor` MUST return exit code 0 only if all critical checks pass
- **FR-004**: Hook registration MUST merge into existing hooks, not replace them
- **FR-005**: `.adjutant/` directory MUST be git-tracked (not gitignored)
- **FR-006**: PRIME.md MUST contain agent MCP messaging protocol, status reporting, and beads workflow
- **FR-007**: `adjutant` CLI MUST be installable globally via `npm install -g .`

### Key Entities

- **PRIME.md**: Agent protocol document injected into Claude Code sessions via hooks
- **Hook**: Claude Code SessionStart/PreCompact event handler that runs a command
- **Check**: A single diagnostic in `adjutant doctor` (pass/fail/warn with message)

## Success Criteria

- **SC-001**: Fresh clone → `adjutant init` → `adjutant doctor` → all checks pass, in under 60 seconds
- **SC-002**: Spawned agent in adjutant project automatically has messaging protocol in context
- **SC-003**: Running `adjutant init` twice produces identical results (idempotent)
- **SC-004**: `adjutant doctor` correctly identifies at least 8 distinct check categories
