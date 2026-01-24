# Quickstart: Pip-Boy UI for Gastown

**Date**: 2026-01-11
**Feature**: 001-pipboy-ui

## Prerequisites

Before running adjutant, ensure you have:

1. **Node.js 20+** installed
2. **gastown** installed and configured (`gt` command available in PATH)
3. A gastown town initialized (`gt install <path>` completed)

Verify gastown is working:

```bash
gt version
gt status
```

## Installation

```bash
# Clone the repository
git clone <repo-url> adjutant
cd adjutant

# Install dependencies for both frontend and backend
cd backend && npm install
cd ../frontend && npm install
```

## Development

### Start the backend

```bash
cd backend
npm run dev
```

The backend runs on `http://localhost:3001` by default.

### Start the frontend

In a separate terminal:

```bash
cd frontend
npm run dev
```

The frontend runs on `http://localhost:5173` by default.

### Access the UI

Open `http://localhost:5173` in your browser.

## Configuration

### Backend Configuration

Create `backend/.env` if you need to customize:

```env
# Port for the backend server (default: 3001)
PORT=3001

# Path to gt binary (default: uses PATH)
GT_PATH=gt

# CORS origin for frontend (default: http://localhost:5173)
CORS_ORIGIN=http://localhost:5173
```

### Frontend Configuration

Create `frontend/.env` if you need to customize:

```env
# Backend API URL (default: http://localhost:3001/api)
VITE_API_URL=http://localhost:3001/api

# Polling interval in ms (default: 3000)
VITE_POLL_INTERVAL=3000
```

## Remote Access (ngrok)

To access adjutant remotely:

1. Start both frontend and backend locally
2. Use ngrok to expose the backend:

```bash
ngrok http 3001
```

3. Update the frontend's API URL to the ngrok URL:

```bash
# In frontend/.env
VITE_API_URL=https://your-ngrok-url.ngrok.io/api
```

4. Rebuild and access the frontend, or use ngrok to expose frontend too:

```bash
ngrok http 5173
```

## Usage

### Mail Interface

1. The mail view shows a split panel: message list on left, content on right
2. Click a message to view its full content
3. Click "Compose" to write a new message to the Mayor
4. Click "Reply" to respond to a message in the same thread

### Power Controls

1. The power button shows current gastown state (on/off/transitioning)
2. Click to toggle gastown power state
3. Button is disabled during state transitions

### Crew Stats

1. Shows all gastown agents with their current status
2. Updates automatically via polling
3. Agents are grouped by rig (project)

## Troubleshooting

### "gt command not found"

Ensure gastown is installed and `gt` is in your PATH:

```bash
which gt
```

If not found, add gastown's bin directory to your PATH or set `GT_PATH` in backend config.

### "Connection refused" errors

1. Verify the backend is running: `curl http://localhost:3001/api/status`
2. Check CORS settings if accessing from a different origin
3. Ensure gastown is initialized: `gt status`

### Messages not loading

1. Check if gastown is running: `gt status`
2. Verify mail is working: `gt mail inbox`
3. Check backend logs for gt command errors

### Power button not responding

1. Check backend logs for gt up/down errors
2. Try running `gt up` or `gt down` manually to see any errors
3. Ensure you have permissions to control gastown

## API Reference

See `specs/001-pipboy-ui/contracts/openapi.yaml` for the full API specification.

Quick reference:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Get gastown status |
| `/api/mail` | GET | List messages |
| `/api/mail` | POST | Send message |
| `/api/mail/:id` | GET | Get message details |
| `/api/mail/:id/read` | POST | Mark message as read |
| `/api/power/up` | POST | Start gastown |
| `/api/power/down` | POST | Stop gastown |
| `/api/agents` | GET | List crew members |

## Next Steps

After setup:

1. Start gastown if not running: use the power button or `gt up`
2. Send a test message to the Mayor
3. Explore the crew stats dashboard
4. Customize the Pip-Boy theme in `frontend/src/styles/pipboy-theme.ts`
