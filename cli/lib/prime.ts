/**
 * PRIME.md content template for the Adjutant agent protocol.
 *
 * This is injected into Claude Code sessions via hooks (SessionStart, PreCompact)
 * so agents automatically know how to use MCP messaging, status reporting, and beads.
 */

export const PRIME_MD_CONTENT = `# Adjutant Agent Protocol

> **Context Recovery**: This file is auto-injected by Claude Code hooks on SessionStart and PreCompact.
> If you don't see this, run: \`adjutant init\` to register hooks.

## MCP Communication (MANDATORY)

You have MCP tools for communicating with the Adjutant dashboard and other agents.
These tools are connected via \`.mcp.json\` at the project root. **Always use MCP tools
for communication — never rely on stdout or text output alone.**

### Responding to Messages

When you receive a message (from the user or another agent), you **MUST** respond
using \`send_message\`, NOT by printing to stdout. The dashboard and iOS app only see
MCP messages.

- **On startup**: Call \`read_messages({ limit: 5 })\` to check for pending messages
- **During work**: Periodically check for new messages
- **When asked a question**: Reply via \`send_message({ to: "user", body: "..." })\`

### Sending Messages

\`\`\`
send_message({ to: "user", body: "Build complete. All tests pass." })
send_message({ to: "user", body: "Need clarification on X", threadId: "questions" })
\`\`\`

### Status Reporting

Report state changes so the dashboard shows your current activity:

\`\`\`
set_status({ status: "working", task: "Implementing feature X", beadId: "adj-013.2.1" })
set_status({ status: "blocked", task: "Waiting for API key" })
set_status({ status: "done" })
\`\`\`

### Progress on Long Tasks

\`\`\`
report_progress({ task: "adj-013.2", percentage: 50, description: "Halfway done" })
\`\`\`

### Announcements

For events that need dashboard attention:

\`\`\`
announce({ type: "completion", title: "Feature done", body: "All tests pass.", beadId: "adj-013.2" })
announce({ type: "blocker", title: "Need help", body: "Can't access the API", beadId: "adj-013.2" })
\`\`\`

## Bead Tracking

Use beads (\`bd\` CLI) for ALL task tracking. Do NOT use TaskCreate, TaskUpdate, or markdown files.

\`\`\`bash
bd update <id> --status=in_progress   # Before starting work
bd close <id>                          # After completing work
bd sync                                # Before shutting down
\`\`\`

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| \`send_message\` | Send a message (to, body, threadId) |
| \`read_messages\` | Read messages (threadId, agentId, limit) |
| \`set_status\` | Update agent status (working/blocked/idle/done) |
| \`report_progress\` | Report task progress (percentage, description) |
| \`announce\` | Broadcast announcement (completion/blocker/question) |
| \`create_bead\` | Create a bead (title, description, type, priority) |
| \`update_bead\` | Update bead fields (id, status, assignee) |
| \`close_bead\` | Close a bead (id, reason) |
| \`list_beads\` | List beads (status, assignee, type) |
| \`show_bead\` | Get bead details (id) |
| \`list_agents\` | List all agents (status) |
| \`get_project_state\` | Project summary |
| \`search_messages\` | Full-text search (query, limit) |
`;
