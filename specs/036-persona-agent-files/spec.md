# Feature Specification: Persona Agent Files

**Feature Branch**: `036-persona-agent-files`
**Created**: 2026-03-09
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Deploy Persona as Claude Agent (Priority: P1)

User opens the iOS app or web dashboard, navigates to Agents, clicks DEPLOY on a persona card, selects a project, and a new Claude Code agent spawns with that persona's system prompt loaded natively via `--agent` flag.

**Why this priority**: Current paste-buffer injection is fragile, timing-dependent, and semantically wrong (persona instructions arrive as first user message, not system prompt).

**Independent Test**: Deploy a persona with multi-line prompt containing `#` headers and newlines. Claude Code should start with the persona loaded as system-level instructions, not as a user message.

**Acceptance Scenarios**:

1. **Given** a persona "Sentinel" exists, **When** user deploys it to project `/code/myapp`, **Then** `.claude/agents/sentinel.md` is written to `/code/myapp/.claude/agents/` and Claude starts with `--agent sentinel`
2. **Given** a persona name contains spaces/caps "QA Lead", **When** deployed, **Then** agent file is written as `qa-lead.md` (kebab-case, lowercase)
3. **Given** `.claude/agents/` directory doesn't exist in the target project, **When** persona is deployed, **Then** directory is created automatically
4. **Given** a persona is deployed twice to the same project, **When** the second deploy happens, **Then** the agent file is overwritten with the latest prompt (idempotent)

### Edge Cases

- Persona name with special characters (e.g., `C++_Expert`, `AI/ML Specialist`)
- Target project path that doesn't exist or is not writable
- Two personas with names that sanitize to the same kebab-case string
- Agent file write fails (disk full, permissions) — spawn should still attempt to proceed

## Requirements

### Functional Requirements

- **FR-001**: System MUST write persona prompt to `.claude/agents/<sanitized-name>.md` in the target project directory before starting Claude
- **FR-002**: System MUST pass `--agent <sanitized-name>` in Claude CLI args
- **FR-003**: System MUST create `.claude/agents/` directory if it doesn't exist
- **FR-004**: System MUST sanitize persona name to lowercase kebab-case for the filename
- **FR-005**: System MUST NOT use `initialPrompt` or `--prompt` for persona injection

## Success Criteria

- **SC-001**: Persona deployment results in Claude Code starting with `--agent` flag
- **SC-002**: No 3-second initialization delay for persona injection
- **SC-003**: All 20+ spawn-persona integration tests pass with updated assertions
- **SC-004**: Multi-line persona prompts with special characters deploy correctly
