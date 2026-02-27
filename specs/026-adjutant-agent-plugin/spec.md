# Feature Specification: Adjutant Agent Plugin

**Epic**: `adj-026`
**Created**: 2026-02-27
**Status**: Draft

## Summary

Consolidate the 6 standalone skills in `.claude/skills/` into a single Claude Code **plugin** so they can be installed via the CLI (`adjutant init`) and invoked as `adjutant-agent:<skill-name>` from any project — not just the adjutant repo.

## Motivation

Today the skills live as loose directories under `.claude/skills/`. This only works inside the adjutant project itself. The goal is:

1. **Portability** — Any project that runs `adjutant init` gets all 6 skills automatically
2. **Namespacing** — Skills are invoked as `adjutant-agent:mcp-tools`, `adjutant-agent:epic-planner`, etc., avoiding name collisions with other plugins
3. **Single install** — One plugin declaration covers all skills, hooks, and metadata
4. **Discoverability** — `marketplace.json` lists the plugin for Claude Code's plugin system

## Skills Included

| Skill | Purpose | Invocation |
|-------|---------|------------|
| **mcp-tools** | MCP tool reference for messaging, status, beads, proposals, queries | `adjutant-agent:mcp-tools` |
| **epic-planner** | Structured epic hierarchy creation with speckit artifacts and beads | `adjutant-agent:epic-planner` |
| **broadcast-prompt** | Inject a message into every active agent's tmux session + MCP | `adjutant-agent:broadcast-prompt` |
| **direct-message** | Send a targeted message to a specific agent via tmux + MCP | `adjutant-agent:direct-message` |
| **discuss-proposal** | Review and discuss an improvement proposal with the user | `adjutant-agent:discuss-proposal` |
| **execute-proposal** | Turn an accepted proposal into an epic hierarchy | `adjutant-agent:execute-proposal` |

### Rename: `adjutant-agent` → `mcp-tools`

The existing `adjutant-agent` skill is renamed to `mcp-tools` to avoid the awkward `adjutant-agent:adjutant-agent` invocation. Its content (MCP tool reference, proposal generation protocol, tool catalog) is unchanged.

## Plugin Structure

```
adjutant/
├── .claude-plugin/
│   ├── marketplace.json       # Plugin declaration + skill list
│   └── plugin.json            # Plugin metadata + hooks
├── skills/                    # All 6 skills (moved from .claude/skills/)
│   ├── mcp-tools/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── tool-catalog.md
│   │       └── generate-proposal.md
│   ├── epic-planner/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── templates.md
│   │       └── beads-workflow.md
│   ├── broadcast-prompt/
│   │   └── SKILL.md
│   ├── direct-message/
│   │   └── SKILL.md
│   ├── discuss-proposal/
│   │   └── SKILL.md
│   └── execute-proposal/
│       └── SKILL.md
└── .claude/skills/            # DELETED (old location)
```

### `marketplace.json`

Declares the plugin name, owner, and lists all skill paths for Claude Code's plugin discovery.

### `plugin.json`

Declares hooks (SessionStart, PreCompact) that auto-inject `.adjutant/PRIME.md` on session start — the same hooks currently registered manually via `adjutant init`.

## Requirements

### Functional Requirements

- **FR-001**: All 6 skills MUST be discoverable as `adjutant-agent:<name>` after plugin install
- **FR-002**: `marketplace.json` MUST list all skill paths relative to the plugin root
- **FR-003**: `plugin.json` MUST declare SessionStart and PreCompact hooks
- **FR-004**: The `adjutant doctor` CLI check MUST validate the new plugin location (`skills/mcp-tools/SKILL.md`)
- **FR-005**: The old `.claude/skills/` directories MUST be removed
- **FR-006**: `execute-proposal` MUST reference `adjutant-agent:epic-planner` (not bare `/epic-planner`)

### Non-Functional Requirements

- **NFR-001**: `npm run build` must pass with no errors
- **NFR-002**: `npm test` must pass with all tests green
- **NFR-003**: No skill content changes — only location, name field, and cross-references

## Success Criteria

- **SC-001**: All 6 skills appear in Claude Code's skill list as `adjutant-agent:*`
- **SC-002**: `adjutant doctor` passes with the new plugin check
- **SC-003**: Build + tests green
- **SC-004**: Old `.claude/skills/` directories no longer exist in git

## Bead Map

- `adj-026` — Root: Consolidate skills into single adjutant-agent plugin
  - `adj-026.1` — Create plugin scaffold (.claude-plugin/ files)
  - `adj-026.2` — Move skills to skills/ at repo root (blocked by .1)
  - `adj-026.3` — Update CLI doctor check
  - `adj-026.4` — Delete old .claude/skills/ directories (blocked by .2)
  - `adj-026.5` — Update docs/adjutant-agent-setup.md
  - `adj-026.6` — Verify build, tests, and skill discovery (blocked by .3, .4, .5)

## Dependencies

- adj-026.1 → adj-026.2 (scaffold before moving skills)
- adj-026.2 → adj-026.4 (move before deleting old)
- adj-026.3, adj-026.4, adj-026.5 → adj-026.6 (all changes before verification)
