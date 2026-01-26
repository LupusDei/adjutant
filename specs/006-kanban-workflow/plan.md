# Implementation Plan: Kanban Workflow for Beads

**Feature ID**: 006-kanban-workflow
**Status**: Implemented
**Implemented**: 2026-01-25

## Architecture Decision

**Extend Beads Statuses** rather than using labels:
- Cleaner semantics with proper bd CLI integration
- Status is the natural field for workflow stage
- Avoids label parsing complexity

## Files Changed

### Backend

| File | Change |
|------|--------|
| `backend/src/services/beads-service.ts` | Extended `BeadStatus` type, added `updateBeadStatus()` function |
| `backend/src/routes/beads.ts` | Added `PATCH /api/beads/:id` endpoint |

### Frontend

| File | Change |
|------|--------|
| `frontend/src/types/kanban.ts` | **New** - Kanban types and constants |
| `frontend/src/types/index.ts` | Export kanban types |
| `frontend/src/services/api.ts` | Added `beads.update()` method |
| `frontend/src/hooks/useKanban.ts` | **New** - Drag state and optimistic updates |
| `frontend/src/components/beads/KanbanCard.tsx` | **New** - Draggable bead card |
| `frontend/src/components/beads/KanbanColumn.tsx` | **New** - Drop zone column |
| `frontend/src/components/beads/KanbanBoard.tsx` | **New** - 7-column board |
| `frontend/src/components/beads/BeadsView.tsx` | Replaced table with Kanban, added rig filter |

## Phase 1: Backend Changes

### Task 1.1: Extend BeadStatus Type
**File:** `backend/src/services/beads-service.ts`

```typescript
export type BeadStatus =
  | "backlog"      // New
  | "open"
  | "hooked"
  | "in_progress"
  | "blocked"
  | "testing"      // New
  | "merging"      // New
  | "complete"     // New
  | "deferred"
  | "closed";
```

Updated `DEFAULT_STATUSES` and `ALL_STATUSES` arrays.

### Task 1.2: Add updateBeadStatus Function
**File:** `backend/src/services/beads-service.ts`

```typescript
export async function updateBeadStatus(
  beadId: string,
  status: BeadStatus
): Promise<BeadsServiceResult<{ id: string; status: string }>>
```

- Validates status against `ALL_STATUSES`
- Determines beads database from ID prefix
- Executes `bd update <short-id> --status <status>`

### Task 1.3: Add PATCH Endpoint
**File:** `backend/src/routes/beads.ts`

```typescript
beadsRouter.patch("/:id", async (req, res) => {
  const beadId = req.params["id"];
  const { status } = req.body;
  // Validate and call updateBeadStatus
});
```

## Phase 2: Frontend Types & API

### Task 2.1: Kanban Types
**File:** `frontend/src/types/kanban.ts`

```typescript
export type KanbanColumnId =
  | 'backlog' | 'open' | 'in_progress'
  | 'testing' | 'merging' | 'complete' | 'closed';

export interface KanbanColumn {
  id: KanbanColumnId;
  title: string;
  beads: BeadInfo[];
  color: string;
}

export const KANBAN_COLUMNS = [...];
export function mapStatusToColumn(status: string): KanbanColumnId;
```

### Task 2.2: API Update Method
**File:** `frontend/src/services/api.ts`

```typescript
beads: {
  list: (...) => ...,
  update: (id: string, status: string) =>
    apiFetch(`/beads/${id}`, { method: 'PATCH', body: { status } })
}
```

## Phase 3: Kanban Components

### Task 3.1: KanbanCard Component
**File:** `frontend/src/components/beads/KanbanCard.tsx`

- Props: `bead`, `onDragStart`, `onDragEnd`, `isDragging`
- HTML5 `draggable` attribute
- Shows: ID, title, priority, type, assignee
- Dragging state reduces opacity, adds glow

### Task 3.2: KanbanColumn Component
**File:** `frontend/src/components/beads/KanbanColumn.tsx`

- Props: `id`, `title`, `color`, `beads`, `isDropTarget`, drag handlers
- `onDragOver` prevents default, sets drop effect
- `onDrop` calls parent handler
- Visual feedback when `isDropTarget` is true

### Task 3.3: KanbanBoard Component
**File:** `frontend/src/components/beads/KanbanBoard.tsx`

- Uses `useKanban` hook for state management
- Renders 7 `KanbanColumn` components
- Shows error toast on failed updates
- Shows "UPDATING..." indicator during API calls

### Task 3.4: useKanban Hook
**File:** `frontend/src/hooks/useKanban.ts`

```typescript
export function useKanban(
  beads: BeadInfo[],
  onBeadsChange: (updater) => void,
  options?: { onStatusUpdate?, onError? }
): {
  columns: KanbanColumn[];
  dragState: KanbanDragState;
  isUpdating: boolean;
  handleDragStart, handleDragEnd, handleDragOver, handleDragLeave, handleDrop;
}
```

- Groups beads into columns via `mapStatusToColumn`
- Manages drag state (beadId, fromColumn, overColumn)
- Optimistic update on drop, rollback on error

## Phase 4: BeadsView Integration

### Task 4.1: Add Rig Filter
**File:** `frontend/src/components/beads/BeadsView.tsx`

- State: `rigFilter` with options 'ALL', 'TOWN', or rig name
- Persisted to localStorage
- Filters beads by `source` field

### Task 4.2: Replace Table with Kanban
**File:** `frontend/src/components/beads/BeadsView.tsx`

- Remove `BeadsList` import
- Add `KanbanBoard` import
- Manage local `beads` state for optimistic updates
- Pass `filteredBeads` and `handleBeadsChange` to board

## Parallel Execution

**Batch 1 (Backend - Sequential):**
- 1.1 → 1.2 → 1.3

**Batch 2 (Frontend Types - Parallel):**
- 2.1, 2.2

**Batch 3 (Components - Parallel then Sequential):**
- 3.1, 3.2 (parallel - card and column)
- 3.3, 3.4 (after - board and hook)

**Batch 4 (Integration - Sequential):**
- 4.1 → 4.2

## Verification Steps

1. Start adjutant: `cd adjutant && npm run dev`
2. Open BEADS tab
3. Verify 7 Kanban columns display
4. Drag a bead from backlog to open
5. Verify status updates in bd CLI: `bd show <id>`
6. Refresh page - verify state persisted
7. Test rig filter - verify filtering works
8. Test error handling - stop backend, try drag, verify rollback
