# 015 - Widget & Live Activity Rebrand + Enhancement

## Overview

Rebrand the iOS home screen widget and Live Activity from "Gas Town" to "Adjutant" and enhance both to show richer, actionable data: active agent callsigns with status, in-progress bead details, and recently completed beads.

## User Stories

### US1: Rebranding (Priority: P1)

**As an overseer**, I want the widget and Live Activity to reflect "Adjutant" branding so the naming is consistent with the app.

**Acceptance Criteria:**
- [ ] All "Gas Town" / "Gastown" text replaced with "Adjutant" in user-visible strings
- [ ] All type/class names renamed: `GastownWidget` → `AdjutantWidget`, `GastownActivityAttributes` → `AdjutantActivityAttributes`, `GastownWidgetEntry` → `AdjutantWidgetEntry`
- [ ] Widget configuration displays "Adjutant Status" as name
- [ ] `activityIdentifier` updated to `com.adjutant.status`
- [ ] No references to "Gas Town" remain in widget extension or activity attributes

### US2: Enhanced Widget Content (Priority: P1)

**As an overseer**, I want the widget to show active agent names with status and bead details so I can monitor my team at a glance without opening the app.

**Acceptance Criteria:**
- [ ] Widget shows up to 4 active agents (working/blocked) with callsign and status dot
- [ ] Widget shows in-progress bead titles with assignee name (not just counts)
- [ ] Widget shows last 2-3 beads completed in the past hour with who completed them
- [ ] Power state indicator and unread mail count preserved
- [ ] Small widget: status dot + agent count + bead count (compact)
- [ ] Medium widget: agent names + active beads
- [ ] Large widget: full dashboard with agents, active beads, and recent completions

### US3: Enhanced Live Activity (Priority: P1)

**As an overseer**, I want the Lock Screen and Dynamic Island to show who's working and what they're doing so I can check status without unlocking my phone.

**Acceptance Criteria:**
- [ ] Lock Screen shows top 2-3 active agent names with status dots
- [ ] Lock Screen shows current in-progress bead count and last completed bead title
- [ ] Dynamic Island expanded: agent names with status, active bead titles
- [ ] Dynamic Island compact: active agent count + in-progress bead count
- [ ] Dynamic Island minimal: aggregate status dot (green=working, yellow=idle, red=blocked)

### US4: Backend - Recently Closed Beads Endpoint (Priority: P1)

**As a widget consumer**, I need an API endpoint to fetch recently closed beads within a time window so I can show completion activity.

**Acceptance Criteria:**
- [ ] `GET /api/beads/recent-closed?hours=1` returns beads closed in the last hour
- [ ] Response includes bead id, title, assignee, closedAt timestamp
- [ ] Default window is 1 hour, configurable via `hours` query param
- [ ] Sorted by closedAt descending (most recent first)
- [ ] Limited to 10 results max
- [ ] Uses existing OVERSEER scope filtering (excludes system beads)

## Non-Goals

- No visual redesign of the CRT/terminal aesthetic
- No new widget sizes (accessory widgets, etc.)
- No interactive widget controls (buttons, intents)
- No push notification-driven Live Activity updates (keep polling)

## Success Criteria

- Widget and Live Activity show "Adjutant" branding everywhere
- At a glance, the overseer can see: who's active, what they're working on, what just finished
- No regression in existing functionality (power state, mail count)
- iOS build succeeds with zero new warnings
