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

## Notes

- If the proposal cannot be found, report the error to the user via `send_message` and stop.
- If you have questions about the proposal, send them to the user via `send_message({ to: "user", body: "..." })`. Do NOT block waiting for answers -- continue with reasonable assumptions and note them.
- The proposal contains: title, description, type (product/engineering), project, author, and status.
