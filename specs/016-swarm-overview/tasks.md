# Tasks: Swarm Overview Page

**Input**: Design documents from `/specs/016-swarm-overview/`
**Epic**: `adj-020`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-020.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Backend API

**Purpose**: Create aggregate project overview endpoint with epic completion computation

- [ ] T001 Create getProjectOverview() service function that resolves project path to .beads/ directory, queries beads by status (open, in_progress, recently closed), and aggregates agent data. in `backend/src/services/beads-service.ts`
- [ ] T002 [P] Add computeEpicProgress() that lists epics for a project, counts closed vs total direct children via dependency graph, returns completion percentage per epic sorted descending. in `backend/src/services/beads-service.ts`
- [ ] T003 Create GET /api/projects/:id/overview route that calls getProjectOverview(), filters agents by project path, includes unread message counts per agent. Returns ProjectOverviewResponse. in `backend/src/routes/projects.ts`

**Checkpoint**: Backend endpoint returns aggregated project data

---

## Phase 2: iOS Foundation

**Purpose**: Models, API client, ViewModel, and tab registration

- [ ] T004 [P] Create SwarmOverview response models: ProjectOverviewResponse, BeadSummary, EpicProgress, AgentOverview. Must be Codable, Identifiable, Equatable. in `ios/AdjutantKit/Sources/AdjutantKit/Models/SwarmOverview.swift`
- [ ] T005 Add getProjectOverview(projectId:) async method to APIClient. Returns ProjectOverviewResponse. in `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Endpoints.swift`
- [ ] T006 Create SwarmOverviewViewModel with: published overview data, loading/error state, onAppear/onDisappear lifecycle, refresh(), startAgent(callsign:) action. Auto-refresh every 10 seconds. in `ios/Adjutant/Features/SwarmOverview/SwarmOverviewViewModel.swift`
- [ ] T007 Register .overview tab in MainTabView as leftmost tab. Only visible when deploymentMode == .swarm AND activeProject is non-nil. Add AppTab.overview case and route handling in AppCoordinator. in `ios/Adjutant/Core/Navigation/MainTabView.swift` and `ios/Adjutant/Core/Navigation/AppCoordinator.swift`

**Checkpoint**: Tab appears, ViewModel fetches data, models parse correctly

---

## Phase 3: US1 - Beads Section (Priority: P1, MVP)

**Goal**: Show project beads grouped by status
**Independent Test**: Active project with mixed bead statuses shows correct grouping

- [ ] T008 [US1] Create SwarmOverviewView with ScrollView layout containing section headers for Start Agent, Agents, Beads, and Epics. Wire to SwarmOverviewViewModel. in `ios/Adjutant/Features/SwarmOverview/SwarmOverviewView.swift`
- [ ] T009 [US1] Build BeadsSectionView showing beads in three groups: In Progress (with assignee), Open (with priority badge), Recently Closed (dimmed, with closer name). Each bead row shows ID, title, and relevant metadata. in `ios/Adjutant/Features/SwarmOverview/BeadsSectionView.swift`

**Checkpoint**: Beads section displays correct data grouped by status

---

## Phase 4: US2 - Agents Section & Start Agent (Priority: P1)

**Goal**: Agent visibility and quick-spawn with chat navigation
**Independent Test**: Start agent from overview, verify navigation to chat

- [ ] T010 [P] [US2] Build AgentsSectionView showing each agent as a card: name, status dot (green=working, yellow=idle, red=blocked), current bead title, unread message count badge. in `ios/Adjutant/Features/SwarmOverview/AgentsSectionView.swift`
- [ ] T011 [US2] Add large Start Agent button at top of SwarmOverviewView. Tap spawns with random callsign. Long-press opens CallsignPickerView (reuse from SpawnAgentSheet). in `ios/Adjutant/Features/SwarmOverview/SwarmOverviewView.swift`
- [ ] T012 [US2] Implement post-spawn navigation: after successful spawn, use AppCoordinator to switch to Chat tab with new agent's sessionId as recipient. in `ios/Adjutant/Features/SwarmOverview/SwarmOverviewViewModel.swift`

**Checkpoint**: Start Agent → spawn → chat navigation works end to end

---

## Phase 5: US3 - Epic Progress (Priority: P2)

**Goal**: Show epics ordered by completion with visual progress
**Independent Test**: Epic with 3/4 closed children shows 75% progress bar

- [ ] T013 [US3] Build EpicsSectionView showing epics with: title, progress bar (% complete), child count (e.g., "3/4 tasks"), assignee if any. Sorted by completion % descending. in `ios/Adjutant/Features/SwarmOverview/EpicsSectionView.swift`
- [ ] T014 [US3] Handle empty state: when no epics are in progress, show "Recently Completed" section with last 2-3 completed epics and completion checkmarks. in `ios/Adjutant/Features/SwarmOverview/EpicsSectionView.swift`

**Checkpoint**: Epics show accurate completion, empty state works

---

## Phase 6: Polish & Cross-Cutting

- [ ] T015 [P] Add loading skeletons, per-section empty states, error banner with retry button, and pull-to-refresh (.refreshable) to SwarmOverviewView. in `ios/Adjutant/Features/SwarmOverview/SwarmOverviewView.swift`
- [ ] T016 Ensure auto-refresh timer (10s) in ViewModel, consistent Pip-Boy green theme across all section views, proper cleanup on onDisappear. in `ios/Adjutant/Features/SwarmOverview/SwarmOverviewViewModel.swift`

---

## Phase 7: US4 - Project Intelligence (User-Assigned)

- [ ] T017 [US4] Design and implement agent suggestion workflow: agents analyze project state, identify gaps, and suggest new beads to be worked on. This is assigned to the user for later implementation.

---

## Dependencies

- Phase 1 (Backend) → blocks Phase 2 T005 (APIClient needs endpoint to exist)
- Phase 1 T001 and T002 can run in parallel (different functions in same file)
- Phase 2 T004 can run in parallel with Phase 1 (just model definitions)
- Phase 2 → blocks Phases 3, 4, 5 (all UI needs ViewModel + models)
- Phases 3, 4, 5 can run in parallel after Phase 2 (separate view files)
- Phase 6 depends on Phases 3, 4, 5
- Phase 7 is independent (user-assigned, no code dependency)

## Parallel Opportunities

- T001 and T002 can run in parallel (different service functions)
- T004 can run in parallel with T001/T002/T003 (iOS models vs backend)
- T009, T010, T013 can run in parallel after Phase 2 (separate view files)
- T015 can start once any UI phase delivers its view file
