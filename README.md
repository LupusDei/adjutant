# Gastown-Boy

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
npm install -g gastown-boy
gt-boy
```

That's it! The UI opens at `http://localhost:3000`.

**Options:**

```bash
gt-boy                    # Uses ~/gt, starts ngrok if installed
gt-boy /path/to/town      # Custom Gastown directory
gt-boy --no-tunnel        # Disable ngrok tunnel
gt-boy --port 8080        # Custom frontend port (default: 3000)
gt-boy --api-port 8081    # Custom backend port (default: 3001)
gt-boy --help             # Show all options
```

**One-time run without installing:**

```bash
npx gastown-boy
```

> **Note:** Make sure Gastown is running (`gt up`) or start it from the UI. The app requires an active Gastown instance to display data.

## Features

### 📊 Dashboard (Overview)
- Real-time snapshot of system status
- Mail widget with recent messages and unread count
- Crew & Polecats widget showing active agents
- Unfinished convoys with progress tracking

### ✉️ Mail
- Split-view inbox/outbox interface
- Thread-based message grouping
- Quick reply and compose
- Rig-based filtering

### 🚚 Convoys
- Track multi-issue work packages
- Priority-based sorting (P0-P4)
- Progress visualization
- Expandable issue details

### 👷 Crew & Polecats
- Hierarchical agent display (Town → Rigs)
- Real-time status indicators (working/idle/blocked/stuck/offline)
- Unread mail badges per agent
- Current task display

### ⚙️ Settings
- **6 Themes**: GAS-BOY, BLOOD-BAG, VAULT-TEC, WASTELAND, PINK-MIST, RAD-STORM
- **Remote Access**: Toggle ngrok tunnel with QR code
- Fully responsive (mobile/tablet/desktop)

## Tech Stack

**Frontend:** React 19+, TypeScript, Tailwind CSS 4+, Vite 7+

**Backend:** Node.js 20+, Express 5+, TypeScript, Zod

**Integration:** Gastown CLI (gt), Beads (bd), ngrok

**Testing:** Vitest, React Testing Library, Supertest

## Configuration

### Backend Environment Variables

Create `backend/.env` (all optional):

```env
PORT=3001                          # API server port
GT_TOWN_ROOT=~/gt                  # Gastown town root (set by npm run dev)
GT_MAIL_IDENTITY=overseer          # Mailbox identity for the UI
CORS_ORIGIN=http://localhost:5173  # Allowed CORS origin
```

### Frontend Environment Variables

Create `frontend/.env` (all optional):

```env
VITE_API_URL=https://api.example.com  # Only for non-local backend
```

See `.env.example` files for full documentation.

## Project Structure

```
gastown-boy/
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
- **Backend** (blue) - port 3001
- **Frontend** (green) - port 3000
- **ngrok** (magenta) - public URL like `https://abc123.ngrok-free.app`

You can also control the tunnel from the **Settings** tab (toggle, QR code, copy URL).

**Free tier limits:** 2-hour sessions, interstitial page on first visit, 1 tunnel at a time.

## Troubleshooting

**`gt command not found`** - Ensure Gastown is installed: `which gt`

**Port already in use** - Run `npm run kill`

**ngrok won't start** - Run `ngrok config add-authtoken <token>`

**Messages not loading** - Verify Gastown is running: `gt status` or `gt up`

**Frontend can't reach backend** - Check backend is running on port 3001

## Contributing

```bash
git clone https://github.com/wsaults/gastown-boy.git
cd gastown-boy
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
npm run kill          # Kill processes on ports 3000/3001
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
