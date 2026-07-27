# Beads Import: adj-209 — Mission Control selection + per-feature intensity

Root `adj-209` · adjutant (`0e578d15`) · P1 · iOS-first.

| Bead | Type | Title | Parent | Blocked by |
|---|---|---|---|---|
| `adj-209` | epic | Mission Control — project selection + per-feature agentic intensity | — | — |
| `adj-209.1` | epic | Phase 1: Backend — projectIds filter + activity + features | `adj-209` | — |
| `adj-209.1.1` | task | [scaffold] Types: features[], activityLevel, agentCount, projectIds | `adj-209.1` | — |
| `adj-209.1.2` | task | Composite activityLevel in coordination service (TDD) | `adj-209.1` | `adj-209.1.1` |
| `adj-209.1.3` | task | ?projectIds= filter + features[] breakdown, route+service (TDD) | `adj-209.1` | `adj-209.1.2` |
| `adj-209.2` | epic | Phase 2: iOS data layer | `adj-209` | `adj-209.1` |
| `adj-209.2.1` | task | Models: FeatureRollup + features[] + activityLevel (TDD) | `adj-209.2` | — |
| `adj-209.2.2` | task | APIClient.getOverviewProjects(projectIds:) (TDD) | `adj-209.2` | `adj-209.2.1` |
| `adj-209.2.3` | task | ViewModel: persisted selection + projectIds + activity (TDD) | `adj-209.2` | `adj-209.2.2` |
| `adj-209.3` | epic | Phase 3: Project selector | `adj-209` | `adj-209.2` |
| `adj-209.3.1` | task | Selection state (all/none/individual, persisted) (TDD) | `adj-209.3` | — |
| `adj-209.3.2` | task | Selector UI on the tab, wired to VM/map | `adj-209.3` | `adj-209.3.1` |
| `adj-209.4` | epic | Phase 4: Map — feature nodes + intensity | `adj-209` | `adj-209.2` |
| `adj-209.4.1` | task | Layout: per-feature nodes + intensity→(thickness,glow,flow) (pure, TDD) | `adj-209.4` | — |
| `adj-209.4.2` | task | Map render: feature nodes + intensity encoding + uncapped agents | `adj-209.4` | `adj-209.4.1` |
| `adj-209.4.3` | task | VALIDATION GATE: real build + host render (low/high) + selector + live latency | `adj-209.4` | `adj-209.4.2` |

## Parallel entry points
After Phase 1: `adj-209.2.1` (models), `adj-209.4.1` (layout math, [P]) can start; `adj-209.3.1`
(selection state) is pure and can start early too.
