# Spec: Mission Control — project selection + per-feature agentic intensity

**Root epic:** `adj-209` · Project: adjutant (`0e578d15`) · Scope: **iOS-first**.
Extends the shipped Mission Control tab (`adj-208`).

## Summary
Two capabilities:
1. **Project selection** — select-all / deselect-all / individual projects on the Mission
   Control tab. Selection **persists** and drives a **server-side `projectIds` filter** so
   only chosen projects are rolled up (faster; sidesteps cold-dolt "degraded" noise).
2. **Per-feature agentic intensity** — each project stream branches into its
   **in-progress feature/epic nodes**, and a **composite activity level** (active agents +
   `report_progress` cadence + in-progress beads) drives a coherent **"busier = hotter"**
   look with real headroom: thicker/brighter stream, faster animated flow, node glow, and an
   **uncapped** agent count.

## Locked decisions (General, via triage)
1. Selection = **server-side `projectIds` filter + persisted** selection.
2. Intensity = **composite** (agents + progress cadence + in-progress beads) → stream
   thickness/brightness + animated-flow speed + node glow + uncapped agent count.
3. Scope = **per-feature/epic intensity within each project stream** (multiple feature nodes
   per project), not project-level only.

## User Stories

### US1 — Backend: filter + activity + per-feature breakdown (P1)
`GET /api/overview/projects` gains:
- optional **`?projectIds=a,b,c`** — roll up only those projects (fast path).
- per project: **`features: FeatureRollup[]`** = the project's in-progress epics/features,
  each `{ id, title, completionPercent, closedChildren, totalChildren, agents[{id,status}],
  activityLevel (0..1), status }`; plus project-level `activityLevel` (0..1) and `agentCount`.
- **`activityLevel`** = normalized composite of active-agent count + recent `report_progress`
  cadence + in-progress bead count (per feature and aggregated per project).
**Acceptance:** `?projectIds=` returns only those projects and stays fast (<1s warm for a small
selection); `features[]` + `activityLevel` populated; degrades gracefully; tests on REAL bd shapes.

### US2 — iOS data layer (P1)
Models + APIClient + view-model for the new fields and the selection.
**Acceptance:** models decode `features[]` + `activityLevel` + `agentCount` (envelope-aware,
ignore unknown keys); `getOverviewProjects(projectIds:)` sends the filter; view-model holds a
**persisted selected-project set** (UserDefaults), sends it, and exposes features/activity.

### US3 — Project selector (P1)
A selector UI on the Mission Control tab: **Select all / Deselect all / individual** toggles.
**Acceptance:** toggling changes which projects the map shows and the `projectIds` sent;
select-all/deselect-all work; selection persists across launches; default = all (or last set).

### US4 — Map: feature nodes + intensity encoding (P1)
Each project stream branches into its feature nodes; activity drives the visuals.
**Acceptance:** per-project stream shows its `features[]` as distinct nodes (each with
completion ring + status beacon + agent count); **activityLevel** scales stream
thickness/brightness, animated-flow speed, and node glow, monotonically with headroom (a
high-activity feature is visibly "hotter" than a low one); agent count is **uncapped**
(no 5-dot cap); empty/degraded/loading states handled; themable; 60fps.

## Out of scope
- Web UI. Tap-to-drill-down. Historical trend of intensity.

## Success criteria
- Selecting a subset makes the endpoint fast and the map show only those projects.
- A project/feature with more agentic work reads visibly "hotter" than a quiet one.
- Validation gate (US5-style, see tasks): real build + on-host render of low-vs-high intensity
  states + selector behavior + live endpoint latency with the filter.
