# Gastown-Boy

A Fallout Pip-Boy themed web UI for [Gastown](https://github.com/steveyegge/gastown) multi-agent orchestration.

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
VITE_API_URL=http://localhost:3001  # Backend API URL (default: localhost:3001)
```

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

## Remote Access

Gastown-Boy runs on localhost by default. For remote access, use ngrok:

```bash
ngrok http 3001  # Expose backend
```

Then update `VITE_API_URL` in frontend to the ngrok URL.

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
