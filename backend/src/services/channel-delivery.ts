/**
 * Channel → agent CLI delivery (adj: channel tmux injection).
 *
 * Direct messages are injected into the recipient agent's tmux pane via
 * `SessionBridge.sendInput` so the agent sees them in its CLI. Channel posts
 * need the same — but fanned out to EVERY agent member of the channel, and
 * tagged so the agent knows it is a CHANNEL message (multi-party) and how to
 * reply (to the room, via `conversationId`), rather than treating it as a 1:1 DM.
 *
 * Best-effort: a missing session bridge or a send failure for one member never
 * blocks the post or the other members.
 */
import { getSessionBridge } from "./session-bridge.js";
import type { ConversationStore } from "./conversation-store.js";

export interface ChannelDeliveryInput {
  /** The channel conversation id. */
  channelId: string;
  /** Who posted — an agent name or "user". Never echoed back to itself. */
  senderId: string;
  /** The raw message body. */
  body: string;
}

/**
 * Format the CLI-injected text for a channel post. Explicitly labels it as a
 * channel message and tells the agent to reply to the whole room via
 * `send_message({ conversationId })` — NOT a direct message — so multi-party
 * replies land back in the channel.
 */
export function formatChannelInjection(args: {
  channelTitle: string;
  channelId: string;
  senderId: string;
  body: string;
  memberIds: string[];
}): string {
  const { channelTitle, channelId, senderId, body, memberIds } = args;
  const others = memberIds.join(", ");
  return (
    `[CHANNEL #${channelTitle} | from ${senderId}] ${body}\n` +
    `(This is a CHANNEL message, not a DM. To reply to the whole room, use ` +
    `send_message with conversationId="${channelId}". Members: ${others}.)`
  );
}

/**
 * Inject a channel post into the tmux CLI of every AGENT member of the channel,
 * excluding the sender and the human operator ("user"). Returns the list of
 * agent member ids a delivery was attempted for (useful for tests/telemetry).
 */
export function deliverChannelPostToAgents(
  conversationStore: ConversationStore,
  input: ChannelDeliveryInput,
): string[] {
  const { channelId, senderId, body } = input;

  let members;
  try {
    members = conversationStore.getMembers(channelId);
  } catch {
    return [];
  }
  if (members.length === 0) return [];

  const conv = conversationStore.getConversation(channelId);
  const channelTitle = conv?.title ?? channelId;
  const memberIds = members.map((m) => m.memberId);

  const injected = formatChannelInjection({
    channelTitle,
    channelId,
    senderId,
    body,
    memberIds,
  });

  let bridge: ReturnType<typeof getSessionBridge>;
  try {
    bridge = getSessionBridge();
  } catch {
    // Session bridge not initialized — agents will pull via MCP read_messages.
    return [];
  }

  const delivered: string[] = [];
  for (const member of members) {
    if (member.memberKind !== "agent") continue; // skip the human operator
    if (member.memberId === senderId) continue; // never echo to the author
    try {
      const sessions = bridge.registry.findByName(member.memberId);
      for (const session of sessions) {
        bridge.sendInput(session.id, injected).catch(() => {
          /* best-effort per session */
        });
      }
      delivered.push(member.memberId);
    } catch {
      /* best-effort per member */
    }
  }
  return delivered;
}
