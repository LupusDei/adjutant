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
