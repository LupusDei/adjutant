# Beads Import: The Bridge — Talk to the Adjutant

Root: **adj-202** (epic, P1). Project: adjutant.

## Hierarchy

| Bead | Type | Pri | Title | Depends on |
|---|---|---|---|---|
| adj-202 | epic | 1 | The Bridge — conversational Adjutant coordinator avatar (Runway GWM-1) | — |
| adj-202.1 | epic | 0 | Setup & dependencies | — |
| adj-202.1.1 | task | 0 | [setup] Add LiveKit + Runway deps + bridge config | — |
| adj-202.1.2 | task | 0 | [action] Provision Avatar ID + RUNWAYML_API_SECRET (needs Commander) | — |
| adj-202.1.3 | task | 1 | [docs] Runway character "General"→"Commander" edit (runwayml repo) | — |
| adj-202.2 | epic | 0 | Phase 0: Spike (GATING) | adj-202.1 |
| adj-202.2.1 | task | 0 | [scaffold] Spike harness: char + 1 LiveKit tool → get_project_state | adj-202.1.1, adj-202.1.2 |
| adj-202.2.2 | task | 0 | Measure latency / injection reliability / 5-min renew (spike-data.md) | adj-202.2.1 |
| adj-202.2.3 | task | 0 | [docs] research.md go/no-go findings | adj-202.2.2 |
| adj-202.3 | epic | 1 | Phase 1: Fleet Briefing MVP (web, read-only) | adj-202.2 |
| adj-202.3.1 | task | 1 | runway-client.ts (TDD) | adj-202.1.1 |
| adj-202.3.2 | task | 1 | bridge-tool-bridge.ts (TDD) | — |
| adj-202.3.3 | task | 1 | bridge-cost-guard.ts (TDD) | — |
| adj-202.3.4 | task | 1 | bridge-session-broker.ts (TDD) | adj-202.3.1, adj-202.3.3 |
| adj-202.3.5 | task | 1 | routes/bridge.ts (TDD) | adj-202.3.4, adj-202.3.2 |
| adj-202.3.6 | task | 1 | useBridgeSession.ts hook (TDD) | adj-202.3.5 |
| adj-202.3.7 | task | 1 | BridgePanel + AuthoritativeResultPanel + CreditMeter (TDD where logic) | adj-202.3.6 |
| adj-202.3.8 | task | 1 | Integration smoke: read-only briefing flow | adj-202.3.5, adj-202.3.7 |
| adj-202.4 | epic | 2 | Phase 2: Command (write tools + identity bridge) [follow-on] | adj-202.3 |
| adj-202.5 | epic | 2 | Phase 3: Presence (video + screen-share) [follow-on] | adj-202.3 |
| adj-202.6 | epic | 3 | Phase 4: Embodied coordinator (service refactor + proactive) [follow-on] | adj-202.3 |

Note: T0xx task numbers in tasks.md map to adj-202.N.M beads above by phase order.
