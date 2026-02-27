---
description: Discuss and review an improvement proposal with the user. Analyzes strengths, weaknesses, feasibility, and cost estimate. Use when the user says "discuss proposal", "review proposal", or references a proposal ID for discussion.
handoffs:
  - label: Execute This Proposal
    agent: adjutant.execute-proposal
    prompt: Execute this proposal
---

## User Input

```text
$ARGUMENTS
```

# Discuss Proposal

Discuss a proposal with the user to refine it before accepting or dismissing.

## Usage

```
/adjutant.discuss-proposal {proposalId}
```

## Instructions

The `$ARGUMENTS` above is the proposal ID. Follow these steps:

1. **Fetch the proposal** using the `get_proposal` MCP tool:
   ```
   get_proposal({ id: "{proposalId}" })
   ```

2. **Report status** via MCP:
   ```
   set_status({ status: "working", task: "Discussing proposal: <title>" })
   ```

3. **Analyze the proposal** and send your analysis to the user via MCP:
   ```
   send_message({ to: "user", body: "<your analysis>", threadId: "proposal-{proposalId}" })
   ```

   Your analysis should cover:
   - **Strengths**: What's good about this proposal?
   - **Weaknesses**: What could be improved or is missing?
   - **Feasibility**: How complex is implementation? What are the risks?
   - **Cost estimate**: Rough effort estimate (small/medium/large)
   - **Suggestions**: Specific improvements or alternatives
   - **Questions**: Anything unclear that needs user input

4. **Engage in discussion**: After sending your initial analysis, check for user responses periodically using `read_messages`. Respond to questions and refine the proposal based on feedback.

5. **When the user is satisfied**, suggest next steps:
   - Accept the proposal as-is
   - Accept with modifications (describe what to change)
   - Dismiss with reasoning
   - Create a revised proposal via `create_proposal`

## Notes

- Keep the discussion threaded under `threadId: "proposal-{proposalId}"` so it stays organized.
- Be constructive -- the goal is to improve the proposal, not just critique it.
- If the proposal cannot be found, report the error to the user via `send_message` and stop.
- The proposal contains: title, description, type (product/engineering), project, author, and status.
