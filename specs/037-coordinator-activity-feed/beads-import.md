# Beads Import: Coordinator Activity Feed

## Root Epic

| Bead ID | Title | Type | Priority |
|---------|-------|------|----------|
| adj-059 | Coordinator Activity Feed via Timeline Integration | epic | P2 |

## Tasks (directly under root — small feature, no sub-epics)

| Bead ID | T-ID | Title | Type | Depends On |
|---------|------|-------|------|------------|
| adj-059.1 | T001 | Add coordinator:action to EventBus + EventType | task | — |
| adj-059.2 | T002 | Bridge logDecision → eventStore in coordination tools | task | adj-059.1 |
| adj-059.3 | T003 | Add SSE mapping in events router | task | adj-059.1 |
| adj-059.4 | T004 | Tests for coordinator action timeline integration | task | adj-059.2, adj-059.3 |
| adj-059.5 | T005 | Frontend filter chip + event card rendering | task | adj-059.1 |
