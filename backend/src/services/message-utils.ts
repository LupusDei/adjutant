/**
 * Message utility functions for parsing beads issues into messages
 * and handling agent identities.
 */

import type { Message, MessagePriority, MessageType } from "../types/index.js";
import type { BeadsIssue } from "./bd-client.js";

/**
 * Patterns that identify infrastructure/coordination messages.
 * These are system-generated messages that most users don't need to see.
 */
const INFRASTRUCTURE_PATTERNS = [
  /^WITNESS_PING/i,
  /^MERGE_READY/i,
  /^MERGED:/i,
  /^POLECAT_DONE/i,
  /^Session ended/i,
  /^Handoff complete/i,
];

/**
 * Determines if a message subject indicates infrastructure/coordination traffic.
 */
export function isInfrastructureMessage(subject: string): boolean {
  return INFRASTRUCTURE_PATTERNS.some(p => p.test(subject));
}

export interface AgentFields {
  roleType?: string;
  rig?: string;
  agentState?: string;
  hookBead?: string;
}

export interface ParsedAgentBead {
  rig: string | null;
  role: string;
  name: string | null;
}

export function parseAgentBeadId(id: string, defaultRig?: string | null): ParsedAgentBead | null {
  const hyphenIdx = id.indexOf("-");
  if (hyphenIdx < 2 || hyphenIdx > 3) return null;
  const rest = id.slice(hyphenIdx + 1);
  const parts = rest.split("-");

  const first = parts[0];
  const second = parts[1];
  const third = parts[2];

  if (parts.length >= 2 && first && first.toLowerCase() === "dog") {
    return { rig: null, role: "dog", name: parts.slice(1).join("-") };
  }

  const knownRoles = ["user", "agent"];

  if (defaultRig && parts.length >= 1 && first && knownRoles.includes(first.toLowerCase())) {
    return {
      rig: defaultRig,
      role: first,
      name: parts.length > 1 ? parts.slice(1).join("-") : null,
    };
  }

  if (parts.length === 1 && first) {
    return { rig: null, role: first, name: null };
  }
  if (parts.length === 2 && first && second) {
    return { rig: first, role: second, name: null };
  }
  if (parts.length === 3 && first && second && third) {
    return { rig: first, role: second, name: third };
  }
  if (parts.length >= 3 && first && second) {
    return { rig: first, role: second, name: parts.slice(2).join("-") };
  }
  return null;
}

export function parseAgentFields(description: string): AgentFields {
  const fields: AgentFields = {};
  for (const rawLine of description.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const valueRaw = line.slice(colonIdx + 1).trim();
    const value = valueRaw === "null" ? "" : valueRaw;
    if (!value) continue;
    switch (key) {
      case "role_type":
        fields.roleType = value;
        break;
      case "rig":
        fields.rig = value;
        break;
      case "agent_state":
        fields.agentState = value;
        break;
      case "hook_bead":
        fields.hookBead = value;
        break;
      default:
        break;
    }
  }
  return fields;
}

export function addressToIdentity(address: string): string {
  if (address === "user" || address === "user/") return "user";

  let normalized = address;
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function identityToAddress(identity: string): string {
  return identity;
}

export interface BeadsMessageLabels {
  sender?: string;
  threadId?: string;
  replyTo?: string;
  msgType?: string;
  cc: string[];
  hasReadLabel: boolean;
}

export function parseMessageLabels(labels: string[] | undefined): BeadsMessageLabels {
  let sender: string | undefined;
  let threadId: string | undefined;
  let replyTo: string | undefined;
  let msgType: string | undefined;
  const cc: string[] = [];
  let hasReadLabel = false;

  for (const label of labels ?? []) {
    if (label.startsWith("from:")) {
      sender = label.slice("from:".length);
    } else if (label.startsWith("thread:")) {
      threadId = label.slice("thread:".length);
    } else if (label.startsWith("reply-to:")) {
      replyTo = label.slice("reply-to:".length);
    } else if (label.startsWith("msg-type:")) {
      msgType = label.slice("msg-type:".length);
    } else if (label.startsWith("cc:")) {
      cc.push(label.slice("cc:".length));
    } else if (label === "read") {
      hasReadLabel = true;
    }
  }

  const result: BeadsMessageLabels = { cc, hasReadLabel };
  if (sender) result.sender = sender;
  if (threadId) result.threadId = threadId;
  if (replyTo) result.replyTo = replyTo;
  if (msgType) result.msgType = msgType;

  return result;
}

function mapBeadsPriority(priority: number): MessagePriority {
  if (priority === 0 || priority === 1 || priority === 2 || priority === 3 || priority === 4) {
    return priority;
  }
  return 2;
}

function mapBeadsMessageType(msgType: string | undefined): MessageType {
  switch (msgType) {
    case "task":
    case "scavenge":
    case "reply":
    case "notification":
      return msgType;
    default:
      return "notification";
  }
}

function safeTimestamp(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}

export function beadsIssueToMessage(issue: BeadsIssue): Message {
  const labelInfo = parseMessageLabels(issue.labels);
  const from = labelInfo.sender ? identityToAddress(labelInfo.sender) : "unknown";
  const to = issue.assignee ? identityToAddress(issue.assignee) : "unknown";

  const message: Message = {
    id: issue.id,
    from,
    to,
    subject: issue.title,
    body: issue.description,
    timestamp: safeTimestamp(issue.created_at),
    read: issue.status === "closed" || labelInfo.hasReadLabel,
    priority: mapBeadsPriority(issue.priority),
    type: mapBeadsMessageType(labelInfo.msgType),
    threadId: labelInfo.threadId ?? "",
    pinned: issue.pinned ?? false,
    cc: labelInfo.cc.map(identityToAddress),
    isInfrastructure: isInfrastructureMessage(issue.title),
  };
  if (labelInfo.replyTo) message.replyTo = labelInfo.replyTo;
  return message;
}

/**
 * Extracts the prefix from a bead ID.
 * E.g., "adj-abc123" → "adj", "hq-xlzm" → "hq"
 */
export function extractBeadPrefix(beadId: string): string | null {
  const match = beadId.match(/^([a-z0-9]{2,5})-/i);
  return match?.[1]?.toLowerCase() ?? null;
}
