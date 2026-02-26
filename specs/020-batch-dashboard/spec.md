# Feature Specification: Batch Dashboard Initialization

**Feature Branch**: `020-batch-dashboard`
**Created**: 2026-02-25
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Single-Request Dashboard Load (Priority: P1)

When the dashboard mounts, the frontend fetches all initial data via a single `GET /api/dashboard` request instead of 6+ individual API calls. Each section of the response can independently succeed or fail, enabling partial rendering.

**Why this priority**: Eliminates request waterfall on mobile (iOS via ngrok), reduces latency by 5-6x, and removes partial-load UI jank where some panels render while others show errors.

**Independent Test**: Open dashboard in browser with DevTools Network tab — confirm exactly 1 XHR request on mount (excluding WebSocket/SSE), response contains all sections.

**Acceptance Scenarios**:

1. **Given** the dashboard mounts, **When** all backend services are healthy, **Then** a single `GET /api/dashboard` returns status, beads, crew, unreadCounts, epics (with progress), and mail in one response with HTTP 200.
2. **Given** the dashboard mounts, **When** the beads service is unavailable but other services work, **Then** the response returns `beads: { data: null, error: "..." }` with all other sections populated.
3. **Given** the dashboard is mounted, **When** 30 seconds elapse, **Then** the dashboard automatically polls `GET /api/dashboard` and updates all panels atomically.

---

### User Story 2 - Unified Frontend Hook (Priority: P1)

A single `useDashboard()` hook replaces `useDashboardBeads`, `useDashboardCrew`, `useDashboardEpics`, `useDashboardMail`, and the initial `useGastownStatus` fetch. The hook handles initial load and periodic polling.

**Why this priority**: Simplifies component code from 4 separate hooks with 4 loading/error states to 1 hook with 1 loading state. Enables atomic UI updates.

**Independent Test**: Replace all individual hooks in OverviewDashboard with useDashboard(). Verify all panels render correctly, polling works at configured interval, and partial failures show per-section errors.

**Acceptance Scenarios**:

1. **Given** OverviewDashboard uses `useDashboard()`, **When** the hook loads, **Then** all panels render atomically (no staggered panel loading).
2. **Given** a section has `data: null` with an error, **When** the component renders, **Then** that section shows an error message while other sections render normally.
3. **Given** the dashboard is visible, **When** the polling interval fires, **Then** all panel data refreshes without a full loading state (stale-while-revalidate).

---

### Edge Cases

- What happens when ALL backend services fail? → Response returns with every section `{ data: null, error: "..." }`, frontend shows a global error banner.
- What happens during a power state transition (starting/stopping)? → Status section updates normally; other sections may show stale data until next poll.
- What happens if the dashboard is backgrounded (tab hidden)? → Polling pauses via `document.hidden` check, resumes on tab focus.

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide `GET /api/dashboard` endpoint returning all dashboard data in a single response.
- **FR-002**: Each response section MUST be independently nullable — partial failures return data for healthy sections and `null + error` for failed sections.
- **FR-003**: Backend MUST fetch all sections in parallel using `Promise.allSettled`.
- **FR-004**: Response MUST include: status, beads (3 categories × 5 limit), crew, unreadCounts, epics (with progress), mail (recent + counts), and a timestamp.
- **FR-005**: Frontend `useDashboard()` hook MUST support configurable polling interval (default 30s).
- **FR-006**: Frontend MUST implement stale-while-revalidate — show previous data while polling, only show loading spinner on initial mount.
- **FR-007**: Existing individual endpoints (`/api/status`, `/api/beads`, `/api/agents`, etc.) MUST remain unchanged for targeted refreshes.

### Key Entities

- **DashboardSection<T>**: Wrapper with `data: T | null` and optional `error: string` — represents one section's fetch result.
- **DashboardResponse**: Top-level response containing all dashboard sections plus a timestamp.

## Success Criteria

- **SC-001**: Dashboard mount triggers exactly 1 HTTP request (down from 6+).
- **SC-002**: P95 dashboard load time under 500ms on local, under 1500ms via ngrok tunnel.
- **SC-003**: Partial backend failures render available sections — no all-or-nothing error page.
- **SC-004**: All existing dashboard functionality preserved (same data displayed, same interactions).
