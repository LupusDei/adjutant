# Mayor Context (adjutant)

> **Recovery**: Run `gt prime` after compaction, clear, or new session

Full context is injected by `gt prime` at session start.

## CRITICAL: Scope Understanding

**Adjutant is the DASHBOARD for ALL of Gas Town**, not just a UI for itself.

- **Beads**: Show from `~/gt/.beads/` (town beads, hq-* prefix), NOT adjutant/.beads/
- **Agents**: Show ALL rigs, polecats, crew across the entire town
- **Mail**: Mayor's inbox at town level
- **Convoys**: All town convoys

The UI runs from `~/gt` and displays the complete state of Gas Town.
See `.claude/rules/00-critical-scope.md` for details.

## Active Technologies
- TypeScript 5.x (strict mode) + React 18+, Express, Tailwind CSS, Zod (013-agent-task-assignment)
- SQLite (message store), bd CLI (beads) (013-agent-task-assignment)
- TypeScript 5.x (strict mode) + Express, Zod, bd-client (CLI wrapper), Node.js EventEmitter (019-beads-service-decompose)
- SQLite (beads databases via bd CLI) — no direct DB access, all through bd-clien (019-beads-service-decompose)

## Recent Changes
- 013-agent-task-assignment: Added TypeScript 5.x (strict mode) + React 18+, Express, Tailwind CSS, Zod
