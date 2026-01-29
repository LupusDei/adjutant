# Adjutant

A retro terminal themed web UI for [Gastown](https://github.com/steveyegge/gastown) multi-agent orchestration.

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
2. **[Gastown](https://github.com/steveyegge/gastown)** installed with `gt` in PATH
3. **A Gastown town** initialized (`gt install <path>`)
4. **[ngrok](https://ngrok.com)** (optional, for remote access):
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
adjutant                    # Uses ~/gt, starts ngrok if installed
adjutant /path/to/town      # Custom Gastown directory
adjutant --no-tunnel        # Disable ngrok tunnel
adjutant --port 8080        # Custom frontend port (default: 4200)
adjutant --api-port 8081    # Custom backend port (default: 4201)
adjutant --help             # Show all options
```

**One-time run without installing:**

```bash
npx adjutant
```

> **Note:** Make sure Gastown is running (`gt up`) or start it from the UI. The app requires an active Gastown instance to display data.

## Features

### Dashboard (Overview)
- Real-time snapshot of system status
- Mail widget with recent messages and unread count
- Crew & Polecats widget showing active agents
- Unfinished convoys with progress tracking

### Mail
- Split-view inbox/outbox interface
- Thread-based message grouping
- Quick reply and compose
- Rig-based filtering

### Convoys
- Track multi-issue work packages
- Priority-based sorting (P0-P4)
- Progress visualization
- Expandable issue details

### Crew & Polecats
- Hierarchical agent display (Town -> Rigs)
- Real-time status indicators (working/idle/blocked/stuck/offline)
- Unread mail badges per agent
- Current task display

### Settings
- **6 Themes**: GAS-BOY, BLOOD-BAG, VAULT-TEC, WASTELAND, PINK-MIST, RAD-STORM
- **Remote Access**: Toggle ngrok tunnel with QR code
- Fully responsive (mobile/tablet/desktop)

## Tech Stack

**Frontend:** React 19+, TypeScript, Tailwind CSS 4+, Vite 7+

**Backend:** Node.js 20+, Express 5+, TypeScript, Zod

**Integration:** Gastown CLI (gt), Beads (bd), ngrok

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
GT_TOWN_ROOT=~/gt                  # Gastown town root (set by npm run dev)
GT_MAIL_IDENTITY=overseer          # Mailbox identity for the UI
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
│   ├── services/    # GT CLI wrappers
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
| `/api/status` | GET | Gastown status and power state |
| `/api/power/up` | POST | Start Gastown |
| `/api/power/down` | POST | Stop Gastown |
| `/api/mail` | GET | List messages (`?all=true` for full history) |
| `/api/mail` | POST | Send message to Mayor |
| `/api/mail/:id` | GET | Get message details |
| `/api/mail/:id/read` | POST | Mark message as read |
| `/api/agents` | GET | List all crew members and agents |
| `/api/convoys` | GET | List active convoys with progress |
| `/api/tunnel/status` | GET | Check ngrok tunnel status |
| `/api/tunnel/start` | POST | Start ngrok tunnel |
| `/api/tunnel/stop` | POST | Stop ngrok tunnel |

## Remote Access

`npm run dev` automatically starts an ngrok tunnel. You'll see three services:
- **Backend** (blue) - port 4201
- **Frontend** (green) - port 4200
- **ngrok** (magenta) - public URL like `https://abc123.ngrok-free.app`

You can also control the tunnel from the **Settings** tab (toggle, QR code, copy URL).

**Free tier limits:** 2-hour sessions, interstitial page on first visit, 1 tunnel at a time.

## Troubleshooting

**`gt command not found`** - Ensure Gastown is installed: `which gt`

**Port already in use** - Run `npm run kill`

**ngrok won't start** - Run `ngrok config add-authtoken <token>`

**Messages not loading** - Verify Gastown is running: `gt status` or `gt up`

**Frontend can't reach backend** - Check backend is running on port 4201

## Contributing

```bash
git clone https://github.com/wsaults/adjutant.git
cd adjutant
npm run install:all
npm run dev           # Start all services (Mac/Linux)
```

**Custom Gastown directory:**
```bash
npm run dev -- /path/to/your/town
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

- [Gastown](https://github.com/steveyegge/gastown) - Multi-agent orchestration
- [Beads](https://github.com/steveyegge/beads) - Git-backed issue tracking
- [Feature Spec](specs/001-pipboy-ui/spec.md) - Detailed requirements
