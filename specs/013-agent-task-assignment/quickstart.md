# Quickstart: Agent Task Assignment

## Prerequisites

- Adjutant backend running (`npm run dev` in `backend/`)
- Adjutant frontend running (`npm run dev` in `frontend/`)
- At least one agent connected via MCP (for testing notifications)

## Testing the Feature

### 1. Verify Agent List Endpoint

```bash
curl http://localhost:3001/api/agents
# Should return: { "agents": [...] }

curl "http://localhost:3001/api/agents?status=idle"
# Should return only idle agents
```

### 2. Assign a Bead via API

```bash
# Find an open bead
curl http://localhost:3001/api/beads?status=open

# Assign it to an agent
curl -X PATCH http://localhost:3001/api/beads/hq-abc123 \
  -H "Content-Type: application/json" \
  -d '{"assignee": "agent-1"}'

# Verify: status should be "in_progress", assignee should be "agent-1"
curl http://localhost:3001/api/beads/hq-abc123
```

### 3. Test in UI

1. Open Beads view in the dashboard
2. Find an open bead card
3. Click the agent assignment dropdown on the card
4. Select an available agent
5. Verify: card moves to "in_progress" column, assignee shown on card
6. Check agent received notification in Messages view

### 4. Test in Epics View

1. Open Epics view
2. Expand an epic to see subtasks
3. Click assign on a subtask
4. Select an agent
5. Verify same behavior as Beads view

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/routes/beads.ts` | Extended PATCH endpoint |
| `backend/src/routes/agents.ts` | New agent list endpoint |
| `frontend/src/components/shared/AgentAssignDropdown.tsx` | Shared assignment UI |
| `frontend/src/components/beads/KanbanCard.tsx` | Updated with assign control |
| `frontend/src/components/epics/EpicDetailView.tsx` | Updated with assign control |
| `frontend/src/services/api.ts` | New assign and agents methods |
