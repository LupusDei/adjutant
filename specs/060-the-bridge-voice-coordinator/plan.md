# Plan: The Bridge — Talk to the Adjutant

Root epic: **adj-202** · Project: adjutant · Spec: `specs/060-the-bridge-voice-coordinator/`

## Architecture

```
Commander (mic/cam)  ⇄  Bridge panel (React + LiveKit client)  ⇄  Runway GWM-1 session
        │                                                              │
        │   avatar emits tool call ─────────────► Coordinator Tool Bridge (backend)
        │                                              │  (adapter over EXISTING MCP service layer)
        │                                              ▼
        │                                        MCP/service layer ──► fleet (all projects)
        └───────────  spoken reply + AUTHORITATIVE result card + WS broadcast  ◄──────────┘
```

- **Session broker** (`backend/src/services/bridge-session-broker.ts`): owns the Runway `gwm1_avatars` session lifecycle (create → one-shot WebRTC creds → 5-min auto-renew + re-seed). Holds the Runway key server-side.
- **Runway client** (`backend/src/services/runway-client.ts`): thin authed HTTP wrapper (reads `RUNWAYML_API_SECRET`); fully mockable.
- **Tool bridge** (`backend/src/services/bridge-tool-bridge.ts`): maps a whitelisted set of read-only tools onto the existing MCP/service layer. No new business logic.
- **Cost guard** (`backend/src/services/bridge-cost-guard.ts`): per-day credit circuit-breaker + idle auto-disconnect.
- **Route** (`backend/src/routes/bridge.ts`): `POST /api/bridge/session` (create), session lifecycle endpoints. Mounted behind `apiKeyAuth`.
- **Frontend** (`frontend/src/components/bridge/`): `BridgePanel.tsx`, `AuthoritativeResultPanel.tsx`, `useBridgeSession.ts`, `CreditMeter.tsx`.

## Phases (= sub-epics)

- **adj-202.1 — Setup & dependencies** (P0): deps, provisioning (Avatar ID + key), Runway character "Commander" edit.
- **adj-202.2 — Phase 0: Spike** (P0, GATING): throwaway harness, measurements, go/no-go findings (`research.md`). **Blocks adj-202.3.**
- **adj-202.3 — Phase 1: Fleet Briefing MVP** (P1): runway-client → session broker → tool bridge → cost guard → route → React panel → integration smoke. **Depends on adj-202.2 (GO).**
- **adj-202.4 — Phase 2: Command** (P2, follow-on, not decomposed).
- **adj-202.5 — Phase 3: Presence** (P2, follow-on).
- **adj-202.6 — Phase 4: Embodied coordinator** (P3, follow-on).

## Parallel opportunities

- Within Phase 1: `runway-client` and `tool-bridge` are independent of each other ([P]); the session broker depends on `runway-client`; the route depends on broker + tool-bridge + cost-guard; the React panel depends on the route's contract.

## Testing strategy

- Backend: vitest unit tests with the Runway HTTP layer mocked from REAL response shapes; contract tests on the tool-bridge adapter boundary. Route tests for `/api/bridge/*`. Live avatar = manual smoke only.
- Frontend: hook/state tests for `useBridgeSession`; pure-UI styling exempt.

## Bead Map

- `adj-202` — Root epic: The Bridge — conversational Adjutant coordinator avatar (Runway GWM-1)
  - `adj-202.1` — Setup & dependencies (P0)
    - `adj-202.1.1` — [setup] Add LiveKit + Runway deps + bridge config
    - `adj-202.1.2` — [action] Provision Avatar ID + RUNWAYML_API_SECRET (needs Commander)
    - `adj-202.1.3` — [docs] Runway character General→Commander edit (runwayml repo)
  - `adj-202.2` — Phase 0: Spike (GATING) (P0) — depends on adj-202.1
    - `adj-202.2.1` — [scaffold] Spike harness: char + 1 LiveKit tool → get_project_state
    - `adj-202.2.2` — Measure latency / injection reliability / 5-min renew
    - `adj-202.2.3` — [docs] research.md go/no-go findings (gates Phase 1)
  - `adj-202.3` — Phase 1: Fleet Briefing MVP (web, read-only) (P1) — depends on adj-202.2; leaves gated on adj-202.2.3
    - `adj-202.3.1` — runway-client.ts (TDD)
    - `adj-202.3.2` — bridge-tool-bridge.ts (TDD)
    - `adj-202.3.3` — bridge-cost-guard.ts (TDD)
    - `adj-202.3.4` — bridge-session-broker.ts (TDD) — dep: .3.1, .3.3
    - `adj-202.3.5` — routes/bridge.ts (TDD) — dep: .3.4, .3.2
    - `adj-202.3.6` — useBridgeSession.ts hook (TDD) — dep: .3.5
    - `adj-202.3.7` — BridgePanel + AuthoritativeResultPanel + CreditMeter — dep: .3.6
    - `adj-202.3.8` — Integration smoke: read-only briefing flow — dep: .3.5, .3.7
  - `adj-202.4` — Phase 2: Command [follow-on] (P2) — depends on adj-202.3
  - `adj-202.5` — Phase 3: Presence [follow-on] (P2) — depends on adj-202.3
  - `adj-202.6` — Phase 4: Embodied coordinator [follow-on] (P3) — depends on adj-202.3

**Status:** HALTED after planning at the Commander's request — Phase 0 (spike/prototyping)
is the immediate next step; no squad spawned.
