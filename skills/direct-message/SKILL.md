---
name: direct-message
description: Send a direct message to a specific agent via MCP messaging and tmux injection. Guarantees delivery by injecting the message as a submitted prompt into the agent's tmux session AND sending a persistent MCP message. Use when you need to message a specific agent and get a response, rather than broadcasting to everyone.
---

# Direct Message

Send a message directly to a specific agent — delivered via tmux prompt injection for immediate processing AND persistent MCP message for inbox history.

## Usage

```
/direct-message <agent-name> <message>
```

**Examples:**
- `/direct-message raynor Hey, did you finish the API refactor?`
- `/direct-message nova Please review the color scheme changes and report back.`
- `/direct-message stetmann Read your latest bead and send me a status update.`

## Instructions

When the user invokes `/direct-message <agent-name> <message>`, follow these steps exactly:

### Step 1: Parse the arguments

- **agent-name**: The first word after `/direct-message`
- **message**: Everything after the agent name — preserve it exactly (whitespace, punctuation, newlines)

If no agent name is provided, ask the user who they want to message.
If no message is provided, ask the user what they want to say.

### Step 2: Verify the agent exists

Call the MCP tool:
```
list_agents({ status: "all" })
```

Check that `<agent-name>` matches an agent in the roster (case-insensitive). If not found:
- Show the available agent names
- Ask the user to pick one or correct the name
- Do NOT proceed until a valid agent is confirmed

### Step 3: Check for a live tmux session

Run:
```bash
tmux list-sessions -F "#{session_name}" 2>/dev/null | grep -i "adj-swarm-{agent-name}" || echo "NO_SESSION"
```

This determines if the agent has an active tmux session at `adj-swarm-{agent-name}`.

### Step 4: Deliver via tmux (if session exists)

If a tmux session was found, inject the message as a submitted prompt:

```bash
tmux send-keys -t "adj-swarm-{agent-name}" -l "{message}"
tmux send-keys -t "adj-swarm-{agent-name}" Enter
```

**Critical details:**
- The `-l` flag is MANDATORY — it sends text literally, preventing tmux from interpreting spaces or special characters as key names
- `Enter` is sent as a SEPARATE `send-keys` command, never embedded in the message text
- If `send-keys` fails, note the error but continue to Step 5

### Step 5: Send persistent MCP message

Regardless of whether tmux delivery succeeded, always send a persistent MCP message:

```
send_message({ to: "{agent-name}", body: "{message}" })
```

This ensures:
- The message appears in the agent's MCP inbox
- The message is visible on the Adjutant dashboard
- The agent can read it even if they weren't active during tmux injection

### Step 6: Optionally request a response

If the message asks a question or requests information, append this instruction to BOTH the tmux and MCP message:

```
Please respond via Adjutant MCP: send_message({ to: "{your-agent-name}", body: "your response" })
```

This tells the receiving agent how to reply back through the proper channel.

### Step 7: Send delivery report

Send a report to the user via MCP AND print to stdout:

```
send_message({ to: "user", body: "<delivery report>" })
```

**Delivery report format:**

```
## Direct Message Delivery Report

**To:** {agent-name}
**Message:** {first 100 chars of message}...

**Delivery:**
- tmux prompt: {delivered | no session | failed: reason}
- MCP message: {sent | failed: reason}

**Response requested:** {yes | no}
```

### Step 8: Monitor for response (if applicable)

If the message requested a response, wait briefly (15-30 seconds) and check for a reply:

```
search_messages({ query: "{your-agent-name}", agentId: "{agent-name}", limit: 3 })
```

If a response arrives, relay it to the user via:
```
send_message({ to: "user", body: "{agent-name} responded: {response}" })
```

If no response after the initial wait, inform the user and move on — don't block indefinitely.

## Conversational Mode

For multi-exchange conversations (like the Kerrigan/Raynor volley), the invoking agent should:

1. Include explicit instructions in each message for the recipient to respond back:
   `"Reply to me (to: '{your-name}') with your answer and end with a question for me."`

2. After receiving a response, immediately send the next exchange without waiting for user prompting

3. Report each exchange to the user via MCP as it happens:
   ```
   send_message({ to: "user", body: "Exchange N/M — {agent} said: {summary}. I replied with: {summary}." })
   ```

4. If the recipient doesn't respond within ~30 seconds, re-inject via tmux with a nudge:
   ```bash
   tmux send-keys -t "adj-swarm-{name}" -l "{your-name} sent you a message. Read it: read_messages({ agentId: \"{your-name}\", limit: 3 }) and respond now."
   tmux send-keys -t "adj-swarm-{name}" Enter
   ```

## Notes

- This skill requires tmux to be installed and running
- If no tmux server is running, delivery falls back to MCP-only
- The tmux session naming convention `adj-swarm-{name}` matches the Adjutant swarm spawner pattern
- tmux injection submits the message as a real prompt — the agent processes it on their current or next turn
- MCP messages persist in the SQLite store and are visible on the dashboard
- Always use BOTH delivery methods for reliability — tmux for immediacy, MCP for persistence
- Do NOT send to your own tmux session — skip yourself if the target matches your agent name
