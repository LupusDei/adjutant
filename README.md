# Gastown-Boy

A retro terminal themed web UI for [Gastown](https://github.com/steveyegge/gastown) multi-agent orchestration.

## Overview

Gastown-Boy provides a retro-futuristic interface for interacting with your Gastown workspace:

- **Mail** - Split-view inbox/outbox for Mayor communication
- **Power** - Start/stop Gastown with visual state indication
- **Crew Stats** - Monitor agent activity and workload

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

- **Frontend**: React 18+, TypeScript, Tailwind CSS, Vite
- **Backend**: Node.js, Express, TypeScript
- **Validation**: Zod
- **Testing**: Vitest

## Prerequisites

- Node.js 20+
- [Gastown](https://github.com/steveyegge/gastown) installed with `gt` in PATH
- A Gastown town initialized (`gt install <path>`)

## Quick Start

```bash
# Clone and install
git clone https://github.com/wsaults/gastown-boy.git
cd gastown-boy

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start backend (terminal 1)
cd backend && npm run dev

# Start frontend (terminal 2)
cd frontend && npm run dev

# Open http://localhost:5173
```

## Configuration

### Backend Environment Variables

Create `backend/.env` to customize (all optional):

```env
PORT=3001              # API server port (default: 3001)
GT_PATH=gt             # Path to gt binary (default: uses PATH)
CORS_ORIGIN=http://localhost:5173  # Allowed CORS origin
NODE_ENV=development   # Environment mode
```

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
│   │   ├── services/      # GT command wrappers
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
| `/api/mail` | GET | List inbox messages |
| `/api/mail` | POST | Send message to Mayor |
| `/api/mail/:id` | GET | Get message details |
| `/api/mail/:id/read` | POST | Mark message as read |
| `/api/power/up` | POST | Start Gastown |
| `/api/power/down` | POST | Stop Gastown |
| `/api/agents` | GET | List crew members |

See [OpenAPI spec](specs/001-pipboy-ui/contracts/openapi.yaml) for full details.

## Remote Access (ngrok)

Access gastown_boy from your phone, another computer, or anywhere with an internet connection.

### Prerequisites

1. Install ngrok: `brew install ngrok`
2. Sign up at [ngrok.com](https://ngrok.com) (free)
3. Add your authtoken: `ngrok config add-authtoken <your-token>`

### Quick Start

```bash
# Terminal 1: Start the dev server
npm run dev

# Terminal 2: Start the tunnel
npm run tunnel
```

The tunnel will display a public URL like `https://abc123.ngrok-free.app`. Open that URL on any device to access gastown_boy.

### How It Works

- Only the frontend needs to be tunneled (free tier compatible!)
- The Vite dev server proxies `/api` requests to the backend automatically
- No environment variables needed - it just works

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

## License

MIT

## Links

- [Gastown](https://github.com/steveyegge/gastown) - Multi-agent orchestration
- [Beads](https://github.com/steveyegge/beads) - Git-backed issue tracking
- [Feature Spec](specs/001-pipboy-ui/spec.md) - Detailed requirements
