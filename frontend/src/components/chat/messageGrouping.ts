/**
 * messageGrouping — same-sender run grouping for the chat timeline (adj-164.2.2).
 *
 * Consecutive messages from the same sender are collapsed into a visual "run":
 * only the FIRST message in a run shows the sender callsign, only the LAST
 * shows the timestamp/delivery status, and the bubbles in between sit closer
 * together. This reads like one continuous terminal transmission rather than a
 * stack of identically-chromed boxes.
 *
 * The function is pure and O(n): a single pass comparing each message's sender
 * key to its neighbours. Extracted from CommandChat so it is unit-testable in
 * isolation and so the virtualized render path can call it once per message
 * list (memoized) without dragging in component state.
 */

import type { DisplayMessage } from "../../hooks/useChatMessages";

export interface MessageGroupFlags {
  /** First message in a same-sender run → render the sender callsign header. */
  isFirstInGroup: boolean;
  /** Last message in a same-sender run → render the timestamp / delivery status. */
  isLastInGroup: boolean;
}

/**
 * The identity a run is keyed on. The user is always one sender; each distinct
 * agent is its own sender (two different agents never share a run). System and
 * announcement rows are deliberately given unique keys so they never group.
 */
function senderKey(msg: DisplayMessage): string {
  if (msg.role === "user") return "user";
  if (msg.role === "system" || msg.role === "announcement") {
    // Never group system/announcement rows — make every key unique.
    return `__system__${msg.id}`;
  }
  return `agent:${msg.agentId}`;
}

/**
 * Compute per-message grouping flags for a chronologically-ordered list.
 *
 * @param messages messages in display order (oldest → newest)
 * @returns a Map keyed by message id with each message's group flags
 */
export function computeMessageGroups(
  messages: DisplayMessage[],
): Map<string, MessageGroupFlags> {
  const flags = new Map<string, MessageGroupFlags>();

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];
    if (!current) continue;
    const key = senderKey(current);

    const prev = messages[i - 1];
    const next = messages[i + 1];

    const isFirstInGroup = !prev || senderKey(prev) !== key;
    const isLastInGroup = !next || senderKey(next) !== key;

    flags.set(current.id, { isFirstInGroup, isLastInGroup });
  }

  return flags;
}
