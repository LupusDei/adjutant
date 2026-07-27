# Plan: adj-209 — Mission Control selection + per-feature intensity (iOS-first)

Layered route→service→store; iOS APIClient → view-model → native Canvas map. Builds on adj-208.

## Phase 1 — Backend (`adj-209.1`)
- **Types** `backend/src/types/overview-projects.ts` — add `FeatureRollup`, per-project
  `features: FeatureRollup[]`, `activityLevel`, `agentCount`; request `projectIds?` filter. Zod.
- **Activity signal** `backend/src/services/coordination-overview-service.ts` — composite
  `activityLevel` (active agents + recent `report_progress` cadence + in-progress bead count),
  normalized 0..1, per feature + aggregated per project. Reuse the fast single-`bd list` path.
- **Filter + features** — route `backend/src/routes/overview.ts` accepts `?projectIds=`;
  service returns each project's in-progress epics as `features[]`. Keep per-project timeout +
  cache; a small selection must be <1s warm.

## Phase 2 — iOS data (`adj-209.2`)
- **Models** `ios/AdjutantKit/.../Models/MissionControl.swift` — `FeatureRollup`, `features[]`,
  `activityLevel`, `agentCount` (envelope-aware; ignore unknown keys).
- **APIClient** `.../Networking/APIClient+Endpoints.swift` — `getOverviewProjects(projectIds:)`.
- **View-model** `ios/Adjutant/Features/SwarmOverview/MissionControlViewModel.swift` — persisted
  selected-project set (UserDefaults), sends `projectIds`, exposes features/activity.

## Phase 3 — Project selector (`adj-209.3`)
- **Selection state** `.../SwarmOverview/MissionControlSelection.swift` — all/none/individual,
  persisted; pure logic unit-tested.
- **Selector UI** on `SwarmOverviewView` / the Mission Control tab (filter sheet or chip row):
  Select all / Deselect all / per-project toggles, wired to the VM/map.

## Phase 4 — Map intensity + feature nodes (`adj-209.4`)
- **Layout** `.../SwarmOverview/MissionControlLayout.swift` — per-feature node positions within
  a project stream (branching); intensity→(thickness, glow radius, flow speed) mapping. Pure, TDD.
- **Map view** `.../SwarmOverview/MissionControlMapView.swift` — render per-feature nodes per
  stream; activity scales stream thickness/brightness + animated-flow speed + node glow;
  **uncapped** agent count. Themable; 60fps.
- **Validation gate** `adj-209.4.3` — real build + on-host render of low-vs-high intensity +
  selector behavior + live endpoint latency with `projectIds`.

**SPM:** files under Adjutant/ and AdjutantKit/ auto-discover — no `.pbxproj` edits.

## Dependencies
Phase 2 ⟸ Phase 1 (contract). Phase 3 ⟸ Phase 2. Phase 4 ⟸ Phase 2 (+ selector for integration).

## Bead Map
- `adj-209` — Root
  - `adj-209.1` Backend — `.1.1` types · `.1.2` activity signal · `.1.3` filter + features
  - `adj-209.2` iOS data — `.2.1` models · `.2.2` APIClient projectIds · `.2.3` VM selection+activity
  - `adj-209.3` Selector — `.3.1` selection state · `.3.2` selector UI
  - `adj-209.4` Map — `.4.1` layout · `.4.2` map render · `.4.3` validation gate
