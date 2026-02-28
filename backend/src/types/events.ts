import { z } from "zod";

export const EventType = z.enum([
  "status_change",
  "progress_report",
  "announcement",
  "message_sent",
  "bead_updated",
  "bead_closed",
]);
export type EventType = z.infer<typeof EventType>;

export interface TimelineEvent {
  id: string;
  eventType: EventType;
  agentId: string;
  action: string;
  detail: Record<string, unknown> | null;
  beadId: string | null;
  messageId: string | null;
  createdAt: string;
}

/** Raw row from SQLite */
export interface EventRow {
  id: string;
  event_type: string;
  agent_id: string;
  action: string;
  detail: string | null;
  bead_id: string | null;
  message_id: string | null;
  created_at: string;
}

export const TimelineQuerySchema = z.object({
  agentId: z.string().optional(),
  eventType: EventType.optional(),
  beadId: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional().default(50),
});
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;
