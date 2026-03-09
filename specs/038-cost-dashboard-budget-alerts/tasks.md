# Agent Cost Visibility — Tasks

**Feature**: 038-cost-dashboard-budget-alerts
**Root Epic**: adj-064

## Phase 1: Backend — SQLite + Budget + Burn Rate

- [ ] T001 [US4] SQLite migration for agent_costs table in backend/src/services/database.ts
- [ ] T002 [US4] Migrate CostTracker from JSON to SQLite persistence in backend/src/services/cost-tracker.ts
- [ ] T003 [US2] Add budget management API (POST/GET /api/costs/budget) with multi-level alerts in backend/src/routes/costs.ts
- [ ] T004 [US1] Add burn rate calculation endpoint (GET /api/costs/burn-rate) in backend/src/services/cost-tracker.ts
- [ ] T005 [US3] Add per-bead/epic cost aggregation (GET /api/costs/by-bead/:id) in backend/src/routes/costs.ts
- [ ] T006 Tests for SQLite persistence, budget, burn rate, per-bead cost

## Phase 2: Frontend — Cost Dashboard Panel

- [ ] T007 [US1] Create CostPanel component for Overview page in frontend/src/components/dashboard/CostPanel.tsx
- [ ] T008 [US1] Lazy-load CostPanel as independent module on Overview page
- [ ] T009 [US2] Add budget bar + alert display to CostPanel
- [ ] T010 [US3] Add epic cost column to Beads/Epics list page
- [ ] T011 [US3] Add cost breakdown to Epic detail page

## Phase 3: iOS — Cost Dashboard

- [ ] T012 [US5] Add cost API models to AdjutantKit (CostSummary, BurnRate, Budget)
- [ ] T013 [US5] Add cost API client methods to AdjutantKit
- [ ] T014 [US5] Create CostDashboardView for iOS
- [ ] T015 [US5] Load CostDashboardView as module on iOS Overview screen
- [ ] T016 [US3] Add epic cost display to iOS Beads views

## Phase 4: QA

- [ ] T017 QA: edge cases — zero cost, budget overflow, missing sessions, stale data, concurrent updates
