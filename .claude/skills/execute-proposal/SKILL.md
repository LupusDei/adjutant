# execute-proposal

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

2. **Report status** via MCP:
   ```
   set_status({ status: "working", task: "Executing proposal: <title>" })
   ```

3. **Acknowledge to user** via MCP:
   ```
   send_message({ to: "user", body: "Starting work on proposal: <title>. Fetching details and creating epic hierarchy." })
   ```

4. **Create the epic hierarchy** by invoking the epic-planner skill:
   ```
   /epic-planner <proposal title and description>
   ```
   Pass the full proposal title and description content to the epic planner so it can generate specs, plan, tasks, and beads.

5. **Report completion** via MCP:
   ```
   announce({ type: "completion", title: "Proposal executed: <title>", body: "Epic hierarchy created. See beads for task breakdown." })
   ```

## Notes

- If the proposal cannot be found, report the error to the user via `send_message` and stop.
- If you have questions about the proposal, send them to the user via `send_message({ to: "user", body: "..." })`. Do NOT block waiting for answers — continue with reasonable assumptions and note them.
- The proposal contains: title, description, type (product/engineering), project, author, and status.
