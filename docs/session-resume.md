# Session Resume — after a crash, resume; don't respawn (adj-dpgqc)

On 2026-09-16 at 20:54 the fleet host kernel-panicked and rebooted. Every agent's tmux
session died. Every worktree, every uncommitted file and every Claude Code transcript
survived. Three agents were brought back by hand that night; this is that recipe, built
into Adjutant.

## Resume vs respawn

They are not interchangeable, and the difference is the whole point:

| | respawn | resume |
|---|---|---|
| Context | none — a fresh agent reading its spawn prompt | the session continues: its reasoning, its half-finished edits, what it had already ruled out |
| In-process teammates | gone | come back with the leader |
| Right when | the agent finished, or you want a different mission | the agent was mid-mission and the process died under it |

A respawned agent will often redo work it already did, or undo work it no longer
remembers doing. After a crash, resume.

## How

```
list_resumable_sessions({ agentName: "kerrigan" })
→ { sessions: [ { sessionId, cwd, modifiedAt, lastActivityAt, firstPrompt, lastPrompt, sizeBytes } ] }

spawn_worker({
  agentName: "kerrigan",
  resumeSessionId: "<sessionId from above>",
  resumeNote: "The host kernel-panicked at 20:54 and rebooted. Your worktree and uncommitted work are intact.",
})
```

`firstPrompt` is usually the spawn prompt, so it names the mission; `lastPrompt` is what
the agent was last told to do. Between them you can tell two sessions apart without
opening the transcript.

The dashboard reads the same list from `GET /api/agents/:agentId/sessions`.

**Always send a `resumeNote`.** It is the one thing the transcript cannot contain: what
happened while the agent was dead. Without it the agent picks up mid-thought with no idea
that time passed, that the host rebooted, or that its tmux session is new.

## After a reboot: survey first

```
plan_fleet_resume({})
→ { dryRun: true,
    resumable: [ { agentName, sessionId, lastActivityAt, lastPrompt, sessionCount, resumeCommand } ],
    skipped:   [ { agentName, reason: "running" | "no-transcript" } ] }
```

It spawns nothing. Each proposal carries the exact `spawn_worker` call that would execute
it, ordered newest-activity first, with what that agent was last asked to do. Bringing the
whole fleet back at once spends real tokens on agents nobody asked for and puts several of
them onto branches that have since moved — on the night of the panic the General resumed
kerrigan, watched it, then nova and zeratul, and left the rest down. The sweep keeps that
choice where it belongs.

## What the resume does and does not do

- Launches `claude --dangerously-skip-permissions --resume <id>` behind the same env
  prefix a normal spawn gets (`ADJUTANT_AGENT_ID`, `ADJUTANT_PROJECT_ROOT`,
  `ADJUTANT_PERSONA_ID`, `BEADS_DOLT_SERVER_PORT`) — adj-vevei, so the agent binds as
  itself and never as `unknown-agent-*`.
- Launches in the directory the transcript records, which is why it works for both
  worktree-isolated agents and the coordinator (no worktree, runs in the canonical
  checkout). A resume never provisions a worktree or creates a branch.
- Registers the session **before returning**, so the agent is injectable and
  terminal-streamable immediately. No second `spawn_worker` adoption call.
- Does **not** re-inject the constitution, the persona or a genesis prompt. All of it is
  already in the transcript, and re-injecting it would make boilerplate the agent's
  newest instruction — the fastest way to lose the thread it was on.

## Refusals, and why each one exists

- **No such session for this agent.** The resume searches the directories the agent could
  have run in (its worktree, the project root, any cwd the registry knows) and launches in
  the cwd the chosen transcript itself records. `claude --resume` resolves the id against
  the directory it starts in, so launching from the wrong one silently starts a different
  (or empty) session — a failure that looks like "the agent came back wrong", which is far
  more expensive than a refusal. If the id belongs to none of those directories, nothing
  is created and nothing is launched.
- **The agent's tmux session is already running.** That case is adoption, not resume.
  Resuming would put a second Claude on the same transcript and the same worktree.
- **Implausible session id.** The id is interpolated into a command line typed into a
  live shell. It is validated against the Claude session-id shape rather than escaped,
  and nothing is created when it fails.

## Where transcripts live

```
~/.claude/projects/<cwd with every non-alphanumeric char replaced by "->/<sessionId>.jsonl
```

Two traps, both of which have bitten this repo:

- The encoding is **not** just slash replacement. Agent `eric_ai` works in
  `.../worktrees/eric_ai`, and its transcripts are under `...-worktrees-eric-ai`.
  Use `claudeProjectDirName` from `transcript-discovery.ts`; do not write a second
  encoder (`jsonl-cost-reader`'s copy has this bug — adj-u2bfs).
- The directory name is lossy and cannot be reversed. The real `cwd` is read back out of
  the transcript instead.

Those directory names begin with `-`, so they look like CLI flags. Pass them as single
arguments to Node fs calls, never into a shell without `--`.

## Related

- `backend/src/services/transcript-discovery.ts` — discovery, with unit tests over real
  transcript line shapes
- `backend/src/services/lifecycle-manager.ts` — the resume launch
- adj-c55l3 — adoption no longer types `export …` into a live Claude pane
- adj-vevei — env prefix on the launch line
- adj-182.3.1 — the supervised Dolt port for worktree agents
