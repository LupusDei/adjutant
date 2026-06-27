# Spec: The Bridge — Talk to the Adjutant

**Feature:** Conversational Adjutant coordinator avatar (Runway GWM-1) embedded in the dashboard.
**Proposal:** 339b5a8d-494e-430c-a2bc-d583e6649779 (accepted)
**Root epic:** adj-202
**Project:** adjutant (0e578d15)
**Type:** product

## Summary

Give the Layer-2 `adjutant-coordinator` a real-time conversational body — Runway's
Adjutant Character (GWM-1) — embedded in the dashboard. The **Commander** speaks; the
Adjutant reports **fleet-wide** status (across all projects), answers questions grounded
in live MCP state, and (later phases) takes coordinator actions by calling Adjutant's own
MCP tools. The avatar is the live, conversational **face** of a persistent headless
Coordinator service.

## Commander-directed decisions (assumptions for this epic)

1. **Replace vs embody** → refactor today's `adjutant-coordinator` behind a service boundary, then attach the avatar (Phase 4).
2. **Embed path** → LiveKit Agents.
3. **Proactive vs summon** → summon-only / push-to-talk for the MVP; proactive alerts deferred (Phase 4).
4. **Surface first** → web dashboard; iOS later.
5. Address term is **"Commander"** (not "General").

## Scope of THIS epic

- **In:** Phase 0 (Spike, gating) and Phase 1 (read-only Fleet Briefing MVP, web) in full TDD detail; cross-cutting setup/provisioning.
- **Out (follow-on child epics, not decomposed here):** Phase 2 Command (write tools), Phase 3 Presence (video/screen-share), Phase 4 Embodied coordinator (service refactor + proactive alerts), iOS.

## User Stories

### Setup & Dependencies (Priority: P0) — adj-202.1
Provision the external pieces the build depends on.
- **Acceptance:** LiveKit Agents + Runway SDK deps installed; Avatar ID + `RUNWAYML_API_SECRET` available to the backend via the secret manager (never committed, never shipped to the browser); the Runway character addresses the user as "Commander".

### US0 — Phase 0: Spike / go-no-go (Priority: P0, GATING) — adj-202.2
As the engineering team, we must prove the core tool-loop before committing to the MVP.
- **Acceptance:** a throwaway harness wires the existing Adjutant Character to ONE server-side tool (`get_project_state`) via LiveKit Agents; we have measured numbers for (a) tool round-trip latency, (b) result-injection reliability, (c) 5-min session-renew UX; a findings doc records the numbers and a **go/no-go** recommendation. **Phase 1 does not start until this is GO.**

### US1 — Phase 1: Fleet Briefing MVP, read-only, web (Priority: P1) — adj-202.3
As the Commander, I open The Bridge and the Adjutant gives me a spoken, accurate, fleet-wide
status briefing and answers read-only questions about any project.
- **Acceptance:**
  - A backend **session broker** creates a `gwm1_avatars` session with the Adjutant Avatar ID, returns one-shot WebRTC credentials, injects a per-session `personality`/`startScript` seeded with a fleet-wide snapshot, auto-renews at the 5-min cap, and keeps the Runway key server-side only.
  - A **read-only tool bridge** exposes `get_project_state`, `list_agents`, `list_questions`, `list_beads`, `get_auto_develop_status` to the avatar, executed through the **existing** MCP/service layer (no second control plane). Cross-project reads allowed (Layer-2 exception); each call names its target project.
  - A **React Bridge panel** shows the avatar viewport, mic toggle, live captions, an **authoritative result panel** rendering the structured tool output verbatim (the voice only narrates it), an action log, a session timer, and a live credit meter. Honors project brand + dark/accessible baseline.
  - A **credit circuit-breaker** (hard per-day ceiling) + **idle auto-disconnect** are enforced.
  - Spoken claims never silently diverge from the authoritative result panel (grounding contract).

### US2–US4 — Follow-on (Priority: P2–P3) — adj-202.4 / .5 / .6
Phase 2 Command (write tools + identity bridge + confirm gates), Phase 3 Presence
(video/screen-share), Phase 4 Embodied coordinator (service refactor + proactive alerts).
Captured as child epics; decomposed after Phase 0 is GO and Phase 1 lands.

## Non-Functional Requirements

- **Security:** Runway API key never reaches the browser; all Runway/tool calls execute server-side. (Constitution Rule 4)
- **Architecture:** routes → services → stores; the tool bridge is an adapter over the existing MCP service layer, NOT a parallel control plane. (Rules 4 + 9)
- **Testability:** mockable bridge boundary + contract tests for the tool adapter; the live avatar is smoke-test only.
- **TDD:** failing test first for every non-exempt backend/service/hook task. (Rule 1)
- **Cost:** GWM-1 ≈ $0.20/min; per-day circuit-breaker + idle cutoff + live meter must bound spend.

## Success Criteria

- Phase 0 produces a clear GO/NO-GO with real latency/reliability numbers.
- Phase 1: time-to-fleet-awareness (open → complete spoken sitrep) in seconds; spoken claims match the authoritative panel 100%; session cost bounded by the circuit-breaker.

## Dependencies / Risks

- External: Runway dev-org credits, Avatar ID, LiveKit. The 5-min session cap and tool-loop latency are the core unknowns → **Phase 0 gates the rest**.
- The silent-partial-write bug (adj-ovbhc) is unrelated but in the same proposal surface; track separately.

## Addendum — Avatar read-only tool loop (adj-202.7)

Found in Phase-1 live testing: the avatar can SPEAK but cannot actually query the fleet — no
tools are registered on the avatar session, so a status question stalls ("querying…"
indefinitely). Phase 1 shipped the backend tool API (`/api/bridge/tool`) + the dashboard panel,
but nothing connects the spoken question to a real tool call. This closes that gap — the
read-only slice of the Phase-2 tool loop, pulled forward so the briefing actually works.

**Requirement:** the Adjutant avatar invokes a real read-only tool during conversation and
answers grounded in the structured result.
- Register read-only RPC tools on the `/avatar` Runway session for the whitelist
  (`get_project_state`, `list_agents`, `list_questions`, `list_beads`, `get_auto_develop_status`),
  each proxying to `POST /api/bridge/tool`. Follow the SDK RPC pattern (avatars-sdk-react
  `examples/nextjs-rpc-weather`, `examples/nextjs-rpc-external-api`).
- The GWM-1 character MUST be told the tools exist (tool name/description/param schemas; nudge via
  the per-session `personality`/`startScript`) so it calls them instead of stalling.
- Structured result = source of truth; surface it in the dashboard `AuthoritativeResultPanel`
  (external mode, via the bridge `postMessage` channel); the voice only narrates.
- Read-only only; secret stays server-side; reuse the single cost-guarded session.
- **Acceptance:** "what's the current agent roster?" → the avatar calls `list_agents` → answers
  with the real roster within a few seconds (no endless "querying"); the panel shows the result.
- **Verification:** the RPC-handler → `/api/bridge/tool` proxy/arg-mapping/error-handling is
  unit-tested; the live avatar invocation is an on-device manual smoke (documented in research.md).

## Phase 2 — Command: the avatar directs the swarm (write tools + independence doctrine)

The avatar embodies the coordinator, so it must ACT, not just report. Live feedback (the avatar
refusing to message agents without project/bead/epic IDs) drives the **independence doctrine**:
the avatar acts on the Commander's intent directly, uses sensible defaults, never demands IDs it
can avoid, and only asks the Commander to clarify when something is genuinely ambiguous (e.g. an
unknown agent name). Every command tool reuses the SAME service layer the MCP tools use (Rules
4 + 9); each is added incrementally to the same server-side tool loop (so no iOS rebuild).

**Command toolset:**
| Tool | What | Gate | Bead |
|---|---|---|---|
| `send_message` | Message any agent by NAME (or `user`); `{ to, body }` — no IDs | none (free-flowing) | adj-202.4.1 |
| `nudge_agent` | Poke / redirect an idle or stalled agent by name | none | adj-202.4.2 |
| `answer_question` | Resolve an open triage question the avatar surfaced | none | adj-202.4.3 |
| `create_bead` | File a work item for the swarm (sensible default project) | none | adj-202.4.4 |
| `spawn_worker` | Start a new agent / squad member | read-back (state what it will spawn) | adj-202.4.5 |
| `decommission_agent` / destructive | — | **FORBIDDEN** — the Commander does these deliberately | — |

**Independence doctrine (baked into the persona):** act on intent; message/nudge/answer/create
by name with sensible defaults; do NOT block on missing IDs. Issued actions are attributed to
the coordinator so agents treat them as command directives, and every avatar-issued action is
logged for audit. Reversible actions need NO confirmation (free-flowing direction); only
resource-creating spawns get a spoken read-back; destructive tools stay off-limits.
