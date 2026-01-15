# Gastown-Boy

A retro terminal themed web UI for [Gastown](https://github.com/steveyegge/gastown) multi-agent orchestration.

## Table of Contents

- [Features](#features)
- [Screenshot](#screenshot)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [Custom Gastown Directory](#custom-gastown-directory)
  - [Alternative: Run in separate terminals](#alternative-run-in-separate-terminals-for-more-control)
- [Configuration](#configuration)
  - [Backend Environment Variables](#backend-environment-variables)
  - [Frontend Environment Variables](#frontend-environment-variables)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Remote Access (ngrok)](#remote-access-ngrok)
  - [Prerequisites](#prerequisites-1)
  - [Quick Start](#quick-start-1)
  - [How It Works](#how-it-works)
  - [UI Control](#ui-control)
  - [Free Tier Limitations](#free-tier-limitations)
- [Development](#development)
  - [Commands](#commands)
  - [Constitution](#constitution)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Links](#links)

## Features

### 📊 Dashboard (Overview)
- Real-time snapshot of system status
- Mail widget with recent messages and unread count
- Crew & Polecats widget showing active agents
- Unfinished convoys with progress tracking
- Responsive design for mobile/desktop

### ✉️ Mail
- Split-view inbox/outbox interface
- Thread-based message grouping
- Quick reply and compose
- Rig-based filtering
- Handoff message filtering
- Unread message badges

### 🚚 Convoys
- Track multi-issue work packages
- Priority-based sorting (P0-P4)
- Progress visualization
- Activity timestamps
- Worker assignments
- Expandable issue details

### 👷 Crew & Polecats
- Hierarchical agent display (Town → Rigs)
- Real-time status indicators (working/idle/blocked/stuck/offline)
- Unread mail badges per agent
- Current task display
- Compact polecat chips

### ⚙️ Settings
- **6 Theme Options**: GAS-BOY (green), BLOOD-BAG (red), VAULT-TEC (blue), WASTELAND (tan), PINK-MIST (pink), RAD-STORM (purple)
- **Remote Access**: Toggle ngrok tunnel with QR code sharing
- **Developer Support**: Coffee/donation link

### Shared Features
- Retro CRT/Pip-Boy aesthetic with scanline effects
- Quick input FAB (collapsible compose widget)
- Rig filtering across all tabs
- Nuclear power button (UI only, coming soon)
- Fully responsive (mobile/tablet/desktop)

## Screenshot

```
┌──────────────────────────────────────────────────────────────┐
│  ╔═══════════════════════════════════════════════════════╗   │
│  ║  G A S T O W N - B O Y     [■ ONLINE]                 ║   │
│  ╠═══════════════════════════════════════════════════════╣   │
│  ║  [ MAIL ]    [ POWER ]    [ CREW ]                    ║   │
│  ╠═══════════════════════════════════════════════════════╣   │
│  ║  ┌─────────────┐  ┌─────────────────────────────────┐ ║   │
│  ║  │ ▸ Inbox (3) │  │ From: mayor/                    │ ║   │
│  ║  │   Sent      │  │ Subject: DISPATCH: New work     │ ║   │
│  ║  │             │  │ ──────────────────────────────  │ ║   │
│  ║  │             │  │ Work has been assigned to your  │ ║   │
│  ║  │             │  │ rig. Check your hook.           │ ║   │
│  ║  └─────────────┘  └─────────────────────────────────┘ ║   │
│  ╚═══════════════════════════════════════════════════════╝   │
│                    ░░░ PIP-BOY 3000 ░░░                       │
└──────────────────────────────────────────────────────────────┘
```

*Retro-futuristic Pip-Boy interface with glowing green terminal aesthetic.*

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser (React)                    │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────────┐ │
│  │ Mail View   │ │ Power Ctrl  │ │ Crew Stats    │ │
│  └──────┬──────┘ └──────┬──────┘ └───────┬───────┘ │
└─────────┼───────────────┼─────────────────┼─────────┘
          │               │ fetch()         │
┌─────────┼───────────────┼─────────────────┼─────────┐
│         └───────────────┼─────────────────┘         │
│                   Node.js Backend                    │
│              (Express + GT CLI wrapper)              │
└─────────────────────────┼───────────────────────────┘
                          │ child_process.spawn()
┌─────────────────────────┼───────────────────────────┐
│                 Gastown CLI (gt)                     │
└─────────────────────────────────────────────────────┘
```

## Tech Stack

**Frontend:**
- React 19+ with TypeScript
- Tailwind CSS 4+ for styling
- Vite 7+ for build tooling
- QRCode.react for QR generation
- Responsive design (mobile-first)

**Backend:**
- Node.js 20+ (ESM modules)
- Express 5+ web framework
- TypeScript with strict mode
- Zod for runtime validation

**Integration:**
- Gastown CLI (gt) via child_process
- Beads (bd) for issue tracking
- Tmux session monitoring
- ngrok for remote access

**Testing:**
- Vitest for unit tests
- React Testing Library for components
- Supertest for API tests

## Prerequisites

- Node.js 20+
- [Gastown](https://github.com/steveyegge/gastown) installed with `gt` in PATH
- A Gastown town initialized (`gt install <path>`)
- [ngrok](https://ngrok.com) installed and configured (for remote access tunnel)

## Quick Start

```bash
# Clone repository
git clone https://github.com/wsaults/gastown-boy.git
cd gastown-boy

# Install all dependencies (one command)
npm run install:all

# Start everything (backend + frontend + ngrok tunnel)
npm run dev
```

Open http://localhost:5173 in your browser, or use the ngrok URL for remote access.

### Custom Gastown Directory

By default, gastown-boy looks for your town at `~/gt`. To use a different location:

```bash
npm run dev -- /path/to/your/town
npm run dev -- ~/my-gastown
```

### Alternative: Run in separate terminals for more control

```bash
GT_TOWN_ROOT=~/gt npm run dev:backend   # Terminal 1 - Backend on :3001
npm run dev:frontend                     # Terminal 2 - Frontend on :5173
```

## Configuration

### Backend Environment Variables

Create `backend/.env` to customize (all optional):

```env
PORT=3001              # API server port (default: 3001)
GT_PATH=gt             # Path to gt binary for power controls (default: uses PATH)
GT_BIN=gt              # Alternate gt binary override (same as GT_PATH)
CORS_ORIGIN=http://localhost:5173  # Allowed CORS origin
NODE_ENV=development   # Environment mode
GT_TOWN_ROOT=~/gt         # Gastown town root (default: ~/gt, set by npm run dev)
GT_MAIL_IDENTITY=overseer  # Mailbox identity for the UI (default: overseer)
```

**Note on GT_TOWN_ROOT:** The `npm run dev` command automatically sets `GT_TOWN_ROOT`
to `~/gt` by default. Use `npm run dev -- /path/to/town` for a custom location.
The backend also auto-detects the town root when running from within a town structure.

### Frontend Environment Variables

Create `frontend/.env` to customize (all optional):

```env
# Only needed if connecting to a different backend (e.g., production)
VITE_API_URL=https://api.example.com
```

By default, the frontend uses the Vite proxy which forwards `/api` requests to `localhost:3001`. This also enables seamless ngrok tunneling - see [Remote Access](#remote-access-ngrok).

See `backend/.env.example` and `frontend/.env.example` for full documentation.

## Project Structure

```
gastown-boy/
├── backend/
│   ├── src/
│   │   ├── routes/        # Express route handlers
│   │   ├── services/      # bd/tmux data access + gt power controls
│   │   ├── middleware/    # Error handling, etc.
│   │   ├── types/         # TypeScript types + Zod schemas
│   │   └── utils/         # Response helpers
│   └── tests/unit/
├── frontend/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── services/      # API client
│   │   ├── styles/        # Tailwind + Pip-Boy theme
│   │   └── types/         # Frontend types
│   └── tests/unit/
├── specs/                 # Feature specifications
│   └── 001-pipboy-ui/
│       ├── spec.md        # Feature specification
│       ├── plan.md        # Implementation plan
│       ├── tasks.md       # Task breakdown
│       └── ...
└── .specify/              # Speckit templates
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

See [OpenAPI spec](specs/001-pipboy-ui/contracts/openapi.yaml) for full details.

## Remote Access (ngrok)

The `npm run dev` command automatically starts an ngrok tunnel for remote access.

### Prerequisites

1. Install ngrok: `brew install ngrok`
2. Sign up at [ngrok.com](https://ngrok.com) (free)
3. Add your authtoken: `ngrok config add-authtoken <your-token>`

### Accessing Remotely

When you run `npm run dev`, you'll see three services start:
- **Backend** (blue) - API server on port 3001
- **Frontend** (green) - UI on port 5173
- **ngrok** (magenta) - Tunnel with a public URL like `https://abc123.ngrok-free.app`

Share the ngrok URL to access gastown_boy from any device.

### Alternative: Run ngrok separately

If you prefer to run ngrok in a separate terminal:

```bash
# Terminal 1: Backend + Frontend only
GT_TOWN_ROOT=~/gt npm run dev:backend & npm run dev:frontend

# Terminal 2: Tunnel
npm run tunnel
```

### How It Works

- Only the frontend needs to be tunneled (free tier compatible!)
- The Vite dev server proxies `/api` requests to the backend automatically
- No environment variables needed - it just works

### UI Control

You can also control the tunnel directly from the **Settings** tab in the UI:
- Toggle tunnel on/off with a button
- View tunnel status and public URL
- Generate QR code for easy mobile access
- Copy URL to clipboard

This provides a graphical alternative to the command-line tunnel management.

### Free Tier Limitations

- **2-hour session limit** - URL changes when restarted
- **Interstitial page** - First-time visitors see an ngrok warning page
- **1 tunnel at a time** - But that's all we need!

For longer sessions or custom domains, consider [ngrok paid plans](https://ngrok.com/pricing) or alternatives like [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

## Development

### Commands

```bash
# Backend
cd backend
npm run dev      # Start dev server
npm test         # Run tests
npm run lint     # Lint code

# Frontend
cd frontend
npm run dev      # Start dev server
npm test         # Run tests
npm run build    # Production build
```

### Constitution

This project follows a [constitution](.specify/memory/constitution.md) with 5 core principles:

1. **Type Safety First** - TypeScript strict mode, Zod validation at boundaries
2. **Test-First Development** - TDD for services and hooks
3. **UI Performance** - 60fps animations, proper memoization
4. **Documentation** - JSDoc for public APIs
5. **Simplicity** - YAGNI, no premature abstraction

## Troubleshooting

### Common Issues

**`gt command not found`**
- Ensure Gastown is installed: `which gt`
- If not in PATH, set `GT_TOWN_ROOT` in `backend/.env`

**Port 3000 or 3001 already in use**
- Run `npm run kill` to stop existing processes
- Or manually: `lsof -ti:3000,3001 | xargs kill -9`

**CORS errors in browser**
- Check `CORS_ORIGIN` in `backend/.env` matches your frontend URL
- Default is `http://localhost:5173`

**ngrok tunnel won't start**
- Install: `brew install ngrok`
- Get authtoken from https://dashboard.ngrok.com
- Configure: `ngrok config add-authtoken <token>`

**Messages not loading**
- Verify Gastown is running: `gt status`
- Check backend logs for errors
- Ensure `GT_TOWN_ROOT` points to valid town directory

**Frontend can't reach backend**
- Verify backend is running on port 3001
- Check Vite proxy configuration in `frontend/vite.config.ts`

## License

MIT

## Links

- [Gastown](https://github.com/steveyegge/gastown) - Multi-agent orchestration
- [Beads](https://github.com/steveyegge/beads) - Git-backed issue tracking
- [Feature Spec](specs/001-pipboy-ui/spec.md) - Detailed requirements
