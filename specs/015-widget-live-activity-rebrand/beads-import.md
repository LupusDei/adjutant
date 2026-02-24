# 015 - Beads Import

## Root Epic

| Bead ID | Type | Priority | Title |
|---------|------|----------|-------|
| adj-019 | epic | P1 | Widget & Live Activity Rebrand + Enhancement |

## Sub-Epics

| Bead ID | Type | Priority | Title | Parent |
|---------|------|----------|-------|--------|
| adj-019.1 | epic | P1 | Phase 1: Rebranding | adj-019 |
| adj-019.2 | epic | P1 | Phase 2: Data Model & Backend | adj-019 |
| adj-019.3 | epic | P1 | Phase 3: Widget Enhancement | adj-019 |
| adj-019.4 | epic | P1 | Phase 4: Live Activity Enhancement | adj-019 |
| adj-019.5 | epic | P1 | Phase 5: Integration & Polish | adj-019 |

## Tasks

### Phase 1: Rebranding

| Bead ID | T-ID | Type | Priority | Title | Parent |
|---------|------|------|----------|-------|--------|
| adj-019.1.1 | T001 | task | P2 | Rename GastownActivityAttributes → AdjutantActivityAttributes | adj-019.1 |
| adj-019.1.2 | T002 | task | P2 | Rename GastownWidget → AdjutantWidget + update display strings | adj-019.1 |
| adj-019.1.3 | T003 | task | P2 | Update all main app references (LiveActivityService, DashboardVM) | adj-019.1 |

### Phase 2: Data Model & Backend

| Bead ID | T-ID | Type | Priority | Title | Parent |
|---------|------|------|----------|-------|--------|
| adj-019.2.1 | T004 | task | P2 | Add AgentSummary and BeadSummary types to AdjutantKit | adj-019.2 |
| adj-019.2.2 | T005 | task | P2 | Update AdjutantActivityAttributes.ContentState with rich data | adj-019.2 |
| adj-019.2.3 | T006 | task | P2 | Update AdjutantWidgetEntry with agent/bead summaries | adj-019.2 |
| adj-019.2.4 | T007 | task | P2 | Backend: Add GET /api/beads/recent-closed endpoint | adj-019.2 |
| adj-019.2.5 | T008 | task | P2 | iOS APIClient: Add getRecentlyClosedBeads() method | adj-019.2 |

### Phase 3: Widget Enhancement

| Bead ID | T-ID | Type | Priority | Title | Parent |
|---------|------|------|----------|-------|--------|
| adj-019.3.1 | T009 | task | P2 | Rework widget small view | adj-019.3 |
| adj-019.3.2 | T010 | task | P2 | Rework widget medium view | adj-019.3 |
| adj-019.3.3 | T011 | task | P2 | Rework widget large view | adj-019.3 |
| adj-019.3.4 | T012 | task | P2 | Update widget timeline provider for enriched data | adj-019.3 |

### Phase 4: Live Activity Enhancement

| Bead ID | T-ID | Type | Priority | Title | Parent |
|---------|------|------|----------|-------|--------|
| adj-019.4.1 | T013 | task | P2 | Rework Lock Screen view | adj-019.4 |
| adj-019.4.2 | T014 | task | P2 | Rework Dynamic Island expanded | adj-019.4 |
| adj-019.4.3 | T015 | task | P2 | Rework Dynamic Island compact + minimal | adj-019.4 |

### Phase 5: Integration

| Bead ID | T-ID | Type | Priority | Title | Parent |
|---------|------|------|----------|-------|--------|
| adj-019.5.1 | T016 | task | P2 | Update LiveActivityService for enriched ContentState | adj-019.5 |
| adj-019.5.2 | T017 | task | P2 | Update DashboardViewModel to sync enriched state | adj-019.5 |
| adj-019.5.3 | T018 | task | P2 | Verify iOS build + test widget and Live Activity | adj-019.5 |

## Dependencies

### Phase ordering
- adj-019.2 depends on adj-019.1 (renaming must happen first)
- adj-019.3 depends on adj-019.2 (widget needs new data model)
- adj-019.4 depends on adj-019.2 (live activity needs new data model)
- adj-019.5 depends on adj-019.3 AND adj-019.4

### Within-phase
- adj-019.2.2 depends on adj-019.2.1 (ContentState uses new types)
- adj-019.2.3 depends on adj-019.2.1 (WidgetEntry uses new types)
- adj-019.2.5 depends on adj-019.2.4 (iOS client wraps backend endpoint)
- adj-019.3.1-3 depend on adj-019.3.4 (views need provider data)
- adj-019.5.3 depends on adj-019.5.1 AND adj-019.5.2
