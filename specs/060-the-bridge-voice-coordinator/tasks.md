# Tasks: The Bridge — Talk to the Adjutant

Root epic: **adj-202**. Tasks use TDD shapes (Shape A split / Shape B phased) except where
marked `[setup]`, `[docs]`, `[scaffold]`, `[action]`. Phases = sub-epics.

## Phase 1 (adj-202.1) — Setup & Dependencies

- [ ] T001 [setup] Add LiveKit Agents + Runway SDK (or thin HTTP) deps to `backend/package.json` and a `bridge` config block (env names only, no secrets) in `backend/src/config`.
- [ ] T002 [action] Provision the Adjutant **Avatar ID** + dev-org `RUNWAYML_API_SECRET` into the backend secret manager / `.env` (NOT committed). Requires the Commander — filed via file_question (action_required).
- [ ] T003 [docs] Update the Runway character in `~/code/ai/runwayml`: `characters/adjutant/system_prompt.txt`, `persona.md`, and the startScript — address term "General" → "Commander". (Cross-repo dependency.)

## Phase 2 (adj-202.2) — Phase 0: SPIKE (GATING)

- [ ] T010 [scaffold] Stand up a throwaway spike harness (`spikes/bridge-gwm1/`) wiring the existing Adjutant Character (Avatar ID) to ONE LiveKit Agents server-side tool that calls `get_project_state`. Throwaway code — not production, not TDD.
- [ ] T011 Measure across ≥10 runs and record raw data: (a) tool round-trip latency (avatar tool-call → backend → result spoken), (b) result-injection reliability (% of calls the avatar narrates correctly), (c) 5-min session-renew UX (seam length, context retention). Capture into `specs/060-the-bridge-voice-coordinator/spike-data.md`.
- [ ] T012 [docs] Write `specs/060-the-bridge-voice-coordinator/research.md`: the numbers from T011 + a clear **GO / NO-GO** recommendation and any design adjustments. **This gates Phase 1.**

## Phase 3 (adj-202.3) — Phase 1: Fleet Briefing MVP (web)

- [ ] T020a [P] [US1] Write failing tests for `runway-client.ts` in `backend/tests/unit/runway-client.test.ts` — happy path (create session returns creds), error path (401/429/5xx), edge (missing key). Mock HTTP with REAL Runway response shapes. Confirm RED.
- [ ] T020b [US1] Implement `backend/src/services/runway-client.ts` (authed wrapper reading `RUNWAYML_API_SECRET`) until T020a is GREEN.
- [ ] T021a [P] [US1] Write failing tests for `bridge-tool-bridge.ts` in `backend/tests/unit/bridge-tool-bridge.test.ts` — whitelist enforcement (only the 5 read-only tools), delegates to the existing MCP/service layer, cross-project read allowed, unknown/forbidden tool rejected. Confirm RED.
- [ ] T021b [US1] Implement `backend/src/services/bridge-tool-bridge.ts` as an adapter over the existing service layer until T021a is GREEN. No new business logic.
- [ ] T022a [US1] Write failing tests for `bridge-cost-guard.ts` in `backend/tests/unit/bridge-cost-guard.test.ts` — per-day credit ceiling trips, idle timeout disconnects, meter accounting. Confirm RED.
- [ ] T022b [US1] Implement `backend/src/services/bridge-cost-guard.ts` until T022a is GREEN.
- [ ] T023a [US1] Write failing tests for `bridge-session-broker.ts` in `backend/tests/unit/bridge-session-broker.test.ts` — creates session via runway-client, returns one-shot creds, seeds personality/startScript with a fleet snapshot, 5-min auto-renew, key never returned to caller. Mock runway-client + cost-guard. Confirm RED.
- [ ] T023b [US1] Implement `backend/src/services/bridge-session-broker.ts` until T023a is GREEN.
- [ ] T024a [US1] Write failing tests for the bridge route in `backend/tests/unit/bridge-routes.test.ts` — `POST /api/bridge/session` success returns creds (no key), error returns structured error, auth required. Confirm RED.
- [ ] T024b [US1] Implement `backend/src/routes/bridge.ts` (delegates to the session broker) and mount it until T024a is GREEN.
- [ ] T025a [P] [US1] Write failing tests for `useBridgeSession.ts` in `frontend/tests/unit/useBridgeSession.test.ts` — initial state, connect/disconnect transitions, error state, session-timer/credit-meter state. Confirm RED.
- [ ] T025b [US1] Implement `frontend/src/hooks/useBridgeSession.ts` until T025a is GREEN.
- [ ] T026 [US1] Build the Bridge panel UI in `frontend/src/components/bridge/BridgePanel.tsx` + `AuthoritativeResultPanel.tsx` + `CreditMeter.tsx`. Phases: write failing tests first for `AuthoritativeResultPanel` (renders structured tool output verbatim) in `frontend/tests/unit/authoritative-result-panel.test.tsx` → confirm RED → implement → confirm GREEN. Pure styling/layout is exempt; honor project brand + dark/accessible baseline.
- [ ] T027 [US1] Integration smoke of the read-only briefing flow: write a failing integration test first in `backend/tests/integration/bridge-readonly-flow.test.ts` (session create → tool-bridge get_project_state → authoritative result shape) → confirm RED → wire end-to-end → confirm GREEN. Live-avatar smoke is manual (documented in research.md).

## Follow-on (not decomposed in this epic)

- [ ] adj-202.4 — Phase 2: Command (write tools + identity bridge + confirm gates).
- [ ] adj-202.5 — Phase 3: Presence (video + screen-share).
- [ ] adj-202.6 — Phase 4: Embodied coordinator (service refactor + proactive alerts).
