# Data Model: Decompose beads-service.ts

**Feature**: 019-beads-service-decompose
**Date**: 2026-02-25

## Module Dependency Map

This refactoring does not introduce new data entities. It restructures existing code into modules with clear dependency directions.

```
                    ┌──────────────────┐
                    │    index.ts      │  (barrel + composed functions)
                    │  Re-exports all  │
                    └──┬───┬───┬───┬───┘
                       │   │   │   │
          ┌────────────┘   │   │   └─────────────┐
          ▼                ▼   ▼                  ▼
┌─────────────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────┐
│ beads-repository│ │beads-    │ │beads-        │ │beads-sorter │
│                 │ │filter    │ │dependency    │ │             │
│ execBd calls    │ │          │ │              │ │ Pure sort   │
│ Prefix map      │ │ Pure     │ │ Graph build  │ │ functions   │
│ Multi-DB        │ │ filter   │ │ Epic progress│ │             │
│ Event emission  │ │ funcs    │ │ Auto-complete│ │             │
└────────┬────────┘ └──────────┘ └──────────────┘ └─────────────┘
         │
         ▼
┌─────────────────┐
│   bd-client.ts  │  (unchanged, low-level CLI wrapper)
└─────────────────┘

All modules import from: types.ts (shared type definitions)
```

### Dependency Rules

| Module | Can Import From | Cannot Import From |
|--------|----------------|-------------------|
| index.ts | repository, filter, dependency, sorter, types | bd-client |
| beads-repository.ts | bd-client, types | filter, dependency, sorter |
| beads-filter.ts | types | bd-client, repository, dependency, sorter |
| beads-dependency.ts | types | bd-client, repository, filter, sorter |
| beads-sorter.ts | types | bd-client, repository, filter, dependency |
| types.ts | (none — leaf module) | everything |

### Function-to-Module Mapping

| Function | Current Location | Target Module |
|----------|-----------------|---------------|
| `listBeads` | beads-service.ts | index.ts (composes repo + filter + sort) |
| `listAllBeads` | beads-service.ts | index.ts (composes repo + filter + sort) |
| `getBead` | beads-service.ts | beads-repository.ts |
| `updateBead` | beads-service.ts | beads-repository.ts |
| `updateBeadStatus` | beads-service.ts | beads-repository.ts |
| `getBeadsGraph` | beads-service.ts | index.ts (composes repo + dependency) |
| `getEpicChildren` | beads-service.ts | beads-dependency.ts |
| `listEpicsWithProgress` | beads-service.ts | index.ts (composes repo + dependency) |
| `isBeadEpic` | beads-service.ts | beads-dependency.ts |
| `autoCompleteEpics` | beads-service.ts | beads-dependency.ts |
| `getProjectOverview` | beads-service.ts | index.ts (composes repo + filter) |
| `computeEpicProgress` | beads-service.ts | beads-dependency.ts |
| `getRecentlyCompletedEpics` | beads-service.ts | beads-dependency.ts |
| `listBeadSources` | beads-service.ts | beads-repository.ts |
| `listRecentlyClosed` | beads-service.ts | index.ts (composes repo + filter) |
| `startPrefixMapRefreshScheduler` | beads-service.ts | beads-repository.ts |
| `stopPrefixMapRefreshScheduler` | beads-service.ts | beads-repository.ts |
| `refreshPrefixMap` | beads-service.ts | beads-repository.ts |
| Status filtering helpers | beads-service.ts | beads-filter.ts |
| Wisp filtering | beads-service.ts | beads-filter.ts |
| Deduplication | beads-service.ts | beads-filter.ts |
| Sort comparators | beads-service.ts | beads-sorter.ts |
| Edge extraction/dedup | beads-service.ts | beads-dependency.ts |
| `extractRig` | beads-service.ts | beads-repository.ts |
| `prefixToSource` | beads-service.ts | beads-repository.ts |

### Existing Types (moved to types.ts)

All existing types remain unchanged. They move from the top of beads-service.ts to `beads/types.ts`:

- `BeadInfo`, `BeadDetail`, `RecentlyClosedBead`
- `BeadStatus`, `ListBeadsOptions`, `UpdateBeadOptions`, `BeadsGraphOptions`
- `BeadsServiceResult<T>`, `EpicWithChildren`, `EpicProgress`
- `ProjectBeadsOverview`, `BeadSource`
