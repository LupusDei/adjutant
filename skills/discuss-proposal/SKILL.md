---
name: discuss-proposal
description: Discuss and review an improvement proposal with the user. Analyzes strengths, weaknesses, feasibility, and cost estimate. Records the review as a persistent comment on the proposal, and optionally creates a revision if concrete improvements are identified. Use when the user says "discuss proposal", "review proposal", "what do you think about this proposal", or references a proposal ID for discussion and refinement rather than execution.
---

# Discuss Proposal

Discuss a proposal with the user to refine it before accepting or dismissing. Your review is permanently recorded as a comment on the proposal, and you may create a revision if you identify concrete improvements.

## Usage

```
/discuss-proposal {proposalId}
```

## Instructions

You have been asked to discuss and review a proposal with the user. Follow these steps:

1. **Fetch the proposal** using the `get_proposal` MCP tool:
   ```
   get_proposal({ id: "{proposalId}" })
   ```

2. **Validate project match** — ensure this proposal belongs to your current project:
   - Call `get_project_state()` to determine your current project.
   - Compare `proposal.project` with the current project name.
   - If they do **not** match, gracefully decline:
     ```
     send_message({ to: "user", body: "Cannot discuss proposal '<title>' — it belongs to project '<proposal.project>' but I am currently scoped to project '<my-project>'. Please route this to an agent working on '<proposal.project>'.", threadId: "proposal-{proposalId}" })
     ```
     Do **not** change the proposal's status (leave it as-is). Stop execution here — do not proceed with the review.
   - If they match, continue to the next step.

3. **Check existing comments and revisions** to understand prior discussion:
   ```
   list_proposal_comments({ id: "{proposalId}" })
   list_revisions({ id: "{proposalId}" })
   ```

4. **Report status** via MCP:
   ```
   set_status({ status: "working", task: "Reviewing proposal: <title>" })
   ```

5. **Analyze the proposal** and send your analysis to the user via MCP:
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

6. **Record your review as a comment** on the proposal. This is mandatory — every review must be permanently attached to the proposal record:
   ```
   comment_on_proposal({ id: "{proposalId}", body: "<review summary>" })
   ```

   The comment body should be a concise summary of your review findings. It does not need to duplicate the full chat message — focus on the key points: strengths, weaknesses, and any recommended changes.

7. **Engage in discussion**: After sending your initial analysis, check for user responses periodically using `read_messages`. Respond to questions and refine your thinking based on feedback.

8. **If you identify concrete improvements**, create a revision. Follow these sub-steps in order:

   a. **Announce your intent to the user FIRST** — you must NOT silently revise. Send a message explaining exactly what you plan to change and why:
      ```
      send_message({ to: "user", body: "I'd like to revise this proposal. Here's what I plan to change:\n- <change 1 and reason>\n- <change 2 and reason>\nShall I proceed?", threadId: "proposal-{proposalId}" })
      ```

   b. **Wait for user confirmation** by checking `read_messages` — do not revise until the user agrees or the discussion makes it clear the changes are wanted.

   c. **Create the revision** with a meaningful changelog:
      ```
      revise_proposal({
        id: "{proposalId}",
        title: "Updated title if changed",
        description: "Updated description if changed",
        type: "product or engineering if changed",
        changelog: "Specific description of what changed and why — e.g. 'Added phased rollout plan for API coverage; corrected assumption about frontend Zod schemas'"
      })
      ```

      Only include the fields you are actually changing (title, description, type). Omit fields that remain the same. The `changelog` field is always required and must be descriptive — never use generic text like "updated proposal".

9. **When the discussion concludes**, suggest next steps:
   - Accept the proposal as-is
   - Accept with the revision already applied
   - Dismiss with reasoning
   - Continue discussion in a follow-up

## When to Comment vs. Revise

- **Always comment**: Every invocation of this skill must produce a `comment_on_proposal` call. The comment records your review for posterity, even if no changes are needed.
- **Revise only when you have concrete improvements**: If your review identifies specific, actionable changes to the proposal's title, description, or type, create a revision. Vague feedback ("could be better") is not grounds for a revision — that belongs in the comment only.
- **Comment AND revise**: When you do revise, still create the comment first. The comment captures your reasoning; the revision captures the changes.

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
- If ambiguous on multiple points, send ONE message with all questions numbered, then proceed with reasonable defaults

## Notes

- Keep the discussion threaded under `threadId: "proposal-{proposalId}"` so it stays organized.
- Be constructive — the goal is to improve the proposal, not just critique it.
- If the proposal cannot be found, report the error to the user via `send_message` and stop.
- The proposal contains: title, description, type (product/engineering), project, author, status, and revision history.
- If other agents have already commented or revised, acknowledge their input in your review rather than repeating the same points.
