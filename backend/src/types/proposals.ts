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

export const CreateCommentSchema = z.object({
  body: z.string().min(1, "Comment body is required"),
  author: z.string().min(1, "Author is required"),
});

export const ReviseProposalSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: ProposalTypeSchema.optional(),
  changelog: z.string().min(1, "Changelog is required"),
  author: z.string().min(1, "Author is required"),
}).refine(
  (data) => data.title !== undefined || data.description !== undefined || data.type !== undefined,
  { message: "At least one of title, description, or type must be provided" },
);

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

export interface ProposalComment {
  id: string;
  proposalId: string;
  author: string;
  body: string;
  createdAt: string;
}

/** Raw row shape from SQLite for comments */
export interface ProposalCommentRow {
  id: string;
  proposal_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface ProposalRevision {
  id: string;
  proposalId: string;
  revisionNumber: number;
  author: string;
  title: string;
  description: string;
  type: ProposalType;
  changelog: string;
  createdAt: string;
}

/** Raw row shape from SQLite for revisions */
export interface ProposalRevisionRow {
  id: string;
  proposal_id: string;
  revision_number: number;
  author: string;
  title: string;
  description: string;
  type: string;
  changelog: string;
  created_at: string;
}
