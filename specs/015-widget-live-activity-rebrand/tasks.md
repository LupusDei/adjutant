# 015 - Tasks

## Phase 1: Rebranding

- [ ] T001 [US1] Rename GastownActivityAttributes.swift → AdjutantActivityAttributes.swift, rename struct and all internal references in ios/AdjutantKit/Sources/AdjutantKit/Models/GastownActivityAttributes.swift
- [ ] T002 [US1] Rename GastownWidget → AdjutantWidget, GastownWidgetEntry → AdjutantWidgetEntry, GastownWidgetProvider → AdjutantWidgetProvider. Update display name to "Adjutant Status" and description in ios/AdjutantWidgets/GastownWidget.swift
- [ ] T003 [US1] Update all references in main app: LiveActivityService.swift, DashboardViewModel.swift, and any other files referencing old type names

## Phase 2: Data Model & Backend

- [ ] T004 [US2,US3] Add AgentSummary and BeadSummary structs to ios/AdjutantKit/Sources/AdjutantKit/Models/Bead.swift (or new file)
- [ ] T005 [US2,US3] Update AdjutantActivityAttributes.ContentState to include activeAgents: [AgentSummary], beadsInProgress: [BeadSummary], recentlyCompleted: [BeadSummary] in ios/AdjutantKit/Sources/AdjutantKit/Models/AdjutantActivityAttributes.swift
- [ ] T006 [US2] Update AdjutantWidgetEntry to include agents: [AgentSummary], beadDetails: [BeadSummary], recentlyCompleted: [BeadSummary] in ios/AdjutantWidgets/AdjutantWidget.swift
- [ ] T007 [P] [US4] Add GET /api/beads/recent-closed endpoint with hours query param in backend/src/routes/beads.ts and backend/src/services/beads-service.ts
- [ ] T008 [P] [US2,US4] Add getRecentlyClosedBeads(hours:) method to ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Endpoints.swift

## Phase 3: Widget Enhancement

- [ ] T009 [US2] Rework systemSmall widget view: status dot, active agent count, in-progress bead count in ios/AdjutantWidgets/AdjutantWidget.swift
- [ ] T010 [US2] Rework systemMedium widget view: agent names with status dots, top active beads with assignee in ios/AdjutantWidgets/AdjutantWidget.swift
- [ ] T011 [US2] Rework systemLarge widget view: full dashboard with agents, active beads, and recent completions in ios/AdjutantWidgets/AdjutantWidget.swift
- [ ] T012 [US2] Update widget timeline provider to fetch agents (GET /status), active beads, and recently closed beads in ios/AdjutantWidgets/AdjutantWidget.swift

## Phase 4: Live Activity Enhancement

- [ ] T013 [US3] Rework Lock Screen view: show top 2-3 agent names with status dots, bead count, last completed bead title in ios/AdjutantWidgets/AdjutantLiveActivity.swift
- [ ] T014 [US3] Rework Dynamic Island expanded: agent names with status, active bead titles in ios/AdjutantWidgets/AdjutantLiveActivity.swift
- [ ] T015 [US3] Rework Dynamic Island compact (agent count + bead count) and minimal (aggregate status dot) in ios/AdjutantWidgets/AdjutantLiveActivity.swift

## Phase 5: Integration

- [ ] T016 [US2,US3] Update LiveActivityService to produce enriched ContentState from status + agents + beads data in ios/Adjutant/Services/LiveActivityService.swift
- [ ] T017 [US2,US3] Update DashboardViewModel.syncActivity to pass enriched state in ios/Adjutant/Features/Dashboard/DashboardViewModel.swift
- [ ] T018 [US1,US2,US3] Verify full iOS build, test widget rendering and Live Activity in all states
