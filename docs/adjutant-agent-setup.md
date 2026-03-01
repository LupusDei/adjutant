# Adjutant Agent Setup and Configuration

**Purpose**: How to install and configure the `adjutant-agent` plugin so Claude Code agents automatically connect to the Adjutant MCP server and communicate via its messaging tools.

---

## 1. Quick Start

```bash
# Install adjutant globally
npm install -g adjutant

# Run init in any project directory
cd /path/to/your-project
adjutant init

# Start the adjutant backend (in a separate terminal)
cd /path/to/adjutant
npm run dev

# Start Claude Code — plugin hooks and MCP tools are now available
claude
```

Verify everything is healthy:

```bash
adjutant doctor
```

---

## 2. What `adjutant init` Does

Running `adjutant init` in a project directory performs these steps:

| Step | What | Why |
|------|------|-----|
| `~/.adjutant/PRIME.md` | Creates global default agent protocol file | Injected into every Claude Code session via plugin hooks |
| `.adjutant/PRIME.md` | Creates local override in current project | Project-specific agent instructions (takes priority over global) |
| `.mcp.json` | Creates/merges MCP server config | Tells Claude Code how to connect to the Adjutant backend |
| Plugin marketplace | Registers `LupusDei/adjutant` via `claude plugin marketplace add` | Makes the adjutant-agent plugin available for install |
| Plugin install | Installs `adjutant-agent` with user scope | Provides skills and hooks globally |
| Plugin enable | Enables the plugin in Claude Code settings | Activates hooks and skill loading |
| Legacy cleanup | Removes old manual hooks from `~/.claude/settings.json` | Prevents duplicate hook execution |

All steps are idempotent — safe to run multiple times. Use `--force` to overwrite existing PRIME.md files.

---

## 3. What the Plugin Provides

The `adjutant-agent` plugin provides two things:

### Hooks (automatic)

The plugin registers hooks via `.claude-plugin/plugin.json`:

- **SessionStart** — runs `adjutant prime` to inject PRIME.md into every new Claude Code session
- **PreCompact** — re-injects PRIME.md before context compaction so agent protocol survives compression

### Skills (loaded on demand)

Skills are loaded when Claude Code sessions start in a project with the plugin enabled:

| Skill | Purpose |
|-------|---------|
| `mcp-tools` | MCP messaging, status reporting, bead management via Adjutant tools |
| `epic-planner` | Structured epic hierarchy creation with speckit artifacts and beads |
| `broadcast-prompt` | Broadcast messages to all active agent tmux sessions |
| `direct-message` | Send targeted messages to specific agents via tmux + MCP |
| `discuss-proposal` | Review and analyze improvement proposals |
| `execute-proposal` | Turn accepted proposals into actionable epic hierarchies |

---

## 4. PRIME.md Resolution

`adjutant prime` looks for PRIME.md in this order:

1. `.adjutant/PRIME.md` in the current working directory (project-specific override)
2. `~/.adjutant/PRIME.md` (global default, created by `adjutant init`)
3. Embedded fallback (bundled with the adjutant package)

This means you can customize agent behavior per-project by editing `.adjutant/PRIME.md`, while the global default covers all other projects.

---

## 5. MCP Connection

### How it works

The `.mcp.json` file at the project root tells Claude Code how to connect to the Adjutant MCP server:

```json
{
  "mcpServers": {
    "adjutant": {
      "command": "npx",
      "args": ["-y", "supergateway", "--sse", "http://localhost:4201/mcp/sse"]
    }
  }
}
```

`adjutant init` creates this file automatically. The MCP connection uses [supergateway](https://github.com/nichochar/supergateway) to bridge Claude Code's stdio-based MCP transport to Adjutant's SSE endpoint.

### Agent identity

When an agent connects to the MCP SSE endpoint, the server resolves identity through:
1. **Query param** `agentId` on the SSE URL (highest priority)
2. **Header** `X-Agent-Id` (fallback)
3. **Auto-generated** `unknown-agent-<uuid>` (last resort)

Identity is resolved **server-side** in `mcp-server.ts:resolveAgentId()`. Agents do not self-identify in tool calls — the server maps the MCP session to the agent ID established at connection time.

### Verify the connection

```bash
# Check backend health
curl -s http://localhost:4201/health
# Expected: {"status":"ok"}

# Check MCP SSE endpoint
curl -s -N http://localhost:4201/mcp/sse?agentId=test-probe
# Expected: SSE stream begins (Ctrl+C to disconnect)
```

---

## 6. MCP Tool Reference

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

## 7. Agent Spawn Configuration

### What agents need in their spawn prompt

When spawning a teammate, the spawn prompt must include:

1. **Working directory** must contain `.mcp.json` (created by `adjutant init`)
2. **Explicit instructions** to use MCP tools for communication
3. **Bead assignments** if using beads for task tracking

### Spawn prompt template

Include this block in every agent spawn prompt:

```
## Communication (MANDATORY)

You have MCP tools for communicating with the dashboard and user.

**Report status changes:**
- When starting work: set_status({ status: "working", task: "Description" })
- When blocked: set_status({ status: "blocked", task: "What's blocking you" })
- When done: set_status({ status: "done" })

**Send messages to the user:**
- Progress updates: send_message({ to: "user", body: "Completed X, moving to Y" })
- Questions: send_message({ to: "user", body: "Need clarification on..." })
- Completions: announce({ type: "completion", title: "Task done", body: "Details..." })

**Report progress on long tasks:**
- report_progress({ task: "adj-xxx", percentage: 50, description: "Halfway done" })

Do NOT just print status to stdout. Use the MCP tools so the dashboard sees your state.
```

### For agents in other directories

If the agent works in a different directory (e.g., a worktree), ensure `.mcp.json` is present:

```bash
# Option 1: Run adjutant init there
cd /path/to/worktree && adjutant init

# Option 2: Copy from an existing project
cp /path/to/project/.mcp.json /path/to/worktree/.mcp.json
```

---

## 8. Plugin Management

### Update to latest version

```bash
# Update marketplace catalog from GitHub
claude plugin marketplace update adjutant-agent

# Update the installed plugin
claude plugin update adjutant-agent@adjutant-agent
```

Restart Claude Code after updating for changes to take effect.

### Check plugin status

```bash
claude plugin list
```

### Development mode

For local plugin development without installing from GitHub:

```bash
claude --plugin-dir /path/to/adjutant
```

This loads the plugin ephemerally for a single session, using the local `.claude-plugin/` directory.

### Manual plugin commands

```bash
claude plugin marketplace add LupusDei/adjutant        # Register marketplace
claude plugin install adjutant-agent --scope user       # Install plugin
claude plugin enable adjutant-agent@adjutant-agent      # Enable plugin
claude plugin disable adjutant-agent@adjutant-agent     # Disable plugin
claude plugin uninstall adjutant-agent@adjutant-agent   # Uninstall
claude plugin marketplace remove adjutant-agent         # Remove marketplace
```

---

## 9. Fresh Machine Setup

Complete steps from zero:

```bash
# 1. Install adjutant
npm install -g adjutant

# 2. Clone and set up the adjutant project (for dashboard)
git clone https://github.com/LupusDei/adjutant.git
cd adjutant
npm run install:all

# 3. Initialize (registers plugin, creates configs)
adjutant init

# 4. Start the backend
npm run dev

# 5. Verify
adjutant doctor
curl -s http://localhost:4201/health  # {"status":"ok"}

# 6. In any other project, set up MCP connection
cd /path/to/my-project
adjutant init    # Creates .mcp.json + .adjutant/PRIME.md

# 7. Start Claude Code — plugin hooks and MCP tools are active
claude
```

---

## 10. API Key Authentication

### How auth works

The Adjutant backend uses optional API key authentication via `apiKeyAuth` middleware.

- If **no API keys are configured** (`~/.adjutant/api-keys.json` is empty or missing): ALL requests are allowed (open mode). This is the default for local development.
- If **API keys are configured**: requests must include a valid `Authorization: Bearer <api-key>` header.

### MCP routes are exempt

MCP routes (`/mcp/sse` and `/mcp/messages`) are exempt from API key authentication. Agent MCP connections work regardless of whether API keys are configured.

---

## 11. Troubleshooting

### "Connection refused" on MCP tools

**Cause**: Adjutant backend is not running.

```bash
curl -s http://localhost:4201/health
cd /path/to/adjutant && npm run dev:backend
```

### Agent shows as "unknown-agent-xxxx" in dashboard

**Cause**: No `agentId` was provided on the SSE connection.

**Fix**: The supergateway bridge in `.mcp.json` doesn't pass agent identity by default. For now, agents are identified by the MCP session. Future versions will support agent ID passthrough.

### MCP tools not available in Claude Code session

**Cause**: `.mcp.json` is missing from the working directory, or the backend is down.

**Fix**:
1. Run `adjutant init` in the project directory
2. Verify the backend is running
3. Restart Claude Code (MCP connections are established on session start)

### Plugin not loading

```bash
# Check plugin status
claude plugin list

# If not installed, re-run init
adjutant init

# If installed but failing, check the cache
ls ~/.claude/plugins/cache/adjutant-agent/adjutant-agent/
```

### "Session not found" errors on tool calls

**Cause**: SSE connection dropped (server restart, network issue).

**Fix**: Restart the Claude Code session to re-establish the SSE connection.

### Agent messages not appearing in dashboard

**Debug**:
```bash
sqlite3 ~/.adjutant/adjutant.db "SELECT id, agent_id, recipient, body FROM messages ORDER BY created_at DESC LIMIT 5;"
```

### Beads tools failing with "bd command failed"

```bash
which bd       # Check bd is installed
bd version     # Check version
ls -la .beads/ # Check beads directory exists
```

---

## 12. Architecture Reference

### Message flow: Agent to User

```
Agent calls send_message via MCP
  -> MCP tool handler in messaging.ts
  -> Message stored in SQLite (message-store.ts)
  -> WebSocket broadcast to dashboard clients (ws-server.ts)
  -> If recipient is "user", APNS push to iOS
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
  -> supergateway bridges stdio MCP to SSE
  -> SSE connection to GET /mcp/sse
  -> Server creates AgentConnection, maps sessionId -> agentId
  -> All MCP tool calls routed through POST /mcp/messages?sessionId=<id>
  -> On disconnect: auto-cleanup via transport.onclose
```

### Key files

| File | Purpose |
|------|---------|
| `.mcp.json` | MCP server configuration (per-project) |
| `.claude-plugin/plugin.json` | Plugin hooks (SessionStart, PreCompact) |
| `.claude-plugin/marketplace.json` | Plugin marketplace definition |
| `skills/` | Skill definitions (mcp-tools, epic-planner, etc.) |
| `cli/lib/plugin.ts` | Plugin installation logic |
| `cli/commands/prime.ts` | PRIME.md output command |
| `cli/commands/init.ts` | Project initialization |
| `cli/commands/doctor.ts` | Health checks |
| `backend/src/services/mcp-server.ts` | MCP server, connection tracking |
| `backend/src/services/mcp-tools/` | MCP tool handlers |
| `backend/src/services/message-store.ts` | SQLite message persistence |
