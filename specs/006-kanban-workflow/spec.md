# Feature Specification: Kanban Workflow for Beads

**Feature ID**: 006-kanban-workflow
**Status**: Implemented
**Created**: 2026-01-25

## Overview

Transform the Adjutant BEADS UI from a table view into a Kanban board with 7 workflow stages, per-rig filtering, and drag-and-drop status updates.

## Problem Statement

The current beads table view:
- Shows beads in a flat list without workflow context
- Doesn't visualize where work is in the pipeline
- Requires navigating to bd CLI to change status
- Lacks intuitive drag-and-drop interaction

The overseer and agents need:
1. Visual representation of work across workflow stages
2. Easy status updates via drag-and-drop
3. Ability to filter by rig to focus on specific projects

## Goals

1. Replace table view with 7-column Kanban board
2. Enable drag-and-drop to update bead status
3. Add rig filter dropdown for focused views
4. Maintain Pip-Boy terminal aesthetic

## Workflow Stages

| Stage | Status Value | Description |
|-------|-------------|-------------|
| **BACKLOG** | `backlog` | New tasks start here unless specified |
| **OPEN** | `open` | Ready to be picked up |
| **IN PROGRESS** | `in_progress` | Actively being worked |
| **TESTING** | `testing` | Running quality gates, confirming |
| **MERGING** | `merging` | In merge queue with refinery |
| **COMPLETE** | `complete` | Merged but not deployed |
| **CLOSED** | `closed` | Totally done |

## User Stories

### US1: Kanban Board View

**As a** human overseer or agent
**I want to** see beads organized in workflow columns
**So that** I can understand work status at a glance

**Acceptance Criteria:**
- AC1.1: 7 columns displayed horizontally
- AC1.2: Each column shows beads with matching status
- AC1.3: Columns have colored headers matching workflow stage
- AC1.4: Cards show bead ID, title, priority, type, assignee
- AC1.5: Columns are scrollable when many cards

### US2: Drag-and-Drop Status Updates

**As a** user
**I want to** drag beads between columns
**So that** I can quickly update status without CLI

**Acceptance Criteria:**
- AC2.1: Cards are draggable
- AC2.2: Columns highlight as valid drop targets
- AC2.3: Dropping updates status via API
- AC2.4: Optimistic UI update (immediate visual feedback)
- AC2.5: Rollback on API error with error toast

### US3: Rig Filter

**As a** user
**I want to** filter beads by rig/source
**So that** I can focus on specific projects

**Acceptance Criteria:**
- AC3.1: Dropdown in header with options: ALL, TOWN, + each rig
- AC3.2: Filtering updates Kanban columns immediately
- AC3.3: Selection persists in localStorage
- AC3.4: Rig options populated from bead sources dynamically

## Technical Approach

### Backend Changes

1. **Extend BeadStatus Type** (`beads-service.ts`)
   - Add: `backlog`, `testing`, `merging`, `complete`
   - Keep existing: `open`, `hooked`, `in_progress`, `blocked`, `deferred`, `closed`

2. **Add PATCH Endpoint** (`routes/beads.ts`)
   ```
   PATCH /api/beads/:id
   Body: { status: string }
   Response: { success: true, data: { id, status } }
   ```

3. **Add updateBeadStatus Service** (`beads-service.ts`)
   - Determine correct beads database from ID prefix
   - Execute `bd update <short-id> --status <status>`
   - Return success/error result

### Frontend Changes

1. **Kanban Types** (`types/kanban.ts`)
   - `KanbanColumnId` type
   - `KanbanColumn` interface
   - `KANBAN_COLUMNS` constant with colors
   - `mapStatusToColumn()` for legacy status mapping

2. **API Update Method** (`services/api.ts`)
   - `beads.update(id, status)` method

3. **KanbanCard Component** (`components/beads/KanbanCard.tsx`)
   - Draggable card with HTML5 drag events
   - Shows: ID, title, priority badge, type, assignee
   - Pip-Boy terminal aesthetic

4. **KanbanColumn Component** (`components/beads/KanbanColumn.tsx`)
   - Drop zone with drag-over highlighting
   - Column header with count
   - Scrollable card list

5. **KanbanBoard Component** (`components/beads/KanbanBoard.tsx`)
   - 7-column horizontal layout
   - Error toast for failed updates
   - Updating indicator

6. **useKanban Hook** (`hooks/useKanban.ts`)
   - Groups beads by status into columns
   - Manages drag state
   - Optimistic updates with rollback

7. **BeadsView Updates** (`components/beads/BeadsView.tsx`)
   - Replace BeadsList with KanbanBoard
   - Add rig filter dropdown
   - Keep search and overseer toggle

## Column Colors (Pip-Boy Theme)

```typescript
{
  backlog: '#666666',      // Gray - waiting
  open: '#00FF00',         // Green - ready
  in_progress: '#00FF88',  // Bright green - active
  testing: '#FFB000',      // Amber - verification
  merging: '#00BFFF',      // Cyan - integration
  complete: '#88FF88',     // Light green - done
  closed: '#444444',       // Dark gray - archived
}
```

## Legacy Status Mapping

Some beads may have statuses that don't match column IDs:
- `hooked` → `in_progress` column
- `blocked` → `in_progress` column (visible but marked)
- `deferred` → `backlog` column

## Out of Scope

- Real-time WebSocket updates (uses 30s polling)
- Card reordering within columns
- Swimlanes by assignee or type
- Mobile-specific Kanban view (future iOS app work)
- Batch status updates (drag multiple cards)

## Future: iOS App

After web frontend is complete:
- Port Kanban types to Swift
- Create SwiftUI KanbanBoard view
- Add rig filter to iOS navigation
- Sync with same backend API
