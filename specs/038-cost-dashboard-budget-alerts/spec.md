# Agent Cost Visibility — Spending Dashboard with Budget Alerts

**Feature**: 038-cost-dashboard-budget-alerts
**Priority**: P1
**Created**: 2026-03-09
**Source Proposal**: df31df06-8fd6-4109-b651-ca6bf40182f1

## Overview

Surface agent spending data into a dedicated cost dashboard (web + iOS), add budget management with multi-level alerts, track cost per epic/bead, and migrate cost persistence from JSON file to SQLite.

### What Already Exists (from adj-063)
- CostTracker service with per-session cost + token tracking (JSON file persistence)
- Cost API routes: GET /api/costs, GET /api/costs/sessions/:id, GET /api/costs/projects
- CrewMember enrichment with cost + contextPercent in agents-service
- Agent card cost/context display on web (SwarmAgentCard) and iOS (AgentRowView)
- Event bus: session:cost and session:cost_alert events
- SSE streaming of cost events to frontend

### What's New in This Epic
- SQLite persistence for cost data (replace JSON file)
- Dashboard cost panel on Overview page (web + iOS) as independent lazy-loaded module
- Budget management with multi-level alerts
- Per-bead/epic cost tracking and display on Beads page
- Full iOS cost dashboard
- Burn rate calculation

## User Stories

### US1: Cost Dashboard on Overview (P1)

**As a** user monitoring my agent swarm,
**I want to** see a cost dashboard on the Overview page,
**So that** I can track total spend, burn rate, and per-agent costs at a glance.

**Acceptance Criteria:**
- Overview page loads a CostPanel as a separate module (independent loading)
- Shows: total session spend, per-agent cost breakdown, burn rate ($/hr)
- Updates in near-real-time via SSE cost events
- Retro terminal styling consistent with other overview modules
- Web and iOS both show this panel

### US2: Budget Management (P1)

**As a** user with spending limits,
**I want to** set budgets and receive alerts,
**So that** I don't overspend on agent operations.

**Acceptance Criteria:**
- Can set session budget via API (POST /api/costs/budget)
- Multi-level alerts: warning at 80%, critical at 100%
- Budget bar visualization in cost panel (green/amber/red)
- Alerts visible in dashboard and cost panel
- Budget persisted in SQLite

### US3: Epic Cost Tracking (P1)

**As a** user evaluating efficiency,
**I want to** see how much each epic costs,
**So that** I can assess agent efficiency per unit of work.

**Acceptance Criteria:**
- Beads/Epics list page shows cost column for each epic
- Epic detail page shows cost breakdown (total, per-task, per-agent)
- Cost associated with beads via session→agent→bead mapping
- Works for both active and completed epics

### US4: SQLite Persistence (P2)

**As a** system operator,
**I want** cost data persisted in SQLite instead of a JSON file,
**So that** I get proper querying, history, and reliability.

**Acceptance Criteria:**
- New SQLite migration creates agent_costs table
- CostTracker writes to SQLite instead of JSON file
- Historical cost data queryable by date range
- Existing cost API routes work unchanged

### US5: iOS Cost Dashboard (P1)

**As a** mobile user,
**I want** a full cost dashboard on iOS,
**So that** I can monitor spending from my phone.

**Acceptance Criteria:**
- Dedicated cost view in iOS app (accessible from overview)
- Shows: total spend, per-agent breakdown, burn rate, budget status
- Matches web dashboard functionality
- Loads independently as a module on the overview screen

## Technical Notes

- Overview page modules should load independently (React.lazy or similar pattern)
- Burn rate: calculate from cost deltas over time windows (last 10min, last 1hr)
- Epic cost: aggregate session costs where session had beads from that epic assigned
- SQLite migration: `backend/src/services/database.ts` migration system
- iOS: SwiftUI view with AdjutantKit API client
