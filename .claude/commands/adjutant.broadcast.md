---
description: Broadcast a message into every active agent's Claude Code tmux session as a submitted prompt. Also sends persistent MCP messages as backup. Use when you need to inject a standing order or announcement into all running agents at once.
---

## User Input

```text
$ARGUMENTS
```

# Broadcast Prompt

Deliver a message directly into every active agent's Claude Code prompt -- submitted as a real prompt (with Enter) -- and send a persistent MCP message copy.

## Instructions

The `$ARGUMENTS` above is the message to broadcast. Preserve it exactly -- whitespace, punctuation, newlines, all of it.

### Step 1: Discover agents

Call the MCP tool:
```
list_agents({ status: "all" })
```

Record the full agent roster with their names and statuses.

### Step 2: Discover live tmux sessions

Run:
```bash
tmux list-sessions -F "#{session_name}" 2>/dev/null || true
```

This gives you every active tmux session name. Agent sessions use the naming convention `adj-swarm-{agentname}`.

### Step 3: Match agents to sessions

For each agent from Step 1:
- Check if a tmux session named `adj-swarm-{agentname}` exists in the Step 2 output
- Skip yourself (the executing agent) -- do NOT send to your own session
- Build three lists:
  - **tmux_targets**: agents with a matching live tmux session (will get prompt + MCP message)
  - **mcp_only**: agents without a tmux session (will get MCP message only)
  - **skipped**: yourself

### Step 4: Deliver to each tmux target

For each agent in `tmux_targets`, run these two commands sequentially:

```bash
tmux send-keys -t "adj-swarm-{name}" -l "{message}"
tmux send-keys -t "adj-swarm-{name}" Enter
```

**Critical details:**
- The `-l` flag is mandatory -- it sends the text literally, preventing tmux from interpreting spaces or special characters as key names
- `Enter` is sent as a **separate** `send-keys` command, not embedded in the text
- If `send-keys` fails for a specific agent, move that agent from `tmux_targets` to `mcp_only` and note the error

### Step 5: Send persistent MCP messages

For every agent in both `tmux_targets` and `mcp_only` (everyone except yourself), send:

```
send_message({ to: "{agentname}", body: "{message}" })
```

This ensures agents that reconnect later still see the message in their inbox.

### Step 6: Build and send the delivery report

Send a summary to the user:

```
send_message({ to: "user", body: "<delivery report>" })
```

The delivery report should contain:

```
## Broadcast Delivery Report

**Message:** {first 100 chars of message}...

**Delivered via tmux prompt ({count}):**
- agent-a
- agent-b

**MCP message only -- no tmux session ({count}):**
- agent-c

**Skipped (self):**
- {your-name}
```

Also print the delivery report to stdout so the invoking user sees it immediately.

## Notes

- This skill requires tmux to be installed and running
- If no tmux server is running, all agents will fall back to MCP-only delivery
- The tmux session naming convention `adj-swarm-{name}` matches the Adjutant swarm spawner pattern
- Messages sent via tmux are immediately submitted as prompts -- agents will process them on their next turn
