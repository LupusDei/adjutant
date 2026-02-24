# Implementation Plan: Swarm Overview Page

**Branch**: `016-swarm-overview` | **Date**: 2026-02-24
**Epic**: `adj-020` | **Priority**: P1

## Summary

Add a dedicated Overview tab for swarm mode that shows project-scoped beads, epics with completion progress, and agent status. Requires a new backend aggregate endpoint (`GET /api/projects/:id/overview`) that resolves the project path to its `.beads/` database and computes epic completion percentages. The iOS app gets a new leftmost tab with sections for Start Agent, Agents, Beads, and Epics.

## Bead Map

- `adj-020` - Root: Swarm Overview Page
  - `adj-020.1` - Backend API: Project overview endpoint
    - `adj-020.1.1` - Create project overview service
    - `adj-020.1.2` - Add epic completion computation
    - `adj-020.1.3` - Create GET /api/projects/:id/overview route
  - `adj-020.2` - iOS Foundation: Models + ViewModel + Tab
    - `adj-020.2.1` - Create SwarmOverview response models in AdjutantKit
    - `adj-020.2.2` - Add getProjectOverview to APIClient
    - `adj-020.2.3` - Create SwarmOverviewViewModel
    - `adj-020.2.4` - Register Overview tab in MainTabView
  - `adj-020.3` - US1: Beads Section
    - `adj-020.3.1` - Create SwarmOverviewView with section layout
    - `adj-020.3.2` - Build BeadsSectionView (open, in progress, recently closed)
  - `adj-020.4` - US2: Agents Section & Start Agent
    - `adj-020.4.1` - Build AgentsSectionView (status, beads, unread)
    - `adj-020.4.2` - Add Start Agent button with long-press callsign picker
    - `adj-020.4.3` - Implement post-spawn navigation to chat
  - `adj-020.5` - US3: Epics Section
    - `adj-020.5.1` - Build EpicsSectionView with progress indicators
    - `adj-020.5.2` - Handle empty state with recently completed fallback
  - `adj-020.6` - Polish
    - `adj-020.6.1` - Loading, empty, error states + pull-to-refresh
    - `adj-020.6.2` - Auto-refresh timer + theme consistency
  - `adj-020.7` - US4: Project Intelligence (user-assigned)
    - `adj-020.7.1` - Design agent suggestion workflow

## Technical Context

**Stack**: TypeScript + Express (backend), Swift + SwiftUI (iOS), AdjutantKit SPM package
**Storage**: SQLite (messages), bd CLI (beads via .beads/ database)
**Testing**: Vitest (backend), XCTest (iOS)
**Constraints**: iOS 17.0+, must resolve project path → .beads/ directory, bd CLI serialized via semaphore

## Architecture Decision

**Single aggregate endpoint** (`GET /api/projects/:id/overview`) rather than multiple separate calls. Mobile clients benefit from fewer round-trips. The endpoint:
1. Resolves project ID → path via projects-service
2. Finds `.beads/` in project path (or redirect chain)
3. Queries beads: `bd list --json --status=open,in_progress` + `bd list --json --status=closed` (recent)
4. Computes epic completion: for each epic, count closed/total children via dependency graph
5. Queries agents: filter crew members by matching session projectPath
6. Queries unread counts: from message-store per agent

**Epic completion** computed server-side by the beads-service:
- List all epics for the project
- For each epic, traverse its dependency children (not recursively — direct children only)
- completion = closed_children / total_children
- Sort by completion % descending

**Tab registration**: New `AppTab.overview` case, inserted at position 0 when `deploymentMode == .swarm && activeProject != nil`. Hidden otherwise.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/routes/projects.ts` | Add GET /api/projects/:id/overview |
| `backend/src/services/beads-service.ts` | Add getProjectOverview(), computeEpicProgress() |
| `backend/src/services/agents-service.ts` | Add getAgentsForProject(projectPath) filter |
| `ios/AdjutantKit/Sources/AdjutantKit/Models/SwarmOverview.swift` | New: response models |
| `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Endpoints.swift` | Add getProjectOverview() |
| `ios/Adjutant/Features/SwarmOverview/SwarmOverviewView.swift` | New: main overview screen |
| `ios/Adjutant/Features/SwarmOverview/SwarmOverviewViewModel.swift` | New: view model |
| `ios/Adjutant/Features/SwarmOverview/BeadsSectionView.swift` | New: beads section |
| `ios/Adjutant/Features/SwarmOverview/AgentsSectionView.swift` | New: agents section |
| `ios/Adjutant/Features/SwarmOverview/EpicsSectionView.swift` | New: epics section |
| `ios/Adjutant/Core/Navigation/MainTabView.swift` | Add .overview tab |
| `ios/Adjutant/Core/Navigation/AppCoordinator.swift` | Add overview route handling |

## Phase 1: Backend API

Create the aggregate endpoint. The beads-service already has `listBeads()` that accepts a cwd parameter for database resolution. We extend it with epic progress computation and project-scoped agent filtering.

Key: `resolveBeadsDir(projectPath)` already exists in bd-client.ts — reuse it to find the correct .beads/ directory for any registered project.

## Phase 2: iOS Foundation

Create Swift models matching the backend response, extend APIClient, create the ViewModel, and register the tab. This phase unblocks all UI work.

The ViewModel follows existing patterns (see SwarmProjectDetailViewModel): onAppear/onDisappear lifecycle, auto-refresh timer, error handling.

## Phase 3: US1 - Beads Section (MVP)

Build the main view and beads section. Beads grouped by status with visual treatment:
- **In Progress**: Prominent, shows assignee
- **Open**: Standard list, shows priority
- **Recently Closed**: Dimmed/completed styling, shows who closed

## Phase 4: US2 - Agents Section & Start Agent

Reuse SpawnAgentSheet for the callsign picker. The Start Agent button follows the same pattern as SwarmProjectDetailView: tap for random callsign, long-press for picker. After spawn, use AppCoordinator to navigate to chat.

## Phase 5: US3 - Epics Section

Display epics with progress bars. Completion percentage drives sort order. Empty state shows recently completed epics with completion checkmarks.

## Phase 6: Polish

Standard iOS patterns: skeleton loading, empty states per section, error banners with retry, pull-to-refresh, 10-second auto-refresh timer.

## Parallel Execution

- Phase 1 (Backend) and Phase 2 (iOS Foundation) can run in parallel — different codebases
- After Phase 2 completes: Phase 3, 4, 5 can all run in parallel — separate view files
- Phase 6 (Polish) depends on all UI phases completing

## Verification Steps

- [ ] Activate a project with beads and agents → Overview tab appears leftmost
- [ ] Deactivate project → Overview tab disappears
- [ ] Beads section shows correct status grouping
- [ ] Epic completion percentages match manual count
- [ ] Start Agent (tap) → spawns with random callsign → navigates to chat
- [ ] Start Agent (long-press) → callsign picker → spawn → navigate to chat
- [ ] Agent section shows status dots, bead assignments, unread counts
- [ ] Pull-to-refresh reloads all data
- [ ] No data from other projects appears in the overview
