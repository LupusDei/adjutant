---
description: Execute an accepted proposal by fetching it from the backend and orchestrating epic creation via the epic planner. Use when the user says "execute proposal", "implement proposal", or wants to turn a proposal into an actionable epic hierarchy with beads.
handoffs:
  - label: Plan the Epic
    agent: adjutant.epic-planner
    prompt: Create an epic hierarchy for this feature
---

## User Input

```text
$ARGUMENTS
```

# Execute Proposal

Execute an accepted proposal by fetching it from the backend and orchestrating epic creation.

## Usage

```
/adjutant.execute-proposal {proposalId}
```

## Instructions

The `$ARGUMENTS` above is the proposal ID. Follow these steps:

1. **Fetch the proposal** using the `get_proposal` MCP tool:
   ```
   get_proposal({ id: "{proposalId}" })
   ```

2. **Report status** via MCP:
   ```
   set_status({ status: "working", task: "Executing proposal: <title>" })
   ```

3. **Acknowledge to user** via MCP:
   ```
   send_message({ to: "user", body: "Starting work on proposal: <title>. Fetching details and creating epic hierarchy." })
   ```

4. **Create the epic hierarchy** by invoking the epic planner:
   ```
   /adjutant.epic-planner <proposal title and description>
   ```
   Pass the full proposal title and description content to the epic planner so it can generate specs, plan, tasks, and beads.

5. **Report completion** via MCP:
   ```
   announce({ type: "completion", title: "Proposal executed: <title>", body: "Epic hierarchy created. See beads for task breakdown." })
   ```

## Question Routing (MANDATORY)

**All questions about the proposal MUST be sent to the user via Adjutant MCP messages.** This is non-negotiable.

```
send_message({ to: "user", body: "Question about proposal '<title>': <your question>" })
```

**Rules:**
- Do NOT use `AskUserQuestion` — it blocks execution and the user may not be at the terminal
- Do NOT print questions to stdout — the user monitors agents via the Adjutant dashboard, not terminal output
- Do NOT block waiting for answers — send the question via MCP, note your assumption, and continue
- If you make assumptions, state them clearly in the MCP message so the user can correct you later
- If the proposal is ambiguous on multiple points, send ONE message with all questions numbered, then proceed with reasonable defaults

**Example:**
```
send_message({ to: "user", body: "Questions about proposal 'Consolidate Zod schemas':\n1. Should MCP-only tools (coordination.ts) be consolidated too, or just tools with REST counterparts?\n2. Should we update the existing unused SendMessageRequestSchema or create a new canonical one?\n\nProceeding with assumptions: (1) MCP-only tools left alone, (2) update existing schema." })
```

When spawning team agents to work on the epic, include this same instruction in their spawn prompts — they must also route questions through MCP, not stdout.

## Notes

- If the proposal cannot be found, report the error to the user via `send_message` and stop.
- The proposal contains: title, description, type (product/engineering), project, author, and status.
