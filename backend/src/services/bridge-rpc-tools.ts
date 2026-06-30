/**
 * The Bridge — RPC tool descriptors (adj-202.7 / adj-202.4.1).
 *
 * These are the `backend_rpc` tool definitions handed to Runway at session-create
 * time so GWM-1 (the avatar's model) KNOWS the tools exist and can invoke them mid-
 * conversation. Without them the avatar has nothing to call and a status question
 * stalls forever ("querying…").
 *
 * Two groups:
 *   - the five READ-ONLY fleet tools (mirror {@link BRIDGE_READONLY_TOOLS}); the
 *     avatar never speaks a project UUID, so `projectId` is NOT a model-visible
 *     parameter — it is injected server-side from session context.
 *   - the `send_message` COMMAND tool (adj-202.4.1) so the avatar can DIRECT agents
 *     by name. Its contract is just { to, body } — no project/epic/bead id, ever.
 *
 * Runway tool-parameter shape (verified against the avatars-sdk-react `nextjs-rpc-*`
 * examples): `{ name, type, description }`. There is no enum field, so allowed values
 * are spelled out in each description. `timeoutSeconds` must be <= 8 (Runway max).
 */

import type { RunwayRpcToolDef } from "./runway-client.js";

/**
 * Prefix applied to the text injected into a directed agent's live session, so the
 * agent knows the message is a command directive relayed through The Bridge (the
 * persisted/broadcast message is additionally attributed to the "adjutant" sender).
 */
export const BRIDGE_DIRECTIVE_PREFIX = "[Command directive via The Bridge] ";

/**
 * The `backend_rpc` tool descriptors. The read-only names stay in lockstep with
 * {@link BRIDGE_READONLY_TOOLS} (drift is caught by bridge-rpc-tools.test.ts);
 * `send_message` is the lone write/command tool.
 */
export const BRIDGE_RPC_TOOLS: RunwayRpcToolDef[] = [
  {
    type: "backend_rpc",
    name: "list_agents",
    description:
      "List the fleet's agents (the crew roster) with their status and connection state. Use this whenever the Commander asks who is working, the roster, or crew status.",
    parameters: [
      {
        name: "status",
        type: "string",
        description: 'Optional filter: "active" (working/blocked/stuck), "idle", or "all" (default).',
      },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "get_agent_detail",
    description:
      "Find out what a SPECIFIC agent is working on, by NAME (e.g. \"swann\"). Returns their status plus the beads they currently have IN PROGRESS. Use this whenever the Commander asks what someone is doing or working on — list_agents alone usually won't show an agent's current task.",
    parameters: [
      { name: "agent", type: "string", description: "The agent's name (e.g. \"swann\", \"fenix\")." },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "list_questions",
    description:
      "List open agent questions awaiting the Commander, sorted blocking → high → normal → low. Use when asked what needs a decision, what is blocking, or the triage queue.",
    parameters: [
      {
        name: "status",
        type: "string",
        description: 'Optional: "open" (default), "answered", or "dismissed".',
      },
      {
        name: "category",
        type: "string",
        description: 'Optional: "decision", "clarification", "approval", "action_required", or "other".',
      },
      { name: "agentId", type: "string", description: "Optional: only questions filed by this agent." },
      {
        name: "urgency",
        type: "string",
        description: 'Optional: "blocking", "high", "normal", or "low".',
      },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "list_beads",
    description:
      "List issues (beads) for the currently selected project — epics, tasks, and bugs. Use when asked about open work, what's in progress, or the backlog.",
    parameters: [
      {
        name: "status",
        type: "string",
        description: 'Optional: "open", "in_progress", "closed", or "all".',
      },
      { name: "assignee", type: "string", description: "Optional: only beads assigned to this person." },
      { name: "type", type: "string", description: 'Optional: "epic", "task", or "bug".' },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "get_project_state",
    description:
      "Get a snapshot of the currently selected project: connected agents, open beads, and recent message activity. Use for a general 'how are we doing' briefing on the project.",
    parameters: [],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "get_auto_develop_status",
    description:
      "Get the auto-develop loop status for the currently selected project (phase, active proposal, progress). Use when asked whether auto-develop is running or what phase it's in.",
    parameters: [],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "read_messages",
    description:
      "Read recent agent/user messages to RECALL what was said earlier. You NEVER need a conversation id or any other id — to read a specific agent's thread just pass that agent's NAME in agentId (e.g. \"fenix\"); to read fleet-wide recent traffic, omit everything. The lookup resolves the conversation for you. The structured result is the source of truth.",
    parameters: [
      { name: "agentId", type: "string", description: "Optional agent NAME (e.g. \"fenix\"). This is all you need to read one agent's thread — no id required." },
      { name: "limit", type: "number", description: "Optional max messages to return (default 10, capped at 15)." },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "query_memories",
    description:
      "RECALL what you've learned across sessions — the Commander's stated preferences, past decisions, recorded corrections, and fleet patterns. Use this BEFORE answering when the Commander's preferences or prior context matter, so you stay consistent over time. Omit everything for the most recent learnings, pass a text 'query' to search, or filter by category/topic/confidence. The structured result is the source of truth.",
    parameters: [
      { name: "query", type: "string", description: "Optional full-text search over learnings (e.g. \"deploy preferences\")." },
      { name: "category", type: "string", description: 'Optional: "operational", "technical", "coordination", or "project".' },
      { name: "topic", type: "string", description: "Optional exact topic to filter by." },
      { name: "minConfidence", type: "number", description: "Optional minimum confidence 0-1." },
      { name: "limit", type: "number", description: "Optional max learnings to return (default 8, capped at 10)." },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "send_message",
    description:
      "Message any agent by name to direct the swarm (e.g. tell 'kerrigan' to start a task). You do NOT need a project, epic, or bead id — just the agent's name and what to say. Also accepts 'user' to message the Commander. Use this readily to relay the Commander's direction.",
    parameters: [
      {
        name: "to",
        type: "string",
        description: "Recipient: an agent's name (e.g. \"kerrigan\"), or \"user\" to message the Commander.",
      },
      { name: "body", type: "string", description: "The message / directive to send." },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "nudge_agent",
    description:
      "Poke / redirect an agent that's already running by NAME — a quick prompt straight into their session (e.g. refocus them, ask for a status update). No IDs needed. Use to redirect an active agent rather than start a conversation.",
    parameters: [
      { name: "agentId", type: "string", description: "The agent's name to nudge (e.g. \"kerrigan\")." },
      { name: "message", type: "string", description: "The nudge / redirect prompt." },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "answer_question",
    description:
      "Resolve an open triage question the fleet is waiting on (use the questionId from list_questions). Provide answerBody (free text) and/or chosenOption (one of the question's suggested options). No other IDs needed.",
    parameters: [
      { name: "questionId", type: "string", description: "The id of the open question to answer (from list_questions)." },
      { name: "answerBody", type: "string", description: "Free-text answer. Provide this and/or chosenOption." },
      {
        name: "chosenOption",
        type: "string",
        description: "One of the question's suggested options. Provide this and/or answerBody.",
      },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "create_bead",
    description:
      "File a work item (bead) for the swarm. Only a title is required; description and type ('task' default, or 'epic'/'bug') are optional. It lands in the currently selected project automatically — you do NOT need a project, epic, or parent id.",
    parameters: [
      { name: "title", type: "string", description: "Short title of the work item." },
      { name: "description", type: "string", description: "Optional details (defaults to the title)." },
      { name: "type", type: "string", description: 'Optional: "task" (default), "epic", or "bug".' },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "spawn_worker",
    description:
      "START a new agent to work on a task. HEAVY action — you MUST confirm first: call this WITHOUT confirm to get a read-back summary (nothing is spawned), state that plan to the Commander, and only call again with confirm:true once they say yes. You need NO IDs — at most a project NAME (defaults to the selected project, or 'adjutant'). Give the role and the task.",
    parameters: [
      { name: "agentType", type: "string", description: 'The role to spawn, e.g. "engineer" or "qa".' },
      { name: "task", type: "string", description: "What the new agent should work on (the objective)." },
      {
        name: "project",
        type: "string",
        description: "Optional project NAME to spawn on (defaults to the selected project, or 'adjutant'). Never a UUID.",
      },
      {
        name: "confirm",
        type: "boolean",
        description: "Must be true to actually spawn. Omit it on the first call to get a read-back the Commander must confirm.",
      },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "store_memory",
    description:
      "REMEMBER something the Commander told you so you improve over time — a stated preference, a decision, a fact worth keeping across sessions. Use this proactively whenever the Commander expresses a preference or makes a decision. Give the learning's content, a category, and a short topic. No IDs needed.",
    parameters: [
      { name: "content", type: "string", description: "The learning to remember (the preference / decision / fact)." },
      {
        name: "category",
        type: "string",
        description: 'One of: "operational", "technical", "coordination", or "project".',
      },
      { name: "topic", type: "string", description: "A short topic label for this learning (e.g. \"deploy\", \"tone\")." },
      { name: "confidence", type: "number", description: "Optional confidence 0-1 (default 0.5)." },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "reinforce_memory",
    description:
      "Strengthen a learning you already hold because the Commander reaffirmed it — bumps its confidence. Use the id from query_memories. No other IDs needed.",
    parameters: [
      { name: "id", type: "number", description: "The learning id to reinforce (from query_memories)." },
    ],
    timeoutSeconds: 8,
  },
  {
    type: "backend_rpc",
    name: "record_correction",
    description:
      "Capture a CORRECTION the Commander gave you — the wrong pattern/assumption and the right approach — so you don't repeat the mistake. Use this whenever the Commander corrects you. Auto-deduplicates if you've recorded the same correction before.",
    parameters: [
      { name: "correctionType", type: "string", description: 'Kind of correction, e.g. "wrong_assumption" or "wrong_approach".' },
      { name: "wrongPattern", type: "string", description: "The wrong pattern or assumption being corrected." },
      { name: "rightPattern", type: "string", description: "The correct pattern or approach to use instead." },
      { name: "context", type: "string", description: "Optional context about when this correction came up." },
    ],
    timeoutSeconds: 8,
  },
];

/**
 * The default per-session persona for the Bridge avatar. It tells GWM-1 it is the
 * Adjutant fleet coordinator, that the read-only tools exist, and — crucially —
 * to CALL them (rather than stall) and to ground every answer in the structured
 * result the tool returns (never invent fleet numbers; the readout is the truth).
 */
export const BRIDGE_RPC_PERSONALITY = `You are the Adjutant — the fleet coordinator's conversational body. Address the user as Commander.

You can query live fleet state using these read-only tools. CALL the matching tool whenever the Commander asks — never say "querying" and stall; never guess or invent numbers.
- list_agents — the crew roster and who is working (the agent roster / crew status).
- get_agent_detail — what a SPECIFIC agent is working on (their status + in-progress beads). Use this whenever asked what someone is doing; list_agents alone often won't show it.
- list_questions — open questions awaiting a decision (the triage queue / what's blocking).
- list_beads — issues for the selected project (open work / backlog).
- get_project_state — a snapshot of the selected project.
- get_auto_develop_status — the auto-develop loop status for the selected project.
- read_messages — recall what was said EARLIER between agents/the Commander; use it to give context on prior/past discussions. Pass an agent NAME to focus on their thread; otherwise it reads recent fleet-wide. The structured result is the source of truth.
- query_memories — RECALL what you've LEARNED across sessions: the Commander's stated preferences, past decisions, recorded corrections, and fleet patterns. The structured result is the source of truth.

After a tool returns, narrate its STRUCTURED result faithfully and conversationally. The returned data is the source of truth. If a tool reports it needs a project and none is selected, say so plainly and ask the Commander to select one. Keep answers brief and grounded. An agent can be idle (no live session) yet still own in-progress work — so if list_agents shows no "active" agents, that does NOT mean nobody has work; call get_agent_detail for whoever the Commander asks about to report their assigned beads.

You can also DIRECT the swarm with these command tools — act on the Commander's intent right away and confirm what you did:
- send_message — message any agent BY NAME (or "user" to reach the Commander).
- nudge_agent — poke / redirect an agent that's already running, by name.
- answer_question — resolve an open question from list_questions (give answerBody and/or chosenOption).
- create_bead — file a work item; it lands in the selected project automatically (only a title is required).

MEMORY DOCTRINE — you have a persistent, constantly-improving memory; USE it so you get better over time:
- RECALL before you answer: when the Commander's preferences, past decisions, or prior context matter, call query_memories FIRST and let what you've learned shape your answer — so you stay consistent across sessions instead of starting fresh each time.
- RECORD as you go: proactively persist what the Commander tells you. When they state a preference or make a decision, call store_memory. When they CORRECT you, call record_correction (the wrong pattern and the right approach) so you never repeat the mistake. When they reaffirm something you already hold, call reinforce_memory. These are reversible — record decisively without asking permission, then briefly confirm you've noted it.

You can also START a new agent — but spawn_worker is HEAVY (it consumes a session slot and real money) and is NOT a reversible, act-decisively action. It is GATED behind an explicit confirmation:
- spawn_worker — start a new agent on a task. The act-decisively doctrine below does NOT apply to it. You MUST read back the plan first: call spawn_worker WITHOUT confirm — it returns a read-back summary and does NOT spawn — then STATE that plan to the Commander out loud, naming (a) the agent name if one is chosen, (b) the role / persona, (c) the target project, and (d) the task / bead, and then WAIT for an explicit, unambiguous affirmative ("yes, spawn it", "go ahead") before you call spawn_worker again with confirm:true. Do NOT treat ambiguous musing or thinking-out-loud (e.g. "maybe we need another engineer", "we could use some help") as assent — that is NOT a yes; ask "shall I spawn it?" and wait. When in doubt, do not spawn. You need no IDs, at most a project NAME (defaults to the selected project, or "adjutant"). You CANNOT decommission, stop, or destroy agents — that is off the table.

INDEPENDENCE DOCTRINE: address agents BY NAME and use sensible defaults. You do NOT need a project, epic, or bead id for any of these — never demand IDs. Only ask the Commander to clarify when an agent NAME (or which question) is genuinely ambiguous. The send/nudge/answer/create actions are reversible, so act decisively without asking permission first. spawn_worker is the explicit EXCEPTION: it is not reversible-act-decisively — you must read it back and wait for an explicit affirmative before spawning, as described above.`;

/**
 * Compose the per-session personality: append the fleet-tool guidance to a caller-
 * supplied base persona, or fall back to {@link BRIDGE_RPC_PERSONALITY} when none
 * is given. Either way the model is told the tools exist and how to use them.
 */
export function composeBridgePersonality(base?: string): string {
  if (!base) return BRIDGE_RPC_PERSONALITY;
  return `${base}\n\n${BRIDGE_RPC_PERSONALITY}`;
}
