# Adjutant

A retro terminal themed web dashboard for multi-agent orchestration, backed by [Beads](https://github.com/steveyegge/beads) issue tracking and MCP agent communication.

https://github.com/user-attachments/assets/1aaebcdf-aa24-4e88-9628-27ef91ad34d5

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Claude Code Plugin Setup](#claude-code-plugin-setup)
- [Development Setup](#development-setup)
- [iOS App](#ios-app)
- [Features](#features)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Remote Access](#remote-access)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Quick Start

```bash
npm install -g adjutant
adjutant
```

The dashboard opens at `http://localhost:4200`.

### CLI Options

```bash
adjutant                    # Start dashboard (frontend + backend + ngrok)
adjutant --no-tunnel        # Disable ngrok tunnel
adjutant --port 8080        # Custom frontend port (default: 4200)
adjutant --api-port 8081    # Custom backend port (default: 4201)
adjutant init               # Bootstrap Adjutant in a project
adjutant doctor             # Check system health and prerequisites
adjutant prime              # Output PRIME.md agent protocol to stdout
adjutant unhook             # Remove Adjutant plugin hooks from Claude Code
adjutant --help             # Show all options
```

**One-time run without installing:**

```bash
npx adjutant
```

## Prerequisites

- **Node.js 20+**
- **[Beads](https://github.com/steveyegge/beads)** installed with `bd` in PATH
- **[ngrok](https://ngrok.com)** (optional, for remote access):
  ```bash
  brew install ngrok
  ngrok config add-authtoken <your-token>
  ```

## Claude Code Plugin Setup

Adjutant integrates with Claude Code via its plugin system, providing MCP tools, epic planning, messaging skills, and automatic PRIME.md injection on session start.

### First-time setup

After installing adjutant globally, run `adjutant init` in any project directory:

```bash
adjutant init
```

This performs the following:

| Step | What it does |
|------|-------------|
| `~/.adjutant/PRIME.md` | Creates a global default agent protocol file |
| `.adjutant/PRIME.md` | Creates a local override in the current project |
| `.mcp.json` | Creates/merges MCP server config for adjutant |
| Plugin marketplace | Registers `LupusDei/adjutant` via `claude plugin marketplace add` |
| Plugin install | Installs `adjutant-agent` plugin with user scope |
| Plugin enable | Enables the plugin in Claude Code settings |
| Legacy cleanup | Removes old manual hooks from `~/.claude/settings.json` |

All steps are idempotent -- safe to run multiple times.

### Verify installation

```bash
adjutant doctor
```

Checks file existence, plugin status, network health, and tool availability.

### How it works

Once installed, the plugin automatically:

1. **SessionStart hook** -- runs `adjutant prime` to inject PRIME.md into every new Claude Code session
2. **PreCompact hook** -- re-injects PRIME.md before context compaction so agent protocol survives compression
3. **Skills** -- provides MCP tools, epic planner, broadcast, direct message, and proposal skills

### PRIME.md resolution

`adjutant prime` looks for PRIME.md in this order:
1. `.adjutant/PRIME.md` in the current directory (project-specific override)
2. `~/.adjutant/PRIME.md` (global default)
3. Embedded fallback (bundled with the package)

### Updating the plugin

```bash
claude plugin marketplace update adjutant-agent
claude plugin update adjutant-agent@adjutant-agent
```

### Development mode

For local plugin development without installing from GitHub:

```bash
claude --plugin-dir /path/to/adjutant
```

## Development Setup

### Install dependencies

```bash
git clone https://github.com/LupusDei/adjutant.git
cd adjutant
npm run install:all    # Installs root, backend, and frontend deps
```

### Run everything

```bash
npm run dev            # Starts backend + frontend + ngrok tunnel
```

This launches three services:
- **Backend** on port 4201
- **Frontend** on port 4200
- **ngrok** tunnel (if installed)

### Run individually

```bash
npm run dev:backend    # Backend only (hot reload via tsx)
npm run dev:frontend   # Frontend only (Vite dev server)
```

### Build for production

```bash
npm run build          # Builds CLI, backend, and frontend
npm start              # Run production build
```

### Run tests

```bash
# Backend
cd backend && npm test          # Run once
cd backend && npm run test:watch # Watch mode

# Frontend
cd frontend && npm test
cd frontend && npm run test:watch
```

### Other commands

```bash
npm run kill           # Kill processes on ports 4200/4201
```

### API Key Management

The backend supports API key authentication:

```bash
cd backend
npm run api-key:generate    # Generate a new API key
npm run api-key:list        # List all API keys
npm run api-key:revoke      # Revoke an API key
```

## iOS App

The Adjutant iOS companion app connects to your dashboard for mobile monitoring and messaging.

### Requirements

- Xcode 15+ (Swift 5.9+)
- iOS 17+ deployment target
- macOS 14+ for development

### Project structure

The iOS app uses **Swift Package Manager** with two packages:

```
ios/
├── Adjutant.xcodeproj    # Xcode project (app target only)
├── Package.swift         # AdjutantUI package (auto-discovers Adjutant/)
├── Adjutant/             # Main app source (SPM-managed)
│   ├── App/              # AdjutantApp.swift, AppDelegate.swift (Xcode target)
│   ├── Views/            # SwiftUI views
│   ├── Services/         # API, WebSocket, push notifications
│   └── Models/           # Data models
└── AdjutantKit/          # Shared framework package
    ├── Package.swift
    └── Sources/AdjutantKit/
```

### Building

1. Open `ios/Adjutant.xcodeproj` in Xcode
2. Select your development team under Signing & Capabilities
3. Build and run on a simulator or device

**SPM auto-discovery**: Files in `ios/Adjutant/` are automatically discovered by Swift Package Manager. Do **not** manually add source files to the `.pbxproj` build phases -- this causes duplicate compilation errors.

### Local distribution

The app is configured for **App Store Connect** distribution:

1. Archive the app in Xcode (Product > Archive)
2. Distribute via App Store Connect (automatic signing enabled)
3. Use TestFlight for beta distribution to devices

Export settings (`ExportOptions.plist`):
- Export method: `app-store-connect`
- Automatic signing: enabled
- Team ID: configured in project settings

### Push notifications (APNs)

The backend supports Apple Push Notification service for real-time mobile alerts. Configure in `backend/.env`:

```env
APNS_TEAM_ID=your-team-id
APNS_KEY_ID=your-key-id
APNS_BUNDLE_ID=your.bundle.id
APNS_KEY_PATH=/path/to/AuthKey.p8
APNS_ENVIRONMENT=development    # or "production"
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

### Themes
Four themes: PIP-BOY (green CRT), DOCUMENT (clean professional), STARCRAFT (sci-fi cyan), FRIENDLY (playful purple)

## Architecture

```
Agent  ──MCP SSE──▶  Backend  ──WebSocket──▶  Frontend
                       │
                    SQLite (messages, FTS5)
                       │
                    bd CLI (beads)
```

**Frontend:** React 19 + TypeScript + Tailwind CSS 4 + Vite

**Backend:** Node.js 20 + Express 5 + TypeScript + Zod + better-sqlite3

**Agent Protocol:** MCP via SSE transport with server-side identity resolution

**Testing:** Vitest + React Testing Library + Supertest

## Configuration

### Backend (`backend/.env`)

```env
PORT=4201                          # API server port
NODE_ENV=development               # Environment
CORS_ORIGIN=http://localhost:4200  # Allowed CORS origin
```

### Frontend (`frontend/.env`)

```env
VITE_PORT=4200                     # Dev server port
VITE_API_PORT=4201                 # Backend API port for proxy
VITE_API_URL=https://example.com   # Only for non-local backend
```

See `.env.example` files for full documentation.

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

Adjutant uses ngrok for remote access. When running `adjutant` or `npm run dev`, a tunnel starts automatically if ngrok is installed.

You can also control the tunnel from the **Settings** tab (toggle, QR code, copy URL).

**Free tier limits:** 2-hour sessions, interstitial page on first visit, 1 tunnel at a time.

## Troubleshooting

**Port already in use** -- Run `npm run kill`

**ngrok won't start** -- Run `ngrok config add-authtoken <token>`

**Frontend can't reach backend** -- Check backend is running on port 4201

**Agent not connecting** -- Verify `.mcp.json` exists in the agent's working directory and backend is running

**iOS build fails with "cannot find in scope"** -- Do not add source files to `.pbxproj` manually; SPM auto-discovers them

## License

MIT

## Links

- [GitHub](https://github.com/LupusDei/adjutant)
- [Beads](https://github.com/steveyegge/beads) -- Git-backed issue tracking
