---
name: execute-proposal
description: Execute an accepted proposal by fetching it from the backend and orchestrating epic creation via the epic-planner skill. Use when the user says "execute proposal", "implement proposal", "start working on proposal X", or wants to turn a proposal into an actionable epic hierarchy with beads.
---

# Execute Proposal

Execute an accepted proposal by fetching it from the backend and orchestrating epic creation.

## Usage

```
/execute-proposal {proposalId}
```

## Instructions

You have been asked to execute a proposal. Follow these steps:

1. **Fetch the proposal** using the `get_proposal` MCP tool:
   ```
   get_proposal({ id: "{proposalId}" })
   ```

2. **Validate project match** — ensure this proposal belongs to your current project:
   - Call `get_project_state()` to determine your current project.
   - Compare `proposal.project` with the current project name.
   - If they do **not** match, gracefully decline:
     ```
     send_message({ to: "user", body: "Cannot execute proposal '<title>' — it belongs to project '<proposal.project>' but I am currently scoped to project '<my-project>'. Please route this to an agent working on '<proposal.project>'." })
     ```
     Do **not** change the proposal's status (leave it as-is). Stop execution here — do not proceed to epic creation.
   - If they match, continue to the next step.

3. **Report status** via MCP:
   ```
   set_status({ status: "working", task: "Executing proposal: <title>" })
   ```

4. **Acknowledge to user** via MCP:
   ```
   send_message({ to: "user", body: "Starting work on proposal: <title>. Fetching details and creating epic hierarchy." })
   ```

5. **Create the epic hierarchy** by invoking the epic-planner skill:
   ```
   adjutant-agent:epic-planner <proposal title and description>
   ```
   Pass the full proposal title and description content to the epic planner so it can generate specs, plan, tasks, and beads.

6. **Report completion** via MCP:
   ```
   announce({ type: "completion", title: "Proposal executed: <title>", body: "Epic hierarchy created. See beads for task breakdown." })
   ```

## Notes

- If the proposal cannot be found, report the error to the user via `send_message` and stop.
- If you have questions about the proposal, send them to the user via `send_message({ to: "user", body: "..." })`. Do NOT block waiting for answers -- continue with reasonable assumptions and note them.
- The proposal contains: title, description, type (product/engineering), project, author, and status.
