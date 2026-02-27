# Adjutant Agent Skill: Setup and Configuration

**Purpose**: How to install and configure the `adjutant-agent` plugin so spawned Claude Code agents automatically connect to the Adjutant MCP server and communicate via its messaging tools.

---

## 1. What the Adjutant Agent Skill Does

The `adjutant-agent` plugin (defined at `skills/mcp-tools/SKILL.md`) teaches a Claude Code agent how to use the Adjutant MCP tools. When loaded, the agent gains access to:

- **Messaging** -- `send_message`, `read_messages`, `list_threads`, `mark_read`
- **Status reporting** -- `set_status`, `report_progress`, `announce`
- **Bead management** -- `create_bead`, `update_bead`, `close_bead`, `list_beads`, `show_bead`
- **System queries** -- `list_agents`, `get_project_state`, `search_messages`

The skill itself is **documentation only** -- it does not connect the agent. The actual MCP connection is established by the `.mcp.json` configuration file at the project root. The skill tells the agent what tools are available and how to use them; `.mcp.json` tells Claude Code's MCP client where to connect.

### How identity works

When an agent connects to the MCP SSE endpoint, the server resolves identity through:
1. **Query param** `agentId` on the SSE URL (highest priority)
2. **Header** `X-Agent-Id` (fallback)
3. **Auto-generated** `unknown-agent-<uuid>` (last resort)

Identity is resolved **server-side** in `mcp-server.ts:resolveAgentId()`. Agents do not self-identify in tool calls -- the server maps the MCP session to the agent ID established at connection time. This prevents spoofing.

---

## 2. Prerequisites

Before any agent can use Adjutant messaging, the following must be running:

### Adjutant backend server

```bash
cd /path/to/adjutant
npm run dev          # starts backend on :4201, frontend on :4200
# or just the backend:
npm run dev:backend  # starts backend only on :4201
```

The backend:
- Starts Express on port `4201` (configurable via `PORT` env var)
- Initializes the MCP server singleton
- Registers all MCP tools (messaging, status, beads, queries)
- Opens SQLite database at `~/.adjutant/adjutant.db`
- Mounts MCP SSE endpoint at `GET /mcp/sse`
- Mounts MCP message relay at `POST /mcp/messages`

### Verify the server is reachable

```bash
curl -s http://localhost:4201/health
# Expected: {"status":"ok"}
```

### Verify MCP endpoint responds

```bash
curl -s -N http://localhost:4201/mcp/sse?agentId=test-probe
# Expected: SSE stream begins (event: endpoint, data: /mcp/messages?sessionId=...)
# Ctrl+C to disconnect
```

---

## 3. Installation Steps

### Step 1: The `.mcp.json` file (project-level MCP config)

The file that actually connects Claude Code to the Adjutant MCP server is `.mcp.json` at the project root. This file already exists in the adjutant repo:

**File: `/path/to/adjutant/.mcp.json`**
```json
{
  "mcpServers": {
    "adjutant": {
      "type": "sse",
      "url": "http://localhost:4201/mcp/sse",
      "headers": {
        "X-Agent-Id": "${ADJUTANT_AGENT_ID:-unknown}"
      }
    }
  }
}
```

**How it works**:
- Claude Code reads `.mcp.json` from the project root on session start
- It establishes an SSE connection to `http://localhost:4201/mcp/sse`
- The `X-Agent-Id` header is set from the `ADJUTANT_AGENT_ID` environment variable
- If that env var is not set, it falls back to `"unknown"`
- The MCP server also supports `?agentId=<name>` as a query parameter, which takes priority over the header

### Step 2: Copy `.mcp.json` to other projects (if needed)

If agents will be spawned in a **different project directory** (e.g., a git worktree, or a separate repo), they need their own `.mcp.json`:

```bash
cp /path/to/adjutant/.mcp.json /path/to/other-project/.mcp.json
```

Or create it manually with the JSON above.

**For worktrees**: Git worktrees share the `.git` directory but NOT the working tree root files. Each worktree needs its own `.mcp.json` copy.

### Step 3: Set the agent ID environment variable

Before spawning an agent, set `ADJUTANT_AGENT_ID` so the server knows who connected:

```bash
export ADJUTANT_AGENT_ID="researcher"
# Then start claude code in that shell
```

Alternatively, the agent can be identified via the SSE URL query parameter if the `.mcp.json` URL is set to include it:

```json
{
  "mcpServers": {
    "adjutant": {
      "type": "sse",
      "url": "http://localhost:4201/mcp/sse?agentId=researcher"
    }
  }
}
```

### Step 4: Verify the skill is available

When Claude Code starts in the adjutant project directory, it should:
1. Load `.mcp.json` and connect to the Adjutant MCP server
2. Discover the `adjutant-agent` plugin from `skills/mcp-tools/SKILL.md`
3. Have MCP tools available: `send_message`, `set_status`, etc.

To verify from within a Claude Code session, the agent can call any MCP tool:

```
Use the get_project_state tool to check connectivity.
```

If the server is not running, the tool call will fail with a connection error.

---

## 4. Agent Spawn Configuration

### 4.1 What agents need in their spawn prompt

When spawning a teammate (via Claude Code's team/subagent system), the spawn prompt must include:

1. **The working directory** must contain `.mcp.json` (or be the adjutant repo itself)
2. **The `ADJUTANT_AGENT_ID` env var** should be set before spawning
3. **Explicit instructions** to use MCP tools for communication

### 4.2 Spawn prompt template

Include this block in every agent spawn prompt:

```
## Communication (MANDATORY)

You have MCP tools for communicating with the dashboard and user. Use them instead
of relying on text output or SendMessage for status updates.

**Report status changes:**
- When starting work: set_status({ status: "working", task: "Description of what you're doing" })
- When blocked: set_status({ status: "blocked", task: "What's blocking you" })
- When done: set_status({ status: "done" })

**Send messages to the user:**
- Progress updates: send_message({ to: "user", body: "Completed X, moving to Y" })
- Questions: send_message({ to: "user", body: "Need clarification on..." })
- Completions: announce({ type: "completion", title: "Task done", body: "Details..." })

**Report progress on long tasks:**
- report_progress({ task: "adj-xxx", percentage: 50, description: "Halfway done" })

**Manage beads via MCP (instead of bd CLI):**
- update_bead({ id: "adj-xxx", status: "in_progress" })
- close_bead({ id: "adj-xxx", reason: "All done" })

Do NOT just print status to stdout. Use the MCP tools so the dashboard sees your state.
```

### 4.3 Full spawn example

```
Spawn a teammate named "backend-builder" to implement the database migration.

Working directory: /Users/Reason/code/ai/adjutant
Environment: ADJUTANT_AGENT_ID=backend-builder

## Task
Implement the SQLite migration in backend/src/services/database.ts.
Your bead: adj-010.1.1

## Communication (MANDATORY)
[include the block from 4.2 above]

## Task Tracking (MANDATORY)
Use `bd` CLI for ALL task tracking.
Your assigned beads: adj-010.1.1
Before starting: bd update adj-010.1.1 --status=in_progress
After completing: bd close adj-010.1.1
Before shutting down: bd sync
```

### 4.4 For agents in other project directories

If the agent works in a different directory (e.g., worktree), ensure `.mcp.json` is present:

```bash
# Before spawning:
cp /path/to/adjutant/.mcp.json /path/to/worktree/.mcp.json
```

Or instruct the agent to create it:

```
## Setup
Before starting work, ensure .mcp.json exists in your working directory with:
{
  "mcpServers": {
    "adjutant": {
      "type": "sse",
      "url": "http://localhost:4201/mcp/sse?agentId=backend-builder"
    }
  }
}
```

---

## 5. MCP Tool Reference

### Messaging

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `send_message` | Send a message | `to` (required), `body` (required), `threadId` |
| `read_messages` | Read messages | `threadId`, `agentId`, `limit`, `before` |
| `list_threads` | List conversation threads | `agentId` |
| `mark_read` | Mark messages read | `messageId` or `agentId` |

### Status

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `set_status` | Update agent status | `status` (required: working/blocked/idle/done), `task`, `beadId` |
| `report_progress` | Report task progress | `task` (required), `percentage` (required), `description` |
| `announce` | Broadcast announcement | `type` (required: completion/blocker/question), `title` (required), `body` (required), `beadId` |

### Beads

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `create_bead` | Create a bead | `title`, `description`, `type` (epic/task/bug), `priority` (0-4) |
| `update_bead` | Update bead fields | `id` (required), `status`, `assignee`, `title`, `description`, `priority` |
| `close_bead` | Close a bead | `id` (required), `reason` |
| `list_beads` | List beads | `status`, `assignee`, `type` |
| `show_bead` | Get bead details | `id` (required) |

### Queries

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_agents` | List all agents | `status` (active/idle/all) |
| `get_project_state` | Project summary | (none) |
| `search_messages` | Full-text search | `query` (required), `agentId`, `limit` |

Full input/output schemas are in `skills/mcp-tools/references/tool-catalog.md`.

---

## 6. Architecture Reference

### Message flow: Agent to User

```
Agent calls send_message via MCP
  -> MCP tool handler in messaging.ts
  -> Message stored in SQLite (message-store.ts)
  -> WebSocket broadcast to dashboard clients (ws-server.ts)
  -> If recipient is "user" or "mayor/", APNS push to iOS
```

### Message flow: User to Agent

```
User types in Chat UI
  -> POST /api/messages (REST) or WebSocket message
  -> Stored in SQLite
  -> WebSocket broadcast to all connected clients
  -> Agent can read via read_messages MCP tool
```

### Connection lifecycle

```
Agent starts -> Claude Code reads .mcp.json
  -> SSE connection to GET /mcp/sse?agentId=<name>
  -> Server creates AgentConnection, maps sessionId -> agentId
  -> All MCP tool calls are routed through POST /mcp/messages?sessionId=<id>
  -> On disconnect: auto-cleanup via transport.onclose
```

### Key files

| File | Purpose |
|------|---------|
| `.mcp.json` | MCP server configuration (project root) |
| `skills/mcp-tools/SKILL.md` | Skill definition (tool usage docs) |
| `skills/mcp-tools/references/tool-catalog.md` | Complete tool schemas |
| `backend/src/services/mcp-server.ts` | MCP server, connection tracking, identity resolution |
| `backend/src/services/mcp-tools/messaging.ts` | send_message, read_messages, list_threads, mark_read |
| `backend/src/services/mcp-tools/status.ts` | set_status, report_progress, announce |
| `backend/src/services/mcp-tools/beads.ts` | create_bead, update_bead, close_bead, list_beads, show_bead |
| `backend/src/services/mcp-tools/queries.ts` | list_agents, get_project_state, search_messages |
| `backend/src/services/message-store.ts` | SQLite message persistence, FTS5 search |
| `backend/src/routes/mcp.ts` | Express routes for /mcp/sse and /mcp/messages |
| `backend/src/index.ts` | Server startup, tool registration |

---

## 7. Troubleshooting

### "Connection refused" on MCP tools

**Cause**: Adjutant backend is not running.

```bash
# Check if server is up:
curl -s http://localhost:4201/health

# Start it:
cd /path/to/adjutant && npm run dev:backend
```

### Agent shows as "unknown-agent-xxxx" in dashboard

**Cause**: `ADJUTANT_AGENT_ID` env var was not set, and no `agentId` query param was on the SSE URL.

**Fix**: Set the env var before starting Claude Code, or hardcode the agent ID in the `.mcp.json` URL:
```json
{
  "mcpServers": {
    "adjutant": {
      "type": "sse",
      "url": "http://localhost:4201/mcp/sse?agentId=my-agent-name"
    }
  }
}
```

### MCP tools not available in Claude Code session

**Cause**: `.mcp.json` is missing from the project working directory, or the MCP connection failed silently.

**Fix**:
1. Verify `.mcp.json` exists in the working directory root
2. Verify the backend is running (health check above)
3. Restart the Claude Code session (MCP connections are established on session start)

### "Session not found" errors on tool calls

**Cause**: The SSE connection dropped (network issue, server restart) but the agent kept the stale session ID.

**Fix**: Restart the Claude Code session to re-establish the SSE connection. The MCP SDK handles reconnection automatically in most cases, but a full restart is the guaranteed fix.

### Agent messages not appearing in dashboard

**Cause**: Could be one of:
1. WebSocket not connected on the frontend (check browser console)
2. Message was sent but to wrong recipient (check `to` field)
3. SQLite database is locked (check backend logs for SQLITE_BUSY)

**Debug**:
```bash
# Check if message was stored:
sqlite3 ~/.adjutant/adjutant.db "SELECT id, agent_id, recipient, body FROM messages ORDER BY created_at DESC LIMIT 5;"
```

### Beads tools failing with "bd command failed"

**Cause**: The `bd` CLI is not installed or the `.beads` directory is missing.

**Fix**:
```bash
# Check bd is available:
which bd
bd version

# Check beads directory:
ls -la .beads/
```

### Agent connects but tools return "Unknown session"

**Cause**: The MCP server restarted (lost in-memory connection map) but the agent's SSE connection was not re-established.

**Fix**: Restart the agent's Claude Code session. The MCP connection map is in-memory only (not persisted to SQLite), so a server restart requires all agents to reconnect.

---

## 8. Fresh Machine Setup

Complete steps from zero:

```bash
# 1. Clone and install adjutant
git clone https://github.com/lupusdei/adjutant.git
cd adjutant
npm run install:all

# 2. Verify .mcp.json exists (should be in the repo)
cat .mcp.json

# 3. Start the backend
npm run dev

# 4. In a new terminal, verify MCP endpoint
curl -s http://localhost:4201/health
# {"status":"ok"}

# 5. Set agent ID and start Claude Code
export ADJUTANT_AGENT_ID="my-agent"
claude   # Claude Code will read .mcp.json and connect

# 6. Verify from within Claude Code session:
#    Use get_project_state tool -- should return connected agent info
```

For projects that are NOT the adjutant repo but need MCP connectivity:

```bash
# Copy .mcp.json to target project
cp /path/to/adjutant/.mcp.json /path/to/my-project/.mcp.json

# Optionally, hardcode agent ID in the URL:
# Edit .mcp.json to use ?agentId=project-worker in the URL

# Start Claude Code in that project directory
cd /path/to/my-project
export ADJUTANT_AGENT_ID="project-worker"
claude
```

---

## 9. Summary of Required Configuration

| What | Where | Purpose |
|------|-------|---------|
| `.mcp.json` | Project root | Tells Claude Code how to connect to Adjutant MCP server |
| `ADJUTANT_AGENT_ID` env var | Shell environment | Sets the agent's identity for server-side resolution |
| Adjutant backend | Running on `:4201` | Hosts MCP server, SQLite store, WebSocket broadcast |
| `adjutant-agent` plugin | `skills/mcp-tools/` | Documents available tools (loaded by skill system) |
| Spawn prompt instructions | Agent's initial prompt | Tells agent to use MCP tools for communication |

The minimum viable setup is: `.mcp.json` in the working directory + Adjutant backend running. Everything else is optional but recommended.

---

## 10. How Agents Discover Skills and MCP Tools

### Skill auto-loading

Claude Code discovers skills from `skills/` in the project directory on session start. The `adjutant-agent` plugin at `skills/mcp-tools/SKILL.md` is loaded automatically when an agent starts in any directory that has this path. This skill is **documentation only** — it tells the agent what MCP tools are available and how to use them. The actual MCP connection is established separately by `.mcp.json`.

For agents in **other project directories** (worktrees, separate repos), the skill is NOT automatically available unless `skills/mcp-tools/` exists in that directory. In most cases this is fine — the agent gets the MCP tools from `.mcp.json` regardless. The skill just provides usage documentation.

### MCP tool availability

When Claude Code starts, it reads `.mcp.json` from the project root and establishes SSE connections to all configured MCP servers. The MCP tools (`send_message`, `set_status`, etc.) are then available as callable tools in the agent's session. The agent does not need to do anything special — the tools appear in its tool list automatically.

### What agents DON'T know automatically

Even with the skill loaded and MCP connected, agents do **not** automatically:
- Check for pending messages on startup
- Respond to incoming messages via `send_message`
- Report status changes via `set_status`

These behaviors must be explicitly instructed in the **spawn prompt**. See section 4.2 for the mandatory spawn prompt template.

---

## 11. Message Response Protocol

### Agents MUST respond via MCP messaging

When an agent receives a message (from the user or another agent), it must respond using `send_message`, NOT by printing to stdout. Text output is only visible in the agent's terminal — the Adjutant dashboard and iOS app only see MCP messages.

### Spawn prompt requirement

Every agent spawn prompt must include explicit instructions to:

1. **Check messages on startup**: `read_messages({ limit: 5 })` to catch pending messages
2. **Respond via send_message**: Always use `send_message({ to: "user", body: "..." })` for replies
3. **Report status**: Use `set_status` for state transitions, `report_progress` for long tasks

Without these instructions, agents will have the MCP tools available but won't know to use them for communication. The spawn prompt template in section 4.2 covers this.

### Why agents don't auto-respond

MCP is a request/response protocol — agents call tools, they don't receive push notifications. There is no mechanism for the MCP server to "push" a message to an agent. Instead:

1. Messages sent to an agent are stored in SQLite
2. The agent must poll via `read_messages` to discover new messages
3. The spawn prompt tells the agent to check messages periodically

For real-time message delivery to agents running in tmux sessions, the backend also delivers messages directly to the agent's terminal pane (see `routes/messages.ts:150-161`).

---

## 12. API Key Authentication

### How auth works

The Adjutant backend uses optional API key authentication via `apiKeyAuth` middleware (defined in `backend/src/middleware/api-key.ts`).

**Behavior**:
- If **no API keys are configured** (`~/.gastown/api-keys.json` is empty or missing): ALL requests are allowed (open mode). This is the default for local development.
- If **API keys are configured**: requests must include a valid `Authorization: Bearer <api-key>` header.

### MCP routes are exempt from API key auth

MCP routes (`/mcp/sse` and `/mcp/messages`) are exempt from API key authentication. The `/mcp` path prefix is in the public prefixes list, so agent MCP connections work regardless of whether API keys are configured.

MCP has its own identity system (agentId resolved on SSE connect), so API key auth is unnecessary for these routes.

### When API keys ARE configured

If the Adjutant backend has API keys enabled (for remote/production use):

1. **REST API calls** from the frontend need a valid key via `Authorization: Bearer <key>` header
2. **MCP connections** from agents work without a key (exempt)
3. **WebSocket connections** at `/ws/chat` are not behind the Express middleware (they use the HTTP upgrade path)

### Generating an API key

```bash
# From the backend directory:
npx tsx -e "import { generateApiKey } from './src/services/api-key-service.js'; console.log(generateApiKey('my-label'))"
# Or use the /api/permissions endpoint if available
```

Keys are stored as SHA-256 hashes in `~/.gastown/api-keys.json`. The raw key is only shown once at generation time.
