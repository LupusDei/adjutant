# Quickstart: Decompose beads-service.ts

**Feature**: 019-beads-service-decompose
**Date**: 2026-02-25

## Migration Guide

### For Consumers (Route Handlers, Tests)

**Before**:
```typescript
import { listBeads, getBead, getBeadsGraph } from '../services/beads-service';
```

**After**:
```typescript
import { listBeads, getBead, getBeadsGraph } from '../services/beads';
```

That's it. The barrel `index.ts` re-exports everything with identical names and signatures.

### For New Code

When adding new beads functionality, import from the specific sub-module:

```typescript
// For CLI operations
import { fetchBeadsList, fetchBeadDetail } from '../services/beads/beads-repository';

// For pure filtering
import { filterByStatus, excludeWisps } from '../services/beads/beads-filter';

// For graph/dependency logic
import { extractGraphEdges, computeEpicProgress } from '../services/beads/beads-dependency';

// For sorting
import { sortByPriority } from '../services/beads/beads-sorter';
```

### Verification Steps

1. **Build**: `npm run build` — must compile with zero errors
2. **Backend tests**: `cd backend && npx vitest run` — all 87+ tests pass
3. **Frontend tests**: `cd frontend && npx vitest run` — no regressions (frontend doesn't import from beads-service)
4. **Manual smoke test**: Start the server, verify `/api/beads`, `/api/beads/graph`, `/api/beads/:id` return expected data
5. **Import check**: `grep -r "beads-service" backend/src/` — should return zero results after migration
6. **bd-client check**: `grep -r "bd-client" backend/src/services/beads/` — should only appear in beads-repository.ts
