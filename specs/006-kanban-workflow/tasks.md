# Tasks: Kanban Workflow for Beads

**Feature ID**: 006-kanban-workflow
**Status**: Implemented

## Completed Tasks

### Backend

- [x] **1.1** Extend BeadStatus type with new Kanban statuses
  - Added: backlog, testing, merging, complete
  - Updated DEFAULT_STATUSES and ALL_STATUSES arrays

- [x] **1.2** Add updateBeadStatus function to beads-service
  - Validates status, determines database from prefix
  - Executes bd update command

- [x] **1.3** Add PATCH /api/beads/:id endpoint
  - Request body: { status: string }
  - Returns: { success: true, data: { id, status } }

### Frontend Types & API

- [x] **2.1** Create Kanban types file
  - types/kanban.ts with KanbanColumnId, KanbanColumn
  - KANBAN_COLUMNS constant with colors
  - mapStatusToColumn function

- [x] **2.2** Add beads.update API method
  - PATCH request to /api/beads/:id

### Frontend Components

- [x] **3.1** Create KanbanCard component
  - Draggable bead card
  - Shows ID, title, priority, type, assignee
  - Pip-Boy terminal aesthetic

- [x] **3.2** Create KanbanColumn component
  - Drop zone with drag-over highlighting
  - Column header with count
  - Scrollable card list

- [x] **3.3** Create KanbanBoard component
  - 7-column horizontal layout
  - Error toast for failed updates
  - Updating indicator

- [x] **3.4** Create useKanban hook
  - Groups beads by status into columns
  - Manages drag state
  - Optimistic updates with rollback

### Integration

- [x] **4.1** Add rig filter to BeadsView
  - Dropdown: ALL, TOWN, + each rig
  - Persisted to localStorage

- [x] **4.2** Replace table with Kanban board
  - Removed BeadsList table view
  - KanbanBoard as primary view
  - Kept search and overseer toggle

## Future Tasks

- [ ] Add tests for backend PATCH endpoint
- [ ] Add tests for frontend Kanban components
- [ ] Port to iOS app (SwiftUI KanbanBoard)
- [ ] Consider real-time updates via WebSocket
