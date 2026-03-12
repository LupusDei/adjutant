/**
 * Shared Zod schemas for messaging, agents, projects, and proposals API contracts.
 *
 * Phase 3 of the contract testing initiative.
 *
 * @module types/api-contracts
 */

import { z } from "zod";
import { apiSuccessSchema, ApiErrorSchema } from "./cost-contracts.js";

// Re-export envelope helpers
export { apiSuccessSchema, ApiErrorSchema };

// ============================================================================
// Chat Message (message store format)
// ============================================================================

export const ChatMessageSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  role: z.string(),
  body: z.string(),
  createdAt: z.string(),
  threadId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  delivered: z.boolean().optional(),
});

// ============================================================================
// Messages endpoints
// ============================================================================

export const MessageListResponseDataSchema = z.object({
  items: z.array(ChatMessageSchema),
  total: z.number(),
  hasMore: z.boolean(),
});

export const UnreadCountSchema = z.object({
  agentId: z.string(),
  count: z.number(),
});

export const UnreadResponseDataSchema = z.object({
  counts: z.array(UnreadCountSchema),
});

export const ThreadSchema = z.object({
  threadId: z.string(),
  lastMessage: ChatMessageSchema.optional(),
  messageCount: z.number().optional(),
});

export const ThreadsResponseDataSchema = z.object({
  threads: z.array(z.unknown()), // Thread shape varies
});

export const SendMessageResponseDataSchema = z.object({
  messageId: z.string(),
  timestamp: z.string(),
});

export const MarkReadResponseDataSchema = z.object({
  read: z.boolean(),
});

export const BroadcastResponseDataSchema = z.object({
  sent: z.array(z.string()),
  count: z.number(),
});

// ============================================================================
// CrewMember (agents endpoint)
// ============================================================================

export const CrewMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  project: z.string().nullable(),
  status: z.enum(["idle", "working", "blocked", "stuck", "offline"]),
  currentTask: z.string().optional(),
  unreadMail: z.number().optional(),
  firstSubject: z.string().optional(),
  firstFrom: z.string().optional(),
  branch: z.string().optional(),
  sessionId: z.string().optional(),
  lastActivity: z.string().optional(),
  worktreePath: z.string().optional(),
  progress: z.object({ completed: z.number(), total: z.number() }).optional(),
  swarmId: z.string().optional(),
  isCoordinator: z.boolean().optional(),
  cost: z.number().optional(),
  contextPercent: z.number().optional(),
});

// ============================================================================
// Projects
// ============================================================================

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  active: z.boolean(),
  createdAt: z.string().optional(),
  hasBeads: z.boolean().optional(),
});

export const ProjectHealthSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  isGit: z.boolean(),
  hasBeads: z.boolean(),
  status: z.string(),
});

export const DiscoverResponseDataSchema = z.object({
  discovered: z.number(),
  projects: z.array(ProjectSchema),
});

// ============================================================================
// Proposals
// ============================================================================

export const ProposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(["product", "engineering"]),
  project: z.string(),
  author: z.string(),
  status: z.enum(["pending", "accepted", "dismissed", "completed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProposalCommentSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

// ============================================================================
// Tunnel
// ============================================================================

export const TunnelStatusSchema = z.object({
  state: z.string(),
  publicUrl: z.string().optional(),
  error: z.string().optional(),
});

// ============================================================================
// Composed API response schemas
// ============================================================================

// Messages
export const MessageListResponseSchema = apiSuccessSchema(MessageListResponseDataSchema);
export const SingleMessageResponseSchema = apiSuccessSchema(ChatMessageSchema);
export const UnreadResponseSchema = apiSuccessSchema(UnreadResponseDataSchema);
export const ThreadsResponseSchema = apiSuccessSchema(ThreadsResponseDataSchema);
export const SendMessageResponseSchema = apiSuccessSchema(SendMessageResponseDataSchema);
export const MarkReadResponseSchema = apiSuccessSchema(MarkReadResponseDataSchema);
export const BroadcastResponseSchema = apiSuccessSchema(BroadcastResponseDataSchema);

// Agents
export const AgentListResponseSchema = apiSuccessSchema(z.array(CrewMemberSchema));

// Projects
export const ProjectListResponseSchema = apiSuccessSchema(z.array(ProjectSchema));
export const SingleProjectResponseSchema = apiSuccessSchema(ProjectSchema);
export const DiscoverResponseSchema = apiSuccessSchema(DiscoverResponseDataSchema);
export const ProjectHealthResponseSchema = apiSuccessSchema(ProjectHealthSchema);

// Proposals
export const ProposalListResponseSchema = apiSuccessSchema(z.array(ProposalSchema));
export const SingleProposalResponseSchema = apiSuccessSchema(ProposalSchema);
export const ProposalCommentListResponseSchema = apiSuccessSchema(z.array(ProposalCommentSchema));
export const SingleProposalCommentResponseSchema = apiSuccessSchema(ProposalCommentSchema);

// Tunnel
export const TunnelStatusResponseSchema = apiSuccessSchema(TunnelStatusSchema);
