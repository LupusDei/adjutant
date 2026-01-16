# Project Context

## What is Gastown-Boy?

A Fallout Pip-Boy themed web UI for interacting with Gastown, a multi-agent orchestration system.

**CRITICAL**: Gastown-Boy is the DASHBOARD for ALL of Gas Town. It runs from `~/gt` and displays:
- **All beads** from `~/gt/.beads/` (town beads, hq-* prefix)
- **All agents** across all rigs (gastown, gastown_boy, etc.)
- **All mail, convoys, and system state**

The UI is NOT just for the gastown_boy rig - it's the Mayor's command center for the entire town.
See `00-critical-scope.md` for the full explanation.

## Core Features

1. **Mail Interface** - Split-view inbox/outbox for Mayor communication
2. **Power Controls** - Start/stop Gastown with visual state indication
3. **Crew Stats** - Monitor agent activity and workload

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Backend**: Node.js + Express + TypeScript
- The backend wraps `gt` CLI commands (child_process.spawn)
- The UI is stateless - all data comes from Gastown

## Key Integration Point

Gastown has no REST API. We interface via CLI:
- `gt mail inbox --json` - fetch messages
- `gt mail send mayor/ -s "Subject" -m "Body"` - send to Mayor
- `gt up` / `gt down` - power control
- `gt status --json` - system state
- `gt agents list --all` - crew info

## Project Structure

```
backend/src/
├── routes/      # Express handlers
├── services/    # GT command wrappers (gt-executor, mail-service, etc.)
├── middleware/  # Error handling
├── types/       # TypeScript + Zod schemas
└── utils/       # Response helpers

frontend/src/
├── components/  # React components (mail/, power/, crew/, shared/)
├── hooks/       # Custom hooks (useMail, useGastownStatus, usePolling)
├── services/    # API client
├── styles/      # Tailwind + Pip-Boy theme
└── types/       # Frontend types
```
