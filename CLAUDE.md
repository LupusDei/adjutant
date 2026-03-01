# Adjutant

Adjutant is a standalone multi-agent dashboard backed by beads (issue tracking) and MCP (agent communication).

## Active Technologies
- TypeScript 5.x (strict mode) + React 18+, Express, Tailwind CSS, Zod
- SQLite (message store + full-text search), bd CLI (beads issue tracking)
- MCP via SSE transport (agent connections)
- WebSocket (real-time chat), APNS (iOS push notifications)

## Key Concepts
- **Beads**: Issue tracking via `bd` CLI — epics, tasks, bugs with hierarchical dependencies
- **Agents**: Connect via MCP SSE, use tools for messaging, status reporting, and bead management
- **Messages**: Persistent SQLite-backed chat between agents and user, with WebSocket real-time delivery
- **Dashboard**: Retro terminal themed web UI showing agents, beads, chat, and system state
