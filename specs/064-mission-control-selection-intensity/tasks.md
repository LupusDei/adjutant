# Tasks: adj-209 — Mission Control selection + per-feature intensity (iOS-first)

TDD-shaped. `[P]` parallelizable.

## Phase 1 — Backend (`adj-209.1`)
- [ ] T101 [setup] [US1] Extend `backend/src/types/overview-projects.ts`: add `FeatureRollup`
      (id,title,completionPercent,closedChildren,totalChildren,agents[],activityLevel,status),
      per-project `features[]` + `activityLevel` + `agentCount`, and request `projectIds?`. Zod.
- [ ] T102 [US1] Add composite `activityLevel` to
      `backend/src/services/coordination-overview-service.ts`. Tests FIRST
      (`backend/tests/unit/coordination-overview-service.test.ts`) on REAL bd shapes: activity
      rises with active-agent count + in-progress beads + recent report_progress; normalized 0..1;
      per-feature + per-project → RED → implement → GREEN.
- [ ] T103 [US1] Add `?projectIds=` filter + `features[]` breakdown in
      `backend/src/routes/overview.ts` + service. Tests FIRST (filter returns only requested
      projects; features[] = in-progress epics with rollups; small selection fast) → RED →
      implement (reuse single-`bd list` fast path + cache + per-project timeout) → GREEN.

## Phase 2 — iOS data (`adj-209.2`)  — ⟸ Phase 1
- [ ] T201 [US2] Extend `ios/AdjutantKit/Sources/AdjutantKit/Models/MissionControl.swift`:
      `FeatureRollup`, `features[]`, `activityLevel`, `agentCount`. Failing decode tests FIRST
      (real JSON incl. features + activity) → RED → implement → GREEN.
- [ ] T202 [US2] `getOverviewProjects(projectIds:)` in
      `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Endpoints.swift`. Failing tests
      FIRST (projectIds encoded in query; success/error) → RED → implement → GREEN.
- [ ] T203 [US2] `MissionControlViewModel`: persisted selected-project set (UserDefaults),
      sends projectIds, exposes features/activity. Failing tests FIRST (default selection;
      toggle persists; projectIds passed to client) → RED → implement → GREEN.

## Phase 3 — Selector (`adj-209.3`)  — ⟸ Phase 2
- [ ] T301 [US3] `ios/Adjutant/Features/SwarmOverview/MissionControlSelection.swift` — pure
      selection logic (selectAll, deselectAll, toggle(id), isSelected, persistence keys).
      Failing tests FIRST (all/none/individual transitions; persistence round-trip) → RED →
      implement → GREEN.
- [ ] T302 [US3] Selector UI on the Mission Control tab (filter sheet or chip row) in
      `ios/Adjutant/Features/SwarmOverview/SwarmOverviewView.swift` (+ a subview): Select all /
      Deselect all / per-project toggles, wired to the VM. Test extractable logic (selection →
      VM → projectIds) FIRST → RED → implement → GREEN.

## Phase 4 — Map intensity + feature nodes (`adj-209.4`)  — ⟸ Phase 2
- [ ] T401 [P] [US4] Extend `ios/Adjutant/Features/SwarmOverview/MissionControlLayout.swift`:
      per-feature node positions within a stream (branching for N features), and pure
      `intensity(activityLevel)` → (stream thickness, glow radius, flow speed) mapping. Failing
      tests FIRST (monotonic + clamped; multi-feature layout within bounds) → RED → GREEN.
- [ ] T402 [US4] `ios/Adjutant/Features/SwarmOverview/MissionControlMapView.swift` — render
      each project's `features[]` as distinct nodes; activity scales stream thickness/brightness,
      animated-flow speed, and node glow; **uncapped** agent count. Consumes the GREEN layout +
      activity. Verify via layout tests (GREEN) + previews (low vs high intensity, multi-feature).
- [ ] T403 [US5] VALIDATION GATE: real `swift build` (feature target) + on-host ImageRenderer of
      LOW vs HIGH intensity states + multi-feature streams + selector states; live endpoint
      latency with `?projectIds=` (<1s warm for a small selection). No typecheck-only acceptance.

## Audit
`npx --prefix backend tsx ../scripts/audit-tasks-md.ts` — new tasks pass clean.
