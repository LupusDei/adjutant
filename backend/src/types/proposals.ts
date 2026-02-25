import { z } from "zod";

// =============================================================================
// Zod Schemas
// =============================================================================

export const ProposalTypeSchema = z.enum(["product", "engineering"]);
export const ProposalStatusSchema = z.enum(["pending", "accepted", "dismissed", "completed"]);

export const CreateProposalSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  type: ProposalTypeSchema,
  project: z.string().min(1, "Project is required"),
});

export const UpdateProposalStatusSchema = z.object({
  status: z.enum(["accepted", "dismissed", "completed"]),
});

export const ProposalFilterSchema = z.object({
  status: ProposalStatusSchema.optional(),
  type: ProposalTypeSchema.optional(),
  project: z.string().optional(),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type ProposalType = z.infer<typeof ProposalTypeSchema>;
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export interface Proposal {
  id: string;
  author: string;
  title: string;
  description: string;
  type: ProposalType;
  status: ProposalStatus;
  project: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw row shape from SQLite before camelCase mapping */
export interface ProposalRow {
  id: string;
  author: string;
  title: string;
  description: string;
  type: string;
  status: string;
  project: string;
  created_at: string;
  updated_at: string;
}
