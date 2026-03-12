/**
 * Shared Zod schemas for beads and overview API response contracts.
 *
 * Single source of truth for beads endpoint response shapes.
 * Used by contract tests, and available for frontend/iOS type generation.
 *
 * @module types/beads-contracts
 */

import { z } from "zod";
import { apiSuccessSchema, ApiErrorSchema } from "./cost-contracts.js";

// Re-export the envelope helpers
export { apiSuccessSchema, ApiErrorSchema };

// ============================================================================
// BeadInfo — list endpoints
// ============================================================================

export const BeadInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.number(),
  type: z.string(),
  assignee: z.string().nullable(),
  project: z.string().nullable(),
  source: z.string(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

// ============================================================================
// BeadDetail — show endpoint
// ============================================================================

export const BeadDependencySchema = z.object({
  issueId: z.string(),
  dependsOnId: z.string(),
  type: z.string(),
});

export const BeadDetailSchema = BeadInfoSchema.extend({
  closedAt: z.string().nullable(),
  agentState: z.string().nullable(),
  dependencies: z.array(BeadDependencySchema),
  isWisp: z.boolean(),
  isPinned: z.boolean(),
});

// ============================================================================
// RecentlyClosedBead
// ============================================================================

export const RecentlyClosedBeadSchema = z.object({
  id: z.string(),
  title: z.string(),
  assignee: z.string().nullable(),
  closedAt: z.string(),
  type: z.string(),
  priority: z.number(),
  project: z.string().nullable(),
  source: z.string(),
});

// ============================================================================
// BeadSource — sources endpoint
// ============================================================================

export const BeadSourceSchema = z.object({
  name: z.string(),
  path: z.string(),
  hasBeads: z.boolean(),
});

export const BeadSourcesResponseDataSchema = z.object({
  sources: z.array(BeadSourceSchema),
  mode: z.string(),
});

// ============================================================================
// EpicWithChildren — epics-with-progress endpoint
// ============================================================================

export const EpicWithChildrenSchema = z.object({
  epic: BeadInfoSchema,
  children: z.array(BeadInfoSchema),
  totalCount: z.number(),
  closedCount: z.number(),
  progress: z.number(),
});

// ============================================================================
// Graph — already defined in types/beads.ts, re-import
// ============================================================================

// Graph schemas already exist in types/beads.ts (GraphNodeSchema, etc.)
// We import and re-export them for contract test convenience.
export { BeadsGraphResponseSchema, GraphNodeSchema, GraphDependencySchema } from "./beads.js";

// ============================================================================
// PATCH /api/beads/:id response
// ============================================================================

export const BeadUpdateResponseDataSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  assignee: z.string().optional(),
  autoCompleted: z.array(z.string()).optional(),
});

// ============================================================================
// EpicProgress — overview endpoint
// ============================================================================

export const EpicProgressSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  totalChildren: z.number(),
  closedChildren: z.number(),
  completionPercent: z.number(),
  assignee: z.string().nullable(),
  closedAt: z.string().nullable().optional(),
});

// ============================================================================
// AgentOverview — overview endpoint
// ============================================================================

export const AgentOverviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  project: z.string().nullable(),
  currentBead: z.string().nullable(),
  unreadCount: z.number(),
  sessionId: z.string().nullable(),
  cost: z.number().nullable(),
  contextPercent: z.number().nullable(),
});

// ============================================================================
// Overview response
// ============================================================================

export const ProjectInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  active: z.boolean(),
});

export const OverviewResponseDataSchema = z.object({
  projects: z.array(ProjectInfoSchema),
  beads: z.object({
    open: z.array(BeadInfoSchema),
    inProgress: z.array(BeadInfoSchema),
    recentlyClosed: z.array(BeadInfoSchema),
  }),
  epics: z.object({
    inProgress: z.array(EpicProgressSchema),
    recentlyCompleted: z.array(EpicProgressSchema),
  }),
  agents: z.array(AgentOverviewSchema),
  unreadMessages: z.array(z.unknown()), // Shape varies by message store
});

// ============================================================================
// Composed API response schemas
// ============================================================================

export const BeadListResponseSchema = apiSuccessSchema(z.array(BeadInfoSchema));
export const BeadDetailResponseSchema = apiSuccessSchema(BeadDetailSchema);
export const BeadSourcesResponseSchema = apiSuccessSchema(BeadSourcesResponseDataSchema);
export const RecentClosedResponseSchema = apiSuccessSchema(z.array(RecentlyClosedBeadSchema));
export const GraphResponseSchema = apiSuccessSchema(z.lazy(() => {
  // Import dynamically to avoid circular dependency with beads.ts
  return z.object({
    nodes: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      type: z.string(),
      priority: z.number(),
      assignee: z.string().nullable(),
      source: z.string(),
    })),
    edges: z.array(z.object({
      issueId: z.string(),
      dependsOnId: z.string(),
      type: z.string(),
    })),
  });
}));
export const EpicsWithProgressResponseSchema = apiSuccessSchema(z.array(EpicWithChildrenSchema));
export const BeadUpdateResponseSchema = apiSuccessSchema(BeadUpdateResponseDataSchema);
export const OverviewResponseSchema = apiSuccessSchema(OverviewResponseDataSchema);
