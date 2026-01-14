import type { Message, MessagePriority, MessageType } from "../types/index.js";
import type { BeadsIssue } from "./bd-client.js";

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

export function parseAgentBeadId(id: string): ParsedAgentBead | null {
  const hyphenIdx = id.indexOf("-");
  if (hyphenIdx < 2 || hyphenIdx > 3) return null;
  const rest = id.slice(hyphenIdx + 1);
  const parts = rest.split("-");

  if (parts.length === 1) {
    return { rig: null, role: parts[0], name: null };
  }
  if (parts.length === 2) {
    if (parts[0] === "dog") {
      return { rig: null, role: "dog", name: parts[1] };
    }
    return { rig: parts[0], role: parts[1], name: null };
  }
  if (parts.length === 3) {
    return { rig: parts[0], role: parts[1], name: parts[2] };
  }
  if (parts.length >= 3) {
    if (parts[0] === "dog") {
      return { rig: null, role: "dog", name: parts.slice(1).join("-") };
    }
    return { rig: parts[0], role: parts[1], name: parts.slice(2).join("-") };
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
  if (address === "overseer") return "overseer";
  if (address === "mayor" || address === "mayor/") return "mayor/";
  if (address === "deacon" || address === "deacon/") return "deacon/";

  let normalized = address;
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  const parts = normalized.split("/");
  if (parts.length === 3 && (parts[1] === "crew" || parts[1] === "polecats")) {
    return `${parts[0]}/${parts[2]}`;
  }

  return normalized;
}

export function identityToAddress(identity: string): string {
  if (identity === "overseer") return "overseer";
  if (identity === "mayor" || identity === "mayor/") return "mayor/";
  if (identity === "deacon" || identity === "deacon/") return "deacon/";

  const parts = identity.split("/");
  if (parts.length === 3 && (parts[1] === "crew" || parts[1] === "polecats")) {
    return `${parts[0]}/${parts[2]}`;
  }

  return identity;
}

export function sessionNameForAgent(role: string, rig: string | null, name: string | null): string | null {
  switch (role) {
    case "mayor":
      return "hq-mayor";
    case "deacon":
      return "hq-deacon";
    case "witness":
      return rig ? `gt-${rig}-witness` : null;
    case "refinery":
      return rig ? `gt-${rig}-refinery` : null;
    case "crew":
      return rig && name ? `gt-${rig}-crew-${name}` : null;
    case "polecat":
      return rig && name ? `gt-${rig}-${name}` : null;
    default:
      return null;
  }
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
  const result: BeadsMessageLabels = {
    sender: undefined,
    threadId: undefined,
    replyTo: undefined,
    msgType: undefined,
    cc: [],
    hasReadLabel: false,
  };

  for (const label of labels ?? []) {
    if (label.startsWith("from:")) {
      result.sender = label.slice("from:".length);
    } else if (label.startsWith("thread:")) {
      result.threadId = label.slice("thread:".length);
    } else if (label.startsWith("reply-to:")) {
      result.replyTo = label.slice("reply-to:".length);
    } else if (label.startsWith("msg-type:")) {
      result.msgType = label.slice("msg-type:".length);
    } else if (label.startsWith("cc:")) {
      result.cc.push(label.slice("cc:".length));
    } else if (label === "read") {
      result.hasReadLabel = true;
    }
  }

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

  return {
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
    replyTo: labelInfo.replyTo,
    pinned: issue.pinned ?? false,
    cc: labelInfo.cc.map(identityToAddress),
  };
}
