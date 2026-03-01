# Adjutant

A retro terminal themed web dashboard for multi-agent orchestration.

https://github.com/user-attachments/assets/1aaebcdf-aa24-4e88-9628-27ef91ad34d5

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Features](#features)
- [Screenshot](#screenshot)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Remote Access](#remote-access)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Links](#links)

## Prerequisites

1. **Node.js 20+**
2. **[Beads](https://github.com/steveyegge/beads)** installed with `bd` in PATH
3. **[ngrok](https://ngrok.com)** (optional, for remote access):
   ```bash
   brew install ngrok
   ngrok config add-authtoken <your-token>  # Get token from ngrok.com
   ```

## Quick Start

```bash
npm install -g adjutant
adjutant
```

That's it! The UI opens at `http://localhost:4200`.

**Options:**

```bash
adjutant                    # Default setup, starts ngrok if installed
adjutant --no-tunnel        # Disable ngrok tunnel
adjutant --port 8080        # Custom frontend port (default: 4200)
adjutant --api-port 8081    # Custom backend port (default: 4201)
adjutant --help             # Show all options
```

**One-time run without installing:**

```bash
npx adjutant
```

## Features

### Dashboard (Overview)
- Real-time snapshot of system status
- Agent activity and status widgets
- Beads progress tracking

### Chat
- Persistent agent-to-user messaging via MCP
- SQLite-backed message history with full-text search
- Real-time delivery via WebSocket
- Thread-based conversations

### Beads
- Issue tracker integration via `bd` CLI
- Kanban board with drag-drop
- Epic hierarchy visualization
- Priority-based sorting (P0-P4)

### Agents
- Real-time status indicators (working/idle/blocked/done/offline)
- Current task display
- Session terminal streaming

### Settings
- **6 Themes**: GAS-BOY, BLOOD-BAG, VAULT-TEC, WASTELAND, PINK-MIST, RAD-STORM
- **Remote Access**: Toggle ngrok tunnel with QR code
- Fully responsive (mobile/tablet/desktop)

## Tech Stack

**Frontend:** React 19+, TypeScript, Tailwind CSS 4+, Vite 7+

**Backend:** Node.js 20+, Express 5+, TypeScript, Zod

**Integration:** Beads (bd), MCP (agent protocol), ngrok

**Testing:** Vitest, React Testing Library, Supertest

## Configuration

### Port Configuration

By default, Adjutant runs:
- **Frontend** on port `4200`
- **Backend API** on port `4201`

Override via environment variables or CLI flags.

### Backend Environment Variables

Create `backend/.env` (all optional):

```env
PORT=4201                          # API server port (default: 4201)
NGROK_PORT=4200                    # Port to tunnel (default: 4200)
CORS_ORIGIN=http://localhost:4200  # Allowed CORS origin
```

### Frontend Environment Variables

Create `frontend/.env` (all optional):

```env
VITE_PORT=4200                        # Frontend dev server port (default: 4200)
VITE_API_PORT=4201                    # Backend API port for proxy (default: 4201)
VITE_API_URL=https://api.example.com  # Only for non-local backend
```

See `.env.example` files for full documentation.

## Project Structure

```
adjutant/
├── backend/src/
│   ├── routes/      # Express route handlers
│   ├── services/    # MCP server, message store, bd client
│   ├── types/       # TypeScript + Zod schemas
│   └── utils/       # Response helpers
├── frontend/src/
│   ├── components/  # React components
│   ├── hooks/       # Custom React hooks
│   ├── services/    # API client
│   └── styles/      # Tailwind + theme
└── specs/           # Feature specifications
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/messages` | GET | List messages (filter by agent, thread) |
| `/api/messages` | POST | Send message |
| `/api/messages/unread` | GET | Unread counts per agent |
| `/api/agents` | GET | List all agents |
| `/api/beads` | GET | List beads |
| `/api/beads/:id` | PATCH | Update bead |
| `/api/tunnel/status` | GET | Check ngrok tunnel status |
| `/api/tunnel/start` | POST | Start ngrok tunnel |
| `/api/tunnel/stop` | POST | Stop ngrok tunnel |
| `/mcp/sse` | GET | MCP SSE endpoint for agent connections |
| `/mcp/messages` | POST | MCP JSON-RPC message routing |

## Remote Access

`npm run dev` automatically starts an ngrok tunnel. You'll see three services:
- **Backend** (blue) - port 4201
- **Frontend** (green) - port 4200
- **ngrok** (magenta) - public URL like `https://abc123.ngrok-free.app`

You can also control the tunnel from the **Settings** tab (toggle, QR code, copy URL).

**Free tier limits:** 2-hour sessions, interstitial page on first visit, 1 tunnel at a time.

## Troubleshooting

**Port already in use** - Run `npm run kill`

**ngrok won't start** - Run `ngrok config add-authtoken <token>`

**Frontend can't reach backend** - Check backend is running on port 4201

**Agent not connecting** - Verify `.mcp.json` exists in agent's working directory and backend is running

## Contributing

```bash
git clone https://github.com/wsaults/adjutant.git
cd adjutant
npm run install:all
npm run dev           # Start all services (Mac/Linux)
```

**Running tests:**
```bash
cd backend && npm test && npm run lint
cd frontend && npm test && npm run build
```

**Other commands:**
```bash
npm run kill          # Kill processes on ports 4200/4201
npm run build         # Build for production
```

### Project Principles

This project follows a [constitution](.specify/memory/constitution.md):
1. **Type Safety First** - TypeScript strict mode, Zod validation
2. **Test-First Development** - TDD for services and hooks
3. **UI Performance** - 60fps animations, proper memoization
4. **Simplicity** - YAGNI, no premature abstraction

## License

MIT

## Links

- [Beads](https://github.com/steveyegge/beads) - Git-backed issue tracking
