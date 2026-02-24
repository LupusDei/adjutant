# 015 - Implementation Plan

## Architecture Decisions

### Data Model Changes

**AdjutantActivityAttributes.ContentState** (replaces GastownActivityAttributes):
```swift
public struct ContentState: Codable, Hashable {
    public let powerState: PowerState
    public let unreadMailCount: Int
    public let activeAgents: [AgentSummary]     // NEW: up to 4 active agents
    public let beadsInProgress: [BeadSummary]   // NEW: active bead details
    public let recentlyCompleted: [BeadSummary] // NEW: completed in last hour
    public let lastUpdated: Date
}

public struct AgentSummary: Codable, Hashable {
    public let name: String          // Callsign (e.g., "ace", "toast")
    public let status: String        // working, blocked, idle
}

public struct BeadSummary: Codable, Hashable {
    public let id: String
    public let title: String
    public let assignee: String?     // Short name
}
```

**AdjutantWidgetEntry**: Same enrichment — agents, bead summaries, recent completions.

### Backend Endpoint

New route: `GET /api/beads/recent-closed`
- Query param: `hours` (default: 1, max: 24)
- Uses existing `listAllBeads` with status=closed, then filters by closedAt
- Needs closedAt from BeadDetail — may need to use `getBead()` per result or add closedAt to list endpoint

### File Changes

**AdjutantKit (shared models):**
- `GastownActivityAttributes.swift` → rename to `AdjutantActivityAttributes.swift`
- `Bead.swift` → add `AgentSummary`, `BeadSummary` types

**Widget Extension:**
- `GastownWidget.swift` → rename to `AdjutantWidget.swift`, enhance data fetching
- `AdjutantLiveActivity.swift` → update to use new ContentState, richer views

**Main App:**
- `LiveActivityService.swift` → update type references, create richer state
- `DashboardViewModel.swift` → update state creation calls

**Backend:**
- `backend/src/routes/beads.ts` → add `GET /api/beads/recent-closed`
- `backend/src/services/beads-service.ts` → add `listRecentlyClosed()`

### Parallel Opportunities

- **Backend endpoint** (US4) is independent of all iOS work
- **Rebranding** (US1) can be done in parallel with data model work
- **Widget enhancement** (US2) and **Live Activity enhancement** (US3) depend on data model but are independent of each other

## Phases

### Phase 1: Rebranding
Rename all Gas Town references to Adjutant. Pure renaming, no behavior change.

### Phase 2: Data Model & Backend
Update ActivityAttributes, add summary types, add backend endpoint.

### Phase 3: Widget Enhancement
Rework widget views to show agent names, bead details, recent completions.

### Phase 4: Live Activity Enhancement
Rework Live Activity views for richer Dynamic Island and Lock Screen content.

### Phase 5: Integration & Polish
Update LiveActivityService and DashboardViewModel to produce enriched state.

## Bead Map

- `adj-019` - Root epic: Widget & Live Activity Rebrand + Enhancement
  - `adj-019.1` - Phase 1: Rebranding
    - `adj-019.1.1` - Rename GastownActivityAttributes → AdjutantActivityAttributes
    - `adj-019.1.2` - Rename GastownWidget → AdjutantWidget + update display strings
    - `adj-019.1.3` - Update all references in main app (LiveActivityService, DashboardViewModel)
  - `adj-019.2` - Phase 2: Data Model & Backend
    - `adj-019.2.1` - Add AgentSummary and BeadSummary types to AdjutantKit
    - `adj-019.2.2` - Update AdjutantActivityAttributes.ContentState with rich data
    - `adj-019.2.3` - Update AdjutantWidgetEntry with agent/bead summaries
    - `adj-019.2.4` - [P] Backend: Add GET /api/beads/recent-closed endpoint
    - `adj-019.2.5` - [P] iOS APIClient: Add getRecentlyClosedBeads() method
  - `adj-019.3` - Phase 3: Widget Enhancement
    - `adj-019.3.1` - Rework widget small view (status dot, agent count, bead count)
    - `adj-019.3.2` - Rework widget medium view (agent names, active beads)
    - `adj-019.3.3` - Rework widget large view (full dashboard with completions)
    - `adj-019.3.4` - Update widget timeline provider to fetch enriched data
  - `adj-019.4` - Phase 4: Live Activity Enhancement
    - `adj-019.4.1` - Rework Lock Screen view (agents with status, bead count, last completed)
    - `adj-019.4.2` - Rework Dynamic Island expanded (agents + beads)
    - `adj-019.4.3` - Rework Dynamic Island compact + minimal
  - `adj-019.5` - Phase 5: Integration
    - `adj-019.5.1` - Update LiveActivityService to produce enriched ContentState
    - `adj-019.5.2` - Update DashboardViewModel to sync enriched live activity state
    - `adj-019.5.3` - Verify iOS build, test widget and Live Activity
