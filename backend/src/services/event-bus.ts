/**
 * EventBus service for Adjutant.
 *
 * In-process pub/sub using Node.js EventEmitter.
 * Services emit domain events, and consumers (SSE, WebSocket) subscribe to them.
 *
 * Event naming convention: "domain:action" (e.g., "mail:received", "bead:updated")
 */

import { EventEmitter } from "events";
import { logInfo } from "../utils/index.js";

// ============================================================================
// Event Types
// ============================================================================

export interface MailReceivedEvent {
  id: string;
  from: string;
  to: string;
  subject: string;
  preview: string;
}

export interface MailReadEvent {
  id: string;
}

export interface BeadCreatedEvent {
  id: string;
  title: string;
  status: string;
  type: string;
}

export interface BeadUpdatedEvent {
  id: string;
  status: string;
  title: string;
  updatedAt: string;
  assignee?: string;
}

export interface BeadClosedEvent {
  id: string;
  title: string;
  closedAt: string;
}

export interface BeadAssignedEvent {
  beadId: string;
  agentId: string;
  assignedBy: string;  // behavior name that made the assignment
}

export interface AgentStatusEvent {
  agent: string;
  status: string;
  activity?: string;
}

export interface StreamStatusEvent {
  streamId: string;
  agent: string;
  state: "started" | "token" | "completed" | "cancelled" | "error";
}

export interface McpAgentConnectedEvent {
  agentId: string;
  sessionId: string;
}

export interface McpAgentDisconnectedEvent {
  agentId: string;
  sessionId: string;
}

export interface CorrectionDetectedEvent {
  messageId: string;
  from: string;
  pattern: string;  // which regex pattern matched
  body: string;     // the message body
}

export interface LearningCreatedEvent {
  learningId: number;
  category: string;
  topic: string;
  sourceType: string;
}

export interface BuildFailedEvent {
  agentId: string;
  exitCode: number;
  errorOutput: string;
  streamId: string;
}

export interface BuildPassedEvent {
  agentId: string;
  streamId: string;
}

export interface MergeCompletedEvent {
  branch: string;
  beadId: string;
}

export interface MergeConflictEvent {
  branch: string;
  conflictFiles: string[];
}

/**
 * Map of event names to their payload types.
 */
export interface EventMap {
  "mail:received": MailReceivedEvent;
  "mail:read": MailReadEvent;
  "bead:created": BeadCreatedEvent;
  "bead:updated": BeadUpdatedEvent;
  "bead:closed": BeadClosedEvent;
  "bead:assigned": BeadAssignedEvent;
  "agent:status_changed": AgentStatusEvent;
  "stream:status": StreamStatusEvent;
  "session:cost": Record<string, unknown>;
  "session:cost_alert": Record<string, unknown>;
  "session:permission": Record<string, unknown>;
  "stream:output": Record<string, unknown>;
  "mcp:agent_connected": McpAgentConnectedEvent;
  "mcp:agent_disconnected": McpAgentDisconnectedEvent;
  "correction:detected": CorrectionDetectedEvent;
  "learning:created": LearningCreatedEvent;
  "build:failed": BuildFailedEvent;
  "build:passed": BuildPassedEvent;
  "merge:completed": MergeCompletedEvent;
  "merge:conflict": MergeConflictEvent;
}

export type EventName = keyof EventMap;

// ============================================================================
// EventBus Class
// ============================================================================

class EventBus {
  private emitter = new EventEmitter();
  private seq = 0;

  constructor() {
    // Allow many listeners (SSE clients, WS handlers, etc.)
    this.emitter.setMaxListeners(100);
  }

  /**
   * Emit a typed event.
   */
  emit<K extends EventName>(event: K, data: EventMap[K]): void {
    this.seq++;
    this.emitter.emit(event, data, this.seq);
    this.emitter.emit("*", event, data, this.seq);
  }

  /**
   * Subscribe to a specific event type.
   * Callback receives (data, seq).
   */
  on<K extends EventName>(event: K, handler: (data: EventMap[K], seq: number) => void): void {
    this.emitter.on(event, handler);
  }

  /**
   * Subscribe to ALL events (wildcard).
   * Callback receives (eventName, data, seq).
   */
  onAny(handler: (event: EventName, data: unknown, seq: number) => void): void {
    this.emitter.on("*", handler);
  }

  /**
   * Unsubscribe a handler from a specific event.
   */
  off<K extends EventName>(event: K, handler: (data: EventMap[K], seq: number) => void): void {
    this.emitter.off(event, handler);
  }

  /**
   * Unsubscribe a wildcard handler.
   */
  offAny(handler: (event: EventName, data: unknown, seq: number) => void): void {
    this.emitter.off("*", handler);
  }

  /**
   * Get the current sequence number.
   */
  getSeq(): number {
    return this.seq;
  }

  /**
   * Get listener counts for diagnostics.
   */
  listenerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    counts["*"] = this.emitter.listenerCount("*");
    const events: EventName[] = [
      "mail:received", "mail:read",
      "bead:created", "bead:updated", "bead:closed", "bead:assigned",
      "agent:status_changed", "stream:status",
      "correction:detected", "learning:created",
      "build:failed", "build:passed", "merge:completed", "merge:conflict",
    ];
    for (const e of events) {
      const count = this.emitter.listenerCount(e);
      if (count > 0) counts[e] = count;
    }
    return counts;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: EventBus | null = null;

/**
 * Get the global EventBus singleton.
 */
export function getEventBus(): EventBus {
  if (!instance) {
    instance = new EventBus();
    logInfo("EventBus initialized");
  }
  return instance;
}

/**
 * Reset the EventBus singleton (for testing).
 */
export function resetEventBus(): void {
  instance = null;
}
